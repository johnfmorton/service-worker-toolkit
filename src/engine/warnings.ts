// The nine warnings. Each is a rule over a finished simulation; none of them
// changes where a request goes.

import { PRECACHE_DEFAULTS, usesCache } from './defaults.ts'
import type { Facts } from './matcher.ts'
import type { Config, Handler, SimulationResult, Warning } from './types.ts'
import { looksVersioned } from './versioning.ts'

export interface WarningContext {
	config: Config
	/** Parallel to result.requests. */
	facts: Facts[]
	result: SimulationResult
	workerUrl: URL | null
	/** Per route: the requests it lost, keyed by what took them ('precache' or a route id). */
	shadowed: Map<string, number[]>[]
}

interface Group {
	/** A route id, 'default' or 'precache'. */
	id: string
	/** How to name it in a sentence. */
	label: string
	handler: Handler | null
	requests: number[]
}

export function formatBytes(bytes: number): string {
	if (bytes < 1000) return `${bytes} B`
	if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`
	return `${(bytes / 1_000_000).toFixed(1)} MB`
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** Requests grouped by the handler that took them, in config order. */
function groupByHandler({ config, result }: WarningContext): Group[] {
	const precache: Group = { id: 'precache', label: 'The precache', handler: null, requests: [] }
	const fallback: Group = { id: 'default', label: 'The default handler', handler: config.defaultHandler, requests: [] }
	const routes = new Map<string, Group>(config.routes.map((route) => [
		route.id,
		{ id: route.id, label: `Route "${route.name}"`, handler: route, requests: [] },
	]))
	for (const request of result.requests) {
		const by = request.handledBy
		if (by.kind === 'precache') precache.requests.push(request.index)
		else if (by.kind === 'default') fallback.requests.push(request.index)
		else if (by.kind === 'route') routes.get(by.routeId)?.requests.push(request.index)
	}
	return [precache, ...routes.values(), fallback]
}

function deadRoutes(ctx: WarningContext, out: Warning[]): void {
	const names = new Map(ctx.config.routes.map((route) => [route.id, `"${route.name}"`]))
	names.set('precache', 'the precache')
	ctx.config.routes.forEach((route, i) => {
		const lost = ctx.shadowed[i]
		if (!lost || lost.size === 0 || ctx.result.routes[i]?.count !== 0) return
		const requests = [...lost.values()].flat().sort((a, b) => a - b)
		const takers = [...lost.keys()].map((id) => names.get(id) ?? id).join(' and ')
		out.push({
			code: 'dead-route',
			routeId: route.id,
			requestIndexes: requests,
			message: `Route "${route.name}" never runs: ${requests.length === 1 ? 'the 1 request' : `all ${requests.length} requests`} it matches ${requests.length === 1 ? 'is' : 'are'} taken first by ${takers}, so its strategy and cache are never used.`,
		})
	})
}

const DOCUMENTS = new Set(['document', 'iframe', 'frame'])

function mixedContentTypes(ctx: WarningContext, groups: Group[], out: Warning[]): void {
	for (const group of groups) {
		if (!group.handler || !usesCache(group.handler.strategy)) continue
		let documents = 0
		const subresources: number[] = []
		const kinds = new Set<string>()
		for (const i of group.requests) {
			const destination = ctx.facts[i]?.request.destination
			if (destination === undefined || destination === 'unknown') continue
			if (DOCUMENTS.has(destination)) {
				documents++
			} else {
				subresources.push(i)
				kinds.add(destination === 'empty' ? 'fetch' : destination)
			}
		}
		if (documents === 0 || subresources.length === 0) continue
		out.push({
			code: 'mixed-content-types',
			routeId: group.id,
			requestIndexes: subresources,
			message: `${group.label} handles ${plural(documents, 'page')} and ${plural(subresources.length, 'subresource')} (${[...kinds].join(', ')}) with one strategy, and they share the cache "${group.handler.cacheName}" and its limits.`,
		})
	}
}

function opaqueToCors(ctx: WarningContext, groups: Group[], out: Warning[]): void {
	for (const group of groups) {
		if (group.handler?.options?.fetchMode !== 'no-cors') continue
		const requests = group.requests.filter((i) => {
			const f = ctx.facts[i]
			return f !== undefined && !f.sameOrigin && f.request.mode === 'cors'
		})
		if (requests.length === 0) continue
		out.push({
			code: 'opaque-to-cors',
			routeId: group.id,
			requestIndexes: requests,
			message: `${group.label} forces no-cors, which produces opaque responses, but ${plural(requests.length, 'request')} it handles ${requests.length === 1 ? 'was' : 'were'} made in CORS mode: the browser refuses an opaque response to a CORS request, so ${requests.length === 1 ? 'it' : 'they'} would fail.`,
		})
	}
}

function opaqueCached(ctx: WarningContext, groups: Group[], out: Warning[]): void {
	for (const group of groups) {
		if (!group.handler) continue
		const requests = group.requests.filter((i) => {
			const r = ctx.result.requests[i]
			return r !== undefined && r.opaque && r.cached
		})
		if (requests.length === 0) continue
		out.push({
			code: 'opaque-cached',
			routeId: group.id,
			requestIndexes: requests,
			message: `${group.label} caches ${plural(requests.length, 'opaque response')} in "${group.handler.cacheName}": the worker cannot tell whether an opaque response is an error, and browsers pad each one heavily against the storage quota (about 7 MB each in Chrome).`,
		})
	}
}

function precacheNeverRequested(ctx: WarningContext, out: Warning[]): void {
	const missed = ctx.result.precache.entries.filter((entry) => entry.requestIndexes.length === 0 && entry.nearMisses.length > 0)
	if (missed.length === 0) return
	const bytes = missed.reduce((sum, entry) => sum + (entry.size ?? 0), 0)
	out.push({
		code: 'precache-never-requested',
		routeId: 'precache',
		requestIndexes: [...new Set(missed.flatMap((entry) => entry.nearMisses))].sort((a, b) => a - b),
		precacheUrls: missed.map((entry) => entry.url),
		message: `${plural(missed.length, 'precached file')} ${missed.length === 1 ? 'is' : 'are'} never used: the page requests the same ${missed.length === 1 ? 'path' : 'paths'} with a query string, which does not match the precached URL, so every visitor downloads ${bytes > 0 ? formatBytes(bytes) : 'the files'} for nothing and the real requests go elsewhere.`,
	})
}

function precacheWeight(ctx: WarningContext, out: Warning[]): void {
	const { entries, knownBytes, unknownSizeCount } = ctx.result.precache
	const budget = ctx.config.precache.budgetBytes ?? PRECACHE_DEFAULTS.budgetBytes
	if (knownBytes <= budget) return
	const largest = entries
		.filter((entry) => entry.size !== null)
		.sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
		.slice(0, 5)
	const top = largest.slice(0, 3).map((entry) => `${new URL(entry.url).pathname} (${formatBytes(entry.size ?? 0)})`).join(', ')
	out.push({
		code: 'precache-weight',
		routeId: 'precache',
		requestIndexes: [],
		precacheUrls: largest.map((entry) => entry.url),
		message: `The precache is ${formatBytes(knownBytes)}${unknownSizeCount > 0 ? `, plus ${plural(unknownSizeCount, 'file')} of unknown size` : ''}, over the ${formatBytes(budget)} budget. Every visitor downloads all of it on their first visit. Largest: ${top}.`,
	})
}

function rangeOnCachingRoute(ctx: WarningContext, groups: Group[], out: Warning[]): void {
	for (const group of groups) {
		// The precache has no handler of its own but is a cache all the same.
		if (group.handler ? !usesCache(group.handler.strategy) : group.id !== 'precache') continue
		const requests = group.requests.filter((i) => {
			const request = ctx.facts[i]?.request
			return request !== undefined && (request.hasRange || request.destination === 'audio' || request.destination === 'video')
		})
		if (requests.length === 0) continue
		out.push({
			code: 'range-on-caching-route',
			routeId: group.id,
			requestIndexes: requests,
			message: `${group.label} answers ${plural(requests.length, 'media or Range request')} from a cache: audio and video ask for byte ranges, and a plain caching strategy returns the whole file instead, which breaks seeking and, in Safari, playback.`,
		})
	}
}

function unhashedCacheFirst(ctx: WarningContext, groups: Group[], out: Warning[]): void {
	for (const group of groups) {
		if (group.handler?.strategy !== 'cache-first') continue
		const requests = group.requests.filter((i) => {
			const f = ctx.facts[i]
			return f !== undefined && !looksVersioned(f.url)
		})
		if (requests.length === 0) continue
		out.push({
			code: 'unhashed-cache-first',
			routeId: group.id,
			requestIndexes: requests,
			message: `${group.label} is cache-first and handles ${plural(requests.length, 'file')} with no content hash or version in the URL: once cached, a changed file is not fetched again until the entry expires.`,
		})
	}
}

function maxAge(header: string | undefined, directive: string): number | null {
	if (header === undefined) return null
	const match = new RegExp(`(?:^|[,\\s])${directive}\\s*=\\s*"?(\\d+)`, 'i').exec(header)
	return match?.[1] === undefined ? null : Number(match[1])
}

