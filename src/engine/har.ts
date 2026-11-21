// HAR parsing. Reads only the fields the simulation needs and drops the rest
// here, so cookies, authorisation headers and bodies never reach application
// state or storage.

import type { Destination, HarPage, Mode, ParsedHar, Provenance, SimRequest } from './types.ts'

const DESTINATIONS = new Set<string>([
	'document', 'iframe', 'frame', 'embed', 'object', 'script', 'style', 'image',
	'font', 'audio', 'video', 'track', 'manifest', 'worker', 'sharedworker',
	'serviceworker', 'audioworklet', 'paintworklet', 'report', 'xslt', 'json', 'empty',
])

const MODES = new Set<string>(['navigate', 'cors', 'no-cors', 'same-origin', 'websocket'])

/** Chrome's `_resourceType` values, where they pin down a destination. */
const RESOURCE_TYPES = new Map<string, Destination>([
	['document', 'document'],
	['stylesheet', 'style'],
	['script', 'script'],
	['image', 'image'],
	['font', 'font'],
	['media', 'video'],
	['manifest', 'manifest'],
	['texttrack', 'track'],
	['xhr', 'empty'],
	['fetch', 'empty'],
	['eventsource', 'empty'],
	['ping', 'empty'],
	['preflight', 'empty'],
])

/** The only response headers kept. All describe caching; none identify a user. */
const CACHE_HEADERS = new Set([
	'cache-control', 'cdn-cache-control', 'cloudflare-cdn-cache-control',
	'surrogate-control', 'expires', 'date', 'age', 'cf-cache-status', 'x-cache',
])

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asObject(value: unknown): Json {
	return isObject(value) ? value : {}
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : []
}

