// The acceptance suite: the seven bugs found on a real site in one afternoon,
// against the worker before and after they were fixed.

import { describe, expect, it } from 'vitest'
import { after, before } from '../fixtures/site-before-after.ts'
import { codes, paths, run } from './helpers.ts'

describe('the worker before the fixes', () => {
	const { har, result } = run(before)

	it('raises the dead route, precache and worker script warnings', () => {
		expect(codes(result)).toEqual([
			'dead-route',
			'mixed-content-types',
			'precache-never-requested',
			'precache-weight',
			'range-on-caching-route',
			'worker-script-cached',
		])
	})

	it('bug 1: the CDN route is dead, shadowed by the page route', () => {
		const dead = result.warnings.find((warning) => warning.code === 'dead-route')
		expect(dead?.routeId).toBe('cdn')
		expect(dead?.requestIndexes).toHaveLength(4)
		expect(result.routes.map((r) => r.count)).toEqual([10, 0])
	})

	it('bug 1: scripts, fonts and CDN files all land in the HTML cache', () => {
		const cache = result.caches.find((c) => c.cacheName === 'html-cache')
		// Everything the page route took except the three no-cors CDN files:
		// their responses are opaque, and this route caches status 200 only.
		expect(cache?.entries).toBe(7)
		expect(cache?.usedBy).toEqual(['pages'])
		expect(result.caches.find((c) => c.cacheName === 'static-cache')?.entries).toBe(0)
	})

	it('bug 3: both precached fonts are never used', () => {
		const unused = result.warnings.find((warning) => warning.code === 'precache-never-requested')
		expect(unused?.precacheUrls).toEqual([
			'https://example.com/static/fonts/Body.var.woff2',
			'https://example.com/static/fonts/Display.var.woff2',
		])
		expect(unused?.message).toContain('337 KB')
	})

	it('bug 4: the precache is 603 KB, the display font the largest part', () => {
		expect(result.precache.knownBytes).toBe(603_000)
		const weight = result.warnings.find((warning) => warning.code === 'precache-weight')
		expect(weight?.precacheUrls?.[0]).toBe('https://example.com/static/fonts/Display.var.woff2')
	})

	it('bug 5: the audio file is on a caching route', () => {
		const range = result.warnings.find((warning) => warning.code === 'range-on-caching-route')
		expect(paths(har, range?.requestIndexes ?? [])).toEqual(['/audio/episode-12.mp3'])
	})

	it('bug 7: the worker script is cached for four hours', () => {
		expect(result.warnings.find((warning) => warning.code === 'worker-script-cached')?.message).toContain('4 hours')
	})
})

describe('the worker after the fixes', () => {
	const { har, result } = run(after)

	it('raises none of the warnings the fixes were for', () => {
		// What remains is true of the fixed worker too: CDN images have plain
		// names, so cache-first keeps a replaced image until its entry expires.
		expect(codes(result)).toEqual(['unhashed-cache-first'])
		expect(result.configProblems).toEqual([])
	})

	it('every route runs', () => {
		expect(result.routes.map((r) => [r.routeId, r.count])).toEqual([
			['cdn-images', 3],
			['assets', 2],
			['pages', 1],
		])
	})

	it('media, fonts, favicons and actions are left to the network', () => {
		const untouched = result.requests.filter((r) => r.handledBy.kind === 'default').map((r) => r.index)
		expect(paths(har, untouched)).toEqual([
			'/static/fonts/Body.var.woff2',
			'/static/fonts/Display.var.woff2',
			'/dist/assets/favicons/favicon-32x32.png',
			'/audio/episode-12.mp3',
			'/actions/blog/like-count',
		])
	})

	it('the precache is down to what the offline page needs', () => {
		expect(result.precache.knownBytes).toBe(266_000)
		expect(result.precache.count).toBe(1)
	})
})
