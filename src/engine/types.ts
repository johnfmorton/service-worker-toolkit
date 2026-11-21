// The engine's vocabulary. Nothing here is specific to one service worker
// library: routes, strategies and caches are the generic concepts, and the
// library-specific defaults live in defaults.ts.

// ---------------------------------------------------------------------------
// Requests (parsed from a HAR)
// ---------------------------------------------------------------------------

/** A request destination as the Fetch spec names it, or 'unknown'. */
export type Destination =
	| 'document' | 'iframe' | 'frame' | 'embed' | 'object'
	| 'script' | 'style' | 'image' | 'font' | 'audio' | 'video' | 'track'
	| 'manifest' | 'worker' | 'sharedworker' | 'serviceworker'
	| 'audioworklet' | 'paintworklet' | 'report' | 'xslt' | 'json'
	| 'empty' | 'unknown'

export type Mode = 'navigate' | 'cors' | 'no-cors' | 'same-origin' | 'websocket' | 'unknown'

/**
 * Where a request property came from. Anything but 'header' is a guess the UI
 * should show as inferred and let the user correct.
 */
export type Provenance = 'header' | 'resource-type' | 'content-type' | 'worker-fetch' | 'inferred' | 'unknown'

/**
 * One HAR entry, reduced to the fields the simulation needs. Cookies,
 * authorisation headers and bodies are never copied into this shape.
 */
export interface SimRequest {
	/** Position in ParsedHar.requests, which is load order. */
	index: number
	/** Which page load it belongs to: an index into ParsedHar.pages. */
	page: number
	url: string
	method: string
	status: number
	/** Media type only, lower case, no parameters. Empty when absent. */
	contentType: string
	/** Bytes over the wire, or 0 when the HAR does not say. */
	transferSize: number
	/** Decoded body bytes, or 0 when the HAR does not say. */
	bodySize: number
	destination: Destination
	destinationSource: Provenance
	mode: Mode
	modeSource: Provenance
	/** A service worker that was already installed answered this request when the HAR was recorded. */
	viaWorker: boolean
	/** The request carried a Range header. */
	hasRange: boolean
	/** The request was a browser's fetch of a service worker script. */
	isWorkerScript: boolean
	/** Response headers that describe caching, lower-case names. Nothing else is kept. */
	cacheHeaders: Record<string, string>
}

export interface HarPage {
	title: string
	requests: number
	/** How many of those requests a recorded service worker answered. */
	viaWorker: number
}

export interface ParsedHar {
	/** The page the HAR was recorded on, when it can be worked out. */
	pageUrl: string | null
	/** Origin of that page: the suggested value for the site's own origin. */
	origin: string | null
	requests: SimRequest[]
	/** The page loads recorded in the HAR. Usually one; more when the log was kept across reloads. */
	pages: HarPage[]
	/** Entries dropped because they had no usable URL. */
	skipped: number
	/** A recorded service worker's own fetches, folded into the requests they answered. */
	workerFetches: number
}

// ---------------------------------------------------------------------------
// Configuration (written by the user)
// ---------------------------------------------------------------------------

export type Strategy =
	| 'cache-first'
	| 'network-first'
	| 'stale-while-revalidate'
	| 'network-only'
	| 'cache-only'

interface ConditionBase {
	/** Invert the condition. */
	negate?: boolean
}

/**
 * One test against a request. Conditions are data, not code, so they can be
 * edited in a form, saved as JSON and evaluated safely.
 */
export type Condition =
	| (ConditionBase & { type: 'same-origin' })
	| (ConditionBase & { type: 'origin', value: string })
	| (ConditionBase & { type: 'path-prefix', value: string })
	/** A regular expression source, tested against the URL's pathname. */
	| (ConditionBase & { type: 'path-pattern', value: string, flags?: string })
	/** The URL has a query parameter with this name. */
	| (ConditionBase & { type: 'query-param', value: string })
	| (ConditionBase & { type: 'destination', value: Destination[] })
	| (ConditionBase & { type: 'mode', value: Mode[] })

export interface HandlerOptions {
	/** Force the mode of the worker's own fetch. */
	fetchMode?: 'cors' | 'no-cors' | 'same-origin'
	/** Force the credentials of the worker's own fetch. */
	fetchCredentials?: 'omit' | 'same-origin' | 'include'
	/** Response statuses that may be written to the cache. 0 is an opaque response. */
	cacheableStatuses?: number[]
	maxEntries?: number
	maxAgeSeconds?: number
}

export interface Handler {
	strategy: Strategy
	/** Ignored by network-only. */
	cacheName: string
	options?: HandlerOptions
}

