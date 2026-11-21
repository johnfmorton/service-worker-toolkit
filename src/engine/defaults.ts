// Matching defaults. This is the one place in the engine that encodes a
// specific library's behaviour; everything else is generic.
//
// These values model Workbox, read from the 7.4.1 source on 21 November 2026:
//
// - workbox-routing/utils/constants: routes handle GET unless told otherwise.
// - workbox-routing/Router: non-http(s) URLs are never routed; routes for the
//   request's method are tried in registration order and the first match wins;
//   with no match the default handler for that method runs, and with no
//   default handler the worker does not respond at all.
// - workbox-precaching/utils/generateURLVariations: a request is looked up in
//   the precache as (1) the URL minus its hash, (2) minus ignored query
//   parameters, (3) plus the directory index if the path ends in '/',
//   (4) plus '.html'. Any other query string makes the lookup miss.
// - workbox-strategies: network-first and stale-while-revalidate cache
//   statuses 0 and 200 by default; every other strategy caches 200 only.

import type { Strategy } from './types.ts'

export const DEFAULT_METHOD = 'GET'

/**
 * workbox-strategies/StrategyHandler passes a strategy's fetch options to
 * fetch() for every request except navigations, which keep their own.
 */
export const FETCH_OPTIONS_APPLY_TO_NAVIGATIONS = false

export const PRECACHE_DEFAULTS = {
	ignoreParams: ['^utm_', '^fbclid$'],
	directoryIndex: 'index.html' as string | null,
	cleanUrls: true,
	/** Not a library default: this tool's own threshold for the weight warning. */
	budgetBytes: 500_000,
}

export const PRECACHE_CACHE_NAME = 'precache'

export const DEFAULT_WORKER_SCRIPT = '/sw.js'

export function defaultCacheableStatuses(strategy: Strategy): number[] {
	return strategy === 'network-first' || strategy === 'stale-while-revalidate'
		? [0, 200]
		: [200]
}

/** Strategies that read from or write to a cache. */
export function usesCache(strategy: Strategy): boolean {
	return strategy !== 'network-only'
}

/** Strategies that write network responses to a cache. */
export function writesCache(strategy: Strategy): boolean {
	return strategy !== 'network-only' && strategy !== 'cache-only'
}