/** How long, in seconds, a response may be reused by a browser or a CDN. */
export function cacheLifetime(headers: Record<string, string>): { browser: number, shared: number, servedFromCache: boolean } {
	const cacheControl = headers['cache-control']
	const uncacheable = cacheControl !== undefined && /\bno-(store|cache)\b/i.test(cacheControl)

	let browser = maxAge(cacheControl, 'max-age')
	if (browser === null && headers.expires !== undefined) {
		const expires = Date.parse(headers.expires)
		const date = headers.date === undefined ? NaN : Date.parse(headers.date)
		if (!Number.isNaN(expires) && !Number.isNaN(date)) browser = Math.max(0, (expires - date) / 1000)
	}
	if (uncacheable) browser = 0

	const isPrivate = cacheControl !== undefined && /\bprivate\b/i.test(cacheControl)
	const sharedDefault = uncacheable || isPrivate ? 0 : browser ?? 0
	const shared = Math.max(
		maxAge(cacheControl, 's-maxage') ?? sharedDefault,
		maxAge(headers['cdn-cache-control'], 'max-age') ?? 0,
		maxAge(headers['cloudflare-cdn-cache-control'], 'max-age') ?? 0,
		maxAge(headers['surrogate-control'], 'max-age') ?? 0,
	)

	const servedFromCache = Number(headers.age ?? 0) > 0
		|| /\bHIT\b/i.test(headers['cf-cache-status'] ?? '')
		|| /\bHIT\b/i.test(headers['x-cache'] ?? '')

	return { browser: browser ?? 0, shared, servedFromCache }
}