export interface Route extends Handler {
	id: string
	name: string
	/** All must hold. An empty list matches every request. */
	conditions: Condition[]
	/** HTTP method the route handles. Defaults to the library default (GET). */
	method?: string
}

export interface PrecacheEntry {
	/** Absolute, or relative to the site origin. */
	url: string
	revision?: string | null
	/** Size in bytes, if known. Otherwise it is taken from the HAR where possible. */
	size?: number
}

export interface PrecacheConfig {
	entries: PrecacheEntry[]
	/** Regular expression sources; matching query parameter names are ignored. */
	ignoreParams?: string[]
	/** File tried for URLs ending in '/'. null turns this off. */
	directoryIndex?: string | null
	/** Also try the URL with '.html' appended. */
	cleanUrls?: boolean
	/** Total size above which the precache-weight warning is raised. */
	budgetBytes?: number
}

export interface Config {
	version: 1
	/** The site's own origin, e.g. 'https://example.com'. */
	origin: string
	precache: PrecacheConfig
	/** Tried in order; the first match wins. */
	routes: Route[]
	/** Handles requests no route matched. null sends them to the network untouched. */
	defaultHandler: Handler | null
	/** Path or URL of the service worker script. Defaults to '/sw.js'. */
	workerScript?: string
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type HandledBy =
	| { kind: 'precache', entryUrl: string }
	| { kind: 'route', routeId: string }
	| { kind: 'default' }
	/** The worker does not respond; the browser handles the request itself. */
	| { kind: 'network', reason: 'unmatched' | 'method' | 'not-http' | 'worker-script' }

export interface RequestResult {
	/** Index into ParsedHar.requests. */
	index: number
	handledBy: HandledBy
	strategy: Strategy | null
	cacheName: string | null
	/** The response would be written to cacheName on this load. */
	cached: boolean
	/** The worker would receive an opaque response for this request. */
	opaque: boolean
	/** Indexes into SimulationResult.warnings. */
	warnings: number[]
}

export interface ShadowedBy {
	/** 'precache' or a route id. */
	by: string
	count: number
}

export interface RouteSummary {
	routeId: string
	/** Requests this route handled. */
	count: number
	transferBytes: number
	/** Requests it would have matched had no earlier route taken them. */
	shadowedCount: number
	shadowedBy: ShadowedBy[]
}

export interface GroupSummary {
	count: number
	transferBytes: number
}

export interface PrecacheEntryResult {
	/** Absolute URL. */
	url: string
	/** Requests answered from this entry. */
	requestIndexes: number[]
	/** null when neither the config nor the HAR gives a size. */
	size: number | null
	sizeSource: 'config' | 'har' | 'near-match' | 'unknown'
	/** Requests for the same path that missed the entry because of their query string. */
	nearMisses: number[]
}

export interface PrecacheSummary extends GroupSummary {
	entries: PrecacheEntryResult[]
	/** Sum of the entry sizes that are known. */
	knownBytes: number
	unknownSizeCount: number
}

export interface CacheSummary {
	cacheName: string
	/** Distinct URLs written on this load. */
	entries: number
	bytes: number
	opaqueEntries: number
	/** The smallest max-entries setting among the handlers using the cache. */
	maxEntries: number | null
	exceedsMaxEntries: boolean
	/** Route ids, plus 'default' and 'precache' where they apply. */
	usedBy: string[]
}

export type WarningCode =
	| 'dead-route'
	| 'mixed-content-types'
	| 'opaque-to-cors'
	| 'opaque-cached'
	| 'precache-never-requested'
	| 'precache-weight'
	| 'range-on-caching-route'
	| 'unhashed-cache-first'
	| 'worker-script-cached'

export interface Warning {
	code: WarningCode
	/** One sentence on what is wrong and what it costs. */
	message: string
	/** The route responsible, or 'default' / 'precache'. */
	routeId?: string
	/** The requests that triggered it. */
	requestIndexes: number[]
	/** Precache entries involved, as absolute URLs. */
	precacheUrls?: string[]
}

export interface ConfigProblem {
	routeId?: string
	message: string
}

export interface SimulationResult {
	/** Parallel to ParsedHar.requests. */
	requests: RequestResult[]
	/** Parallel to Config.routes. */
	routes: RouteSummary[]
	precache: PrecacheSummary
	defaultHandler: GroupSummary
	/** Requests the worker leaves alone. */
	network: GroupSummary
	caches: CacheSummary[]
	warnings: Warning[]
	/** Things wrong with the config itself, such as an invalid pattern. */
	configProblems: ConfigProblem[]
}
