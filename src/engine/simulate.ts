// The simulation: for every request, which handler would answer it and what
// would end up in which cache. Pure: no DOM, no network, no storage.

import {
	DEFAULT_METHOD,
	DEFAULT_WORKER_SCRIPT,
	FETCH_OPTIONS_APPLY_TO_NAVIGATIONS,
	PRECACHE_CACHE_NAME,
	defaultCacheableStatuses,
	usesCache,
	writesCache,
} from './defaults.ts'
import { compileConditions, type Facts } from './matcher.ts'
import { buildPrecacheIndex, lookupPrecache, pathKey } from './precache.ts'
import type {
	CacheSummary,
	Config,
	ConfigProblem,
	Handler,
	ParsedHar,
	PrecacheEntryResult,
	RequestResult,
	RouteSummary,
	SimulationResult,
} from './types.ts'
import { findWarnings } from './warnings.ts'

interface CacheTally {
	urls: Map<string, number>
	opaque: Set<string>
	maxEntries: number | null
	usedBy: Set<string>
}

function isHttp(url: URL): boolean {
	return url.protocol === 'http:' || url.protocol === 'https:'
}

/** What a caching strategy would see and do with one response. */
function outcome(handler: Handler, facts: Facts): { cached: boolean, opaque: boolean } {
	const { request } = facts
	const forced = FETCH_OPTIONS_APPLY_TO_NAVIGATIONS || request.mode !== 'navigate'
		? handler.options?.fetchMode
		: undefined
	const opaque = !facts.sameOrigin && (forced ?? request.mode) === 'no-cors'
	// A HAR status of 0 is a request that failed. A 304 is the browser
	// revalidating its own HTTP cache; the worker's fetch would see the 200.
	const status = opaque ? 0 : request.status === 304 ? 200 : request.status
	const statuses = handler.options?.cacheableStatuses ?? defaultCacheableStatuses(handler.strategy)
	const cached = writesCache(handler.strategy) && request.status !== 0 && statuses.includes(status)
	return { cached, opaque }
}

