import { describe, expect, it } from 'vitest'
import { warningFixtures } from '../fixtures/warnings/index.ts'
import { cacheLifetime } from '../src/engine/index.ts'
import type { WarningCode } from '../src/engine/index.ts'
import { codes, paths, run } from './helpers.ts'

describe.each(Object.keys(warningFixtures) as WarningCode[])('%s', (code) => {
	it('is raised by its triggering fixture', () => {
		expect(codes(run(warningFixtures[code].triggering).result)).toContain(code)
	})

	it('is not raised by its clean fixture', () => {
		const { result } = run(warningFixtures[code].clean)
		expect(codes(result)).not.toContain(code)
		expect(result.configProblems).toEqual([])
	})
})

describe('warning details', () => {
	const only = (code: WarningCode) => {
		const { har, result } = run(warningFixtures[code].triggering)
		const found = result.warnings.filter((warning) => warning.code === code)
		expect(found).toHaveLength(1)
		const warning = found[0]
		if (!warning) throw new Error('unreachable')
		return { har, result, warning }
	}

	it('dead route: names the dead route, the route that took its requests, and the requests', () => {
		const { har, result, warning } = only('dead-route')
		expect(warning.routeId).toBe('cdn-images')
		expect(warning.message).toContain('"CDN images" never runs')
		expect(warning.message).toContain('taken first by "Pages"')
		expect(paths(har, warning.requestIndexes)).toEqual(['/images/hero-3fa9c21b.jpg', '/images/thumb-9b1e44d0.jpg'])
		expect(result.routes[1]).toEqual({
			routeId: 'cdn-images', count: 0, transferBytes: 0, shadowedCount: 2, shadowedBy: [{ by: 'pages', count: 2 }],
		})
	})

	it('dead route: links the warning from the request rows', () => {
		const { result, warning } = only('dead-route')
		const w = result.warnings.indexOf(warning)
		for (const i of warning.requestIndexes) expect(result.requests[i]?.warnings).toContain(w)
	})

	it('mixed content types: points at the subresources in the page cache', () => {
		const { har, warning } = only('mixed-content-types')
		expect(warning.routeId).toBe('pages')
		expect(paths(har, warning.requestIndexes)).toEqual(['/dist/assets/app-D4f8a1Zc.js', '/static/fonts/Body.woff2'])
	})

	it('opaque to CORS: points at the CORS request only', () => {
		const { har, warning } = only('opaque-to-cors')
		expect(paths(har, warning.requestIndexes)).toEqual(['/images/shade-7c2d91aa.jpg'])
	})

	it('opaque cached: counts the opaque entries in the cache summary', () => {
		const { result, warning } = only('opaque-cached')
		expect(warning.requestIndexes).toEqual([1])
		expect(result.caches[0]).toMatchObject({ cacheName: 'static-cache', entries: 1, opaqueEntries: 1 })
	})

	it('precache never requested: names the entry, the near miss, and the wasted bytes', () => {
		const { har, warning } = only('precache-never-requested')
		expect(warning.precacheUrls).toEqual(['https://example.com/static/fonts/Body.woff2'])
		expect(har.requests[warning.requestIndexes[0] ?? -1]?.url).toBe('https://example.com/static/fonts/Body.woff2?v=1.0')
		expect(warning.message).toContain('27 KB')
	})

	it('precache weight: gives the total and lists the largest entries first', () => {
		const { warning } = only('precache-weight')
		expect(warning.message).toContain('536 KB')
		expect(warning.precacheUrls?.[0]).toBe('https://example.com/static/fonts/Display.woff2')
	})

	it('range: points at the media request', () => {
		const { har, warning } = only('range-on-caching-route')
		expect(paths(har, warning.requestIndexes)).toEqual(['/audio/episode-12.mp3'])
	})

	it('unhashed cache-first: points at the favicon, not the hashed build files', () => {
		const { har, warning } = only('unhashed-cache-first')
		expect(paths(har, warning.requestIndexes)).toEqual(['/dist/assets/favicons/favicon-32x32.png'])
	})

	it('worker script cached: reports the lifetime', () => {
		const { warning } = only('worker-script-cached')
		expect(warning.message).toContain('/sw.js is served with a cache lifetime of 4 hours')
	})
})

describe('cacheLifetime', () => {
	it.each([
		[{ 'cache-control': 'max-age=600' }, { browser: 600, shared: 600 }],
		[{ 'cache-control': 'private, max-age=600' }, { browser: 600, shared: 0 }],
		[{ 'cache-control': 'max-age=0, s-maxage=14400' }, { browser: 0, shared: 14_400 }],
		[{ 'cache-control': 'no-cache, max-age=600' }, { browser: 0, shared: 0 }],
		[{ 'cache-control': 'no-store', 'cdn-cache-control': 'max-age=300' }, { browser: 0, shared: 300 }],
		[{ expires: 'Sat, 21 Nov 2026 13:00:00 GMT', date: 'Sat, 21 Nov 2026 12:00:00 GMT' }, { browser: 3600, shared: 3600 }],
		[{}, { browser: 0, shared: 0 }],
	])('%j', (headers, expected) => {
		expect(cacheLifetime(headers)).toMatchObject(expected)
	})

	it('treats Age and a cache HIT as proof of a shared cache', () => {
		expect(cacheLifetime({ age: '12' }).servedFromCache).toBe(true)
		expect(cacheLifetime({ 'cf-cache-status': 'HIT' }).servedFromCache).toBe(true)
		expect(cacheLifetime({ 'cf-cache-status': 'DYNAMIC' }).servedFromCache).toBe(false)
	})
})
