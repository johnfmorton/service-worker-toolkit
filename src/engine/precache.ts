// Precache lookup: which precache entry, if any, answers a request URL.

import { PRECACHE_DEFAULTS } from './defaults.ts'
import type { ConfigProblem, PrecacheConfig } from './types.ts'

export interface PrecacheIndex {
	/** Absolute entry URLs, parallel to PrecacheConfig.entries. null where the URL was invalid. */
	urls: (string | null)[]
	/** Absolute URL to entry position. */
	byUrl: Map<string, number>
	/** Origin + pathname to entry positions, for spotting near misses. */
	byPath: Map<string, number[]>
	ignoreParams: RegExp[]
	directoryIndex: string | null
	cleanUrls: boolean
}

export function pathKey(url: URL): string {
	return url.origin + url.pathname
}

export function buildPrecacheIndex(precache: PrecacheConfig, baseUrl: string, problems: ConfigProblem[]): PrecacheIndex {
	const index: PrecacheIndex = {
		urls: [],
		byUrl: new Map(),
		byPath: new Map(),
		ignoreParams: [],
		directoryIndex: precache.directoryIndex === undefined ? PRECACHE_DEFAULTS.directoryIndex : precache.directoryIndex,
		cleanUrls: precache.cleanUrls ?? PRECACHE_DEFAULTS.cleanUrls,
	}

	for (const source of precache.ignoreParams ?? PRECACHE_DEFAULTS.ignoreParams) {
		try {
			index.ignoreParams.push(new RegExp(source))
		} catch {
			problems.push({ message: `Invalid precache ignored-parameter pattern: ${source}` })
		}
	}

	precache.entries.forEach((entry, position) => {
		if (!URL.canParse(entry.url, baseUrl)) {
			problems.push({ message: `Invalid precache URL: ${entry.url}` })
			index.urls.push(null)
			return
		}
		const url = new URL(entry.url, baseUrl)
		url.hash = ''
		index.urls.push(url.href)
		if (!index.byUrl.has(url.href)) index.byUrl.set(url.href, position)
		const key = pathKey(url)
		const sharing = index.byPath.get(key)
		if (sharing) sharing.push(position)
		else index.byPath.set(key, [position])
	})

	return index
}

/**
 * The entry position that answers this URL, or -1. Tries, in order: the URL
 * without its hash; without ignored query parameters; with the directory
 * index appended to a trailing '/'; with '.html' appended.
 */
export function lookupPrecache(index: PrecacheIndex, requestUrl: URL): number {
	if (index.byUrl.size === 0) return -1

	const url = new URL(requestUrl.href)
	url.hash = ''
	let found = index.byUrl.get(url.href)
	if (found !== undefined) return found

	for (const name of [...url.searchParams.keys()]) {
		if (index.ignoreParams.some((pattern) => pattern.test(name))) url.searchParams.delete(name)
	}
	found = index.byUrl.get(url.href)
	if (found !== undefined) return found

	if (index.directoryIndex && url.pathname.endsWith('/')) {
		const withIndex = new URL(url.href)
		withIndex.pathname += index.directoryIndex
		found = index.byUrl.get(withIndex.href)
		if (found !== undefined) return found
	}

	if (index.cleanUrls) {
		const withHtml = new URL(url.href)
		withHtml.pathname += '.html'
		found = index.byUrl.get(withHtml.href)
		if (found !== undefined) return found
	}

	return -1
}