function formatDuration(seconds: number): string {
	if (seconds >= 86_400) return plural(Math.round(seconds / 86_400), 'day')
	if (seconds >= 3600) return plural(Math.round(seconds / 3600), 'hour')
	if (seconds >= 60) return plural(Math.round(seconds / 60), 'minute')
	return plural(Math.round(seconds), 'second')
}

function workerScriptCached(ctx: WarningContext, out: Warning[]): void {
	const workerPath = ctx.workerUrl ? ctx.workerUrl.origin + ctx.workerUrl.pathname : null
	for (const f of ctx.facts) {
		if (!f.request.isWorkerScript && f.url.origin + f.url.pathname !== workerPath) continue
		const { browser, shared, servedFromCache } = cacheLifetime(f.request.cacheHeaders)
		const lifetime = Math.max(browser, shared)
		if (lifetime <= 0 && !servedFromCache) continue
		const evidence = lifetime > 0
			? `is served with a cache lifetime of ${formatDuration(lifetime)}`
			: 'was served from a cache'
		out.push({
			code: 'worker-script-cached',
			requestIndexes: [f.request.index],
			message: `The worker script ${f.url.pathname} ${evidence}: a CDN or proxy can keep handing browsers the old worker after a deploy, so a fix does not reach visitors until the copy expires.`,
		})
	}
}

export function findWarnings(ctx: WarningContext): Warning[] {
	const groups = groupByHandler(ctx)
	const out: Warning[] = []
	deadRoutes(ctx, out)
	mixedContentTypes(ctx, groups, out)
	opaqueToCors(ctx, groups, out)
	opaqueCached(ctx, groups, out)
	precacheNeverRequested(ctx, out)
	precacheWeight(ctx, out)
	rangeOnCachingRoute(ctx, groups, out)
	unhashedCacheFirst(ctx, groups, out)
	workerScriptCached(ctx, out)
	return out
}