export function simulate(har: ParsedHar, config: Config): SimulationResult {
	const configProblems: ConfigProblem[] = []

	let origin = config.origin
	if (URL.canParse(config.origin)) origin = new URL(config.origin).origin
	else configProblems.push({ message: `The site origin is not a valid URL: ${config.origin}` })

	const workerScript = config.workerScript ?? DEFAULT_WORKER_SCRIPT
	const workerUrl = URL.canParse(workerScript, origin) ? new URL(workerScript, origin) : null
	const precacheIndex = buildPrecacheIndex(config.precache, workerUrl?.href ?? origin, configProblems)

	const routes = config.routes.map((route) => ({
		route,
		method: (route.method ?? DEFAULT_METHOD).toUpperCase(),
		matches: compileConditions(route.conditions, configProblems, route.id),
		// Requests this route would have matched, keyed by what took them first.
		shadowed: new Map<string, number[]>(),
	}))
	const methods = new Set(routes.map((r) => r.method))

	const routeSummaries: RouteSummary[] = config.routes.map((route) => ({
		routeId: route.id, count: 0, transferBytes: 0, shadowedCount: 0, shadowedBy: [],
	}))
	const precacheEntries: PrecacheEntryResult[] = config.precache.entries.map((entry, i) => ({
		url: precacheIndex.urls[i] ?? entry.url,
		requestIndexes: [],
		size: entry.size ?? null,
		sizeSource: entry.size === undefined ? 'unknown' : 'config',
		nearMisses: [],
	}))
	const precache = { count: 0, transferBytes: 0 }
	const defaultHandler = { count: 0, transferBytes: 0 }
	const network = { count: 0, transferBytes: 0 }

	const caches = new Map<string, CacheTally>()
	const cacheFor = (handler: Handler, user: string): CacheTally => {
		let tally = caches.get(handler.cacheName)
		if (!tally) {
			tally = { urls: new Map(), opaque: new Set(), maxEntries: null, usedBy: new Set() }
			caches.set(handler.cacheName, tally)
		}
		tally.usedBy.add(user)
		const max = handler.options?.maxEntries
		if (max !== undefined) tally.maxEntries = Math.min(tally.maxEntries ?? max, max)
		return tally
	}
	// Register every cache up front, so one that receives nothing still shows.
	for (const route of config.routes) if (usesCache(route.strategy)) cacheFor(route, route.id)
	if (config.defaultHandler && usesCache(config.defaultHandler.strategy)) cacheFor(config.defaultHandler, 'default')

	const facts: Facts[] = []
	const results: RequestResult[] = har.requests.map((request, index) => {
		const url = new URL(request.url)
		const f: Facts = { request, url, sameOrigin: url.origin === origin }
		facts.push(f)
		const result: RequestResult = {
			index, handledBy: { kind: 'network', reason: 'unmatched' },
			strategy: null, cacheName: null, cached: false, opaque: false, warnings: [],
		}

		// A worker never sees non-http requests, nor the fetch of a worker script.
		if (!isHttp(url) || request.isWorkerScript) {
			result.handledBy = { kind: 'network', reason: isHttp(url) ? 'worker-script' : 'not-http' }
			network.count++
			network.transferBytes += request.transferSize
			return result
		}

		let winner: string | null = null
		const take = (handler: Handler, user: string) => {
			result.strategy = handler.strategy
			result.cacheName = usesCache(handler.strategy) ? handler.cacheName : null
			const { cached, opaque } = outcome(handler, f)
			result.cached = cached
			result.opaque = opaque
			if (cached) {
				const tally = cacheFor(handler, user)
				tally.urls.set(request.url, request.bodySize || request.transferSize)
				if (opaque) tally.opaque.add(request.url)
			}
		}

		// The precache is registered first, as an ordinary route for the default method.
		if (request.method === DEFAULT_METHOD) {
			const position = lookupPrecache(precacheIndex, url)
			const entry = precacheEntries[position]
			if (entry) {
				winner = 'precache'
				result.handledBy = { kind: 'precache', entryUrl: entry.url }
				result.strategy = 'cache-first'
				result.cacheName = PRECACHE_CACHE_NAME
				entry.requestIndexes.push(index)
				if (entry.size === null && request.bodySize > 0) {
					entry.size = request.bodySize
					entry.sizeSource = 'har'
				}
				precache.count++
				precache.transferBytes += request.transferSize
			} else {
				for (const near of precacheIndex.byPath.get(pathKey(url)) ?? []) {
					precacheEntries[near]?.nearMisses.push(index)
				}
			}
		}

		// Every route is evaluated, not just up to the first match, so that the
		// requests a later route lost to an earlier one can be reported.
		routes.forEach((r, i) => {
			if (r.method !== request.method || !r.matches(f)) return
			if (winner === null) {
				winner = r.route.id
				result.handledBy = { kind: 'route', routeId: r.route.id }
				take(r.route, r.route.id)
				const summary = routeSummaries[i]
				if (summary) {
					summary.count++
					summary.transferBytes += request.transferSize
				}
			} else {
				const lost = r.shadowed.get(winner)
				if (lost) lost.push(index)
				else r.shadowed.set(winner, [index])
			}
		})

		if (winner === null) {
			// The default handler, like a route, is registered for the default method.
			if (config.defaultHandler && request.method === DEFAULT_METHOD) {
				result.handledBy = { kind: 'default' }
				take(config.defaultHandler, 'default')
				defaultHandler.count++
				defaultHandler.transferBytes += request.transferSize
			} else {
				if (!methods.has(request.method) && request.method !== DEFAULT_METHOD) {
					result.handledBy = { kind: 'network', reason: 'method' }
				}
				network.count++
				network.transferBytes += request.transferSize
			}
		}

		return result
	})

	routes.forEach((r, i) => {
		const summary = routeSummaries[i]
		if (!summary) return
		for (const [by, lost] of r.shadowed) {
			summary.shadowedBy.push({ by, count: lost.length })
			summary.shadowedCount += lost.length
		}
	})

	// An entry nobody fetched has no size of its own; a near miss is the same
	// file under another query string, so its size is a fair estimate.
	let knownBytes = 0
	let unknownSizeCount = 0
	for (const entry of precacheEntries) {
		if (entry.size === null) {
			const near = entry.nearMisses.map((i) => har.requests[i]?.bodySize ?? 0).find((size) => size > 0)
			if (near !== undefined) {
				entry.size = near
				entry.sizeSource = 'near-match'
			}
		}
		if (entry.size === null) unknownSizeCount++
		else knownBytes += entry.size
	}

	const cacheSummaries: CacheSummary[] = [...caches].map(([cacheName, tally]) => {
		let bytes = 0
		for (const size of tally.urls.values()) bytes += size
		return {
			cacheName,
			entries: tally.urls.size,
			bytes,
			opaqueEntries: tally.opaque.size,
			maxEntries: tally.maxEntries,
			exceedsMaxEntries: tally.maxEntries !== null && tally.urls.size > tally.maxEntries,
			usedBy: [...tally.usedBy],
		}
	})
	if (precacheEntries.length > 0) {
		cacheSummaries.unshift({
			cacheName: PRECACHE_CACHE_NAME,
			entries: precacheEntries.length,
			bytes: knownBytes,
			opaqueEntries: 0,
			maxEntries: null,
			exceedsMaxEntries: false,
			usedBy: ['precache'],
		})
	}

	const result: SimulationResult = {
		requests: results,
		routes: routeSummaries,
		precache: { ...precache, entries: precacheEntries, knownBytes, unknownSizeCount },
		defaultHandler,
		network,
		caches: cacheSummaries,
		warnings: [],
		configProblems,
	}

	result.warnings = findWarnings({
		config,
		facts,
		result,
		workerUrl,
		shadowed: routes.map((r) => r.shadowed),
	})
	result.warnings.forEach((warning, w) => {
		for (const i of warning.requestIndexes) results[i]?.warnings.push(w)
	})

	return result
}