function asSize(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** Picks the named headers out of a HAR header list, lower-casing the names. */
function pickHeaders(list: unknown, wanted: ReadonlySet<string>): Record<string, string> {
	const picked: Record<string, string> = {}
	for (const item of asArray(list)) {
		if (!isObject(item) || typeof item.name !== 'string' || typeof item.value !== 'string') continue
		const name = item.name.toLowerCase()
		if (wanted.has(name) && !(name in picked)) picked[name] = item.value
	}
	return picked
}

const REQUEST_HEADERS = new Set(['sec-fetch-dest', 'sec-fetch-mode', 'range', 'service-worker'])

function mediaType(value: unknown): string {
	return typeof value === 'string' ? (value.split(';')[0] ?? '').trim().toLowerCase() : ''
}

function destinationFromContentType(type: string): Destination {
	if (type === 'text/html' || type === 'application/xhtml+xml') return 'document'
	if (type === 'text/css') return 'style'
	if (type.includes('javascript') || type.includes('ecmascript')) return 'script'
	if (type === 'application/manifest+json') return 'manifest'
	if (type.startsWith('image/')) return 'image'
	if (type.startsWith('font/') || type.includes('woff') || type.includes('opentype')) return 'font'
	if (type.startsWith('audio/')) return 'audio'
	if (type.startsWith('video/')) return 'video'
	if (type === 'text/vtt') return 'track'
	if (type === 'application/json') return 'empty'
	return 'unknown'
}

/** A parsed entry, with the facts needed to tidy the list before they are dropped. */
interface Draft {
	request: SimRequest
	/** A page request that an already-installed service worker answered. */
	viaWorker: boolean
	/** Could be a service worker's own fetch: a script fetch with no destination. */
	workerFetchCandidate: boolean
	pageref: string | null
}

function parseEntry(entry: unknown): Draft | null {
	const request = asObject(asObject(entry).request)
	const response = asObject(asObject(entry).response)
	const content = asObject(response.content)

	if (typeof request.url !== 'string' || !URL.canParse(request.url)) return null

	const headers = pickHeaders(request.headers, REQUEST_HEADERS)
	const contentType = mediaType(content.mimeType)
		|| mediaType(pickHeaders(response.headers, new Set(['content-type']))['content-type'])

	let destination: Destination = 'unknown'
	let destinationSource: Provenance = 'unknown'
	const headerDest = headers['sec-fetch-dest']?.toLowerCase()
	const resourceType = asObject(entry)._resourceType
	const fromResourceType = typeof resourceType === 'string' ? RESOURCE_TYPES.get(resourceType) : undefined
	if (headerDest && DESTINATIONS.has(headerDest)) {
		destination = headerDest as Destination
		destinationSource = 'header'
	} else if (fromResourceType) {
		destination = fromResourceType
		destinationSource = 'resource-type'
		// Chrome files audio and video together as 'media'.
		if (resourceType === 'media' && contentType.startsWith('audio/')) destination = 'audio'
	} else {
		destination = destinationFromContentType(contentType)
		if (destination !== 'unknown') destinationSource = 'content-type'
	}

	let mode: Mode = 'unknown'
	let modeSource: Provenance = 'unknown'
	const headerMode = headers['sec-fetch-mode']?.toLowerCase()
	if (headerMode && MODES.has(headerMode)) {
		mode = headerMode as Mode
		modeSource = 'header'
	}

	const bodySize = asSize(content.size) ?? asSize(response.bodySize) ?? 0
	const transferSize = asSize(response._transferSize)
		?? (asSize(response.headersSize) ?? 0) + (asSize(response.bodySize) ?? 0)
	const pageref = asObject(entry).pageref

	return {
		viaWorker: response._fetchedViaServiceWorker === true,
		workerFetchCandidate: resourceType === 'fetch' && headerDest === 'empty',
		pageref: typeof pageref === 'string' ? pageref : null,
		request: {
			index: 0,
			page: 0,
			url: request.url,
			method: typeof request.method === 'string' ? request.method.toUpperCase() : 'GET',
			status: typeof response.status === 'number' ? response.status : 0,
			contentType,
			transferSize,
			bodySize,
			destination,
			destinationSource,
			mode,
			modeSource,
			viaWorker: response._fetchedViaServiceWorker === true,
			hasRange: 'range' in headers,
			isWorkerScript: destination === 'serviceworker' || headers['service-worker']?.toLowerCase() === 'script',
			cacheHeaders: pickHeaders(response.headers, CACHE_HEADERS),
		},
	}
}

/**
 * A HAR recorded while a service worker was active lists most requests twice:
 * once as the page made it (answered by the worker, with no Sec-Fetch headers
 * and no transfer size) and once as the worker's own fetch of the same URL
 * (with the real size and headers, but destination 'empty'). Neither alone is
 * the request a new worker would see. This folds each pair into one: the
 * page's destination, the worker fetch's mode, size and caching headers.
 * Returns the worker fetches to drop.
 */
function foldWorkerFetches(drafts: Draft[]): Set<Draft> {
	const candidates = new Map<string, Draft[]>()
	for (const draft of drafts) {
		if (!draft.workerFetchCandidate || draft.viaWorker) continue
		const key = `${draft.request.method} ${draft.request.url}`
		const list = candidates.get(key)
		if (list) list.push(draft)
		else candidates.set(key, [draft])
	}

	const folded = new Set<Draft>()
	for (const { request, viaWorker, pageref } of drafts) {
		if (!viaWorker) continue
		// Chrome records a worker's fetches outside any page. One that does name
		// a page must name this one, or it is a later load's own fetch().
		const twin = candidates.get(`${request.method} ${request.url}`)
			?.find((draft) => !folded.has(draft) && (draft.pageref === null || draft.pageref === pageref))
		if (!twin) continue
		folded.add(twin)
		const fetched = twin.request
		// A worker's fetch(event.request) keeps the page's mode, so this is the
		// best evidence there is, but a strategy can override it: not a certainty.
		if (request.modeSource !== 'header' && fetched.modeSource === 'header') {
			request.mode = fetched.mode
			request.modeSource = 'worker-fetch'
		}
		request.transferSize = fetched.transferSize
		request.bodySize ||= fetched.bodySize
		request.status ||= fetched.status
		request.contentType ||= fetched.contentType
		request.hasRange ||= fetched.hasRange
		if (Object.keys(fetched.cacheHeaders).length > 0) request.cacheHeaders = fetched.cacheHeaders
	}
	return folded
}

function isHttp(url: string): boolean {
	return url.startsWith('http://') || url.startsWith('https://')
}

/** Works out which page a list of requests belongs to, and numbers them. */
function assemble(requests: SimRequest[], pages: HarPage[], skipped: number, workerFetches: number): ParsedHar {
	requests.forEach((request, index) => {
		request.index = index
	})

	// The page is the first document that loaded, not merely the first entry:
	// a HAR often opens with a redirect from another origin.
	const documents = requests.filter((r) => r.destination === 'document' && isHttp(r.url))
	const page = documents.find((r) => r.status >= 200 && r.status < 300) ?? documents[0]
	const title = pages[requests[0]?.page ?? 0]?.title
	const pageUrl = page?.url
		?? (title !== undefined && isHttp(title) && URL.canParse(title) ? title : null)
		?? requests.find((r) => isHttp(r.url))?.url
		?? null

	// Without Sec-Fetch-Mode, the page's own document is the one mode that can
	// be inferred safely.
	if (page?.mode === 'unknown') {
		page.mode = 'navigate'
		page.modeSource = 'inferred'
	}

	return {
		pageUrl,
		origin: pageUrl ? new URL(pageUrl).origin : null,
		requests,
		pages,
		skipped,
		workerFetches,
	}
}

/**
 * Reduces a HAR (already parsed from JSON) to the requests the simulation
 * needs. Throws if the value is not a HAR at all.
 */
export function parseHar(har: unknown): ParsedHar {
	const log = asObject(har).log
	if (!isObject(log) || !Array.isArray(log.entries)) {
		throw new Error('Not a HAR file: expected an object with a log.entries array.')
	}

	const drafts: Draft[] = []
	let skipped = 0
	for (const entry of log.entries) {
		const parsed = parseEntry(entry)
		if (parsed) drafts.push(parsed)
		else skipped++
	}
	const folded = foldWorkerFetches(drafts)

	// With "Keep log" ticked, one HAR holds several page loads.
	const pages: HarPage[] = []
	const pageIds = new Map<string, number>()
	for (const item of asArray(log.pages)) {
		const { id, title } = asObject(item)
		if (typeof id !== 'string' || pageIds.has(id)) continue
		pageIds.set(id, pages.length)
		pages.push({ title: typeof title === 'string' ? title : '', requests: 0, viaWorker: 0 })
	}

	const requests: SimRequest[] = []
	let current = 0
	for (const draft of drafts) {
		if (folded.has(draft)) continue
		// An entry with no page of its own belongs with the one before it.
		current = (draft.pageref === null ? undefined : pageIds.get(draft.pageref)) ?? current
		draft.request.page = current
		const page = pages[current]
		if (page) {
			page.requests++
			if (draft.viaWorker) page.viaWorker++
		}
		requests.push(draft.request)
	}

	return assemble(requests, pages, skipped, folded.size)
}

/**
 * The page load to show first when a HAR holds several: the latest one
 * recorded without a service worker in the way, or failing that the latest.
 * null when there is nothing to choose between.
 */
export function bestPage(har: ParsedHar): number | null {
	if (har.pages.length < 2) return null
	const clean = har.pages.findLastIndex((page) => page.requests > 0 && page.viaWorker === 0)
	return clean === -1 ? har.pages.length - 1 : clean
}

/** The same HAR narrowed to one of its page loads. */
export function selectPage(har: ParsedHar, page: number): ParsedHar {
	const requests = har.requests.filter((request) => request.page === page).map((request) => ({ ...request }))
	return assemble(requests, har.pages, har.skipped, har.workerFetches)
}

/** Parses HAR text. Throws on invalid JSON or a value that is not a HAR. */
export function parseHarText(text: string): ParsedHar {
	let json: unknown
	try {
		json = JSON.parse(text)
	} catch {
		throw new Error('Not a HAR file: the file is not valid JSON.')
	}
	return parseHar(json)
}
