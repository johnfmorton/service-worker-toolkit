import { describe, expect, it } from 'vitest'
import { CDN, ORIGIN, buildHar, config, page, route } from '../fixtures/har-builder.ts'
import type { Config, HandledBy } from '../src/engine/index.ts'
import type { RequestSpec } from '../fixtures/har-builder.ts'
import { run } from './helpers.ts'

const handledBy = (specs: RequestSpec[], cfg: Config): HandledBy[] =>
	run({ har: buildHar(`${ORIGIN}/`, specs), config: cfg }).result.requests.map((r) => r.handledBy)

const swr = { strategy: 'stale-while-revalidate', cacheName: 'c' } as const

describe('matching order', () => {
	it('gives a request to the first route that matches, in registration order', () => {
		const result = handledBy(
			[page(), { url: `${CDN}/a.jpg`, dest: 'image', mode: 'no-cors' }],
			config({
				routes: [
					route('images', { ...swr, conditions: [{ type: 'destination', value: ['image'] }] }),
					route('everything', { ...swr }),
				],
			}),
		)
		expect(result).toEqual([
			{ kind: 'route', routeId: 'everything' },
			{ kind: 'route', routeId: 'images' },
		])
	})

	it('routes only GET unless a route names another method', () => {
		const post: RequestSpec = { url: `${ORIGIN}/api`, method: 'POST', dest: 'empty', mode: 'cors' }
		expect(handledBy([post], config({ routes: [route('all', { ...swr })] })))
			.toEqual([{ kind: 'network', reason: 'method' }])
		expect(handledBy([post], config({ routes: [route('posts', { ...swr, method: 'POST' })] })))
			.toEqual([{ kind: 'route', routeId: 'posts' }])
	})

	it('answers precached URLs from the precache before any route', () => {
		const result = handledBy(
			[page(), { url: `${ORIGIN}/app.js`, dest: 'script', mode: 'cors' }],
			config({ precache: { entries: [{ url: 'app.js', revision: '1' }] }, routes: [route('all', { ...swr })] }),
		)
		expect(result).toEqual([
			{ kind: 'route', routeId: 'all' },
			{ kind: 'precache', entryUrl: `${ORIGIN}/app.js` },
		])
	})

	it('sends unmatched GET requests to the default handler, or to the network without one', () => {
		const specs = [page(), { url: `${ORIGIN}/api`, method: 'POST', dest: 'empty', mode: 'cors' }]
		expect(handledBy(specs, config())).toEqual([
			{ kind: 'network', reason: 'unmatched' },
			{ kind: 'network', reason: 'method' },
		])
		expect(handledBy(specs, config({ defaultHandler: { strategy: 'network-only', cacheName: '' } }))).toEqual([
			{ kind: 'default' },
			{ kind: 'network', reason: 'method' },
		])
	})

	it('leaves non-http requests and the worker script to the browser', () => {
		const result = handledBy(
			[
				{ url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', dest: 'image', mode: 'no-cors' },
				{ url: `${ORIGIN}/sw.js`, dest: 'serviceworker', mode: 'same-origin' },
			],
			config({ routes: [route('all', { ...swr })] }),
		)
		expect(result).toEqual([
			{ kind: 'network', reason: 'not-http' },
			{ kind: 'network', reason: 'worker-script' },
		])
	})
})

describe('conditions', () => {
	const specs: RequestSpec[] = [
		page('/blog/post?utm=x'),
		{ url: `${ORIGIN}/dist/app.js`, dest: 'script', mode: 'cors' },
		{ url: `${CDN}/dist/photo.jpg`, dest: 'image', mode: 'no-cors' },
	]
	const matched = (conditions: Config['routes'][number]['conditions']) =>
		handledBy(specs, config({ routes: [route('r', { ...swr, conditions })] })).map((by) => by.kind === 'route')

	it('same-origin', () => expect(matched([{ type: 'same-origin' }])).toEqual([true, true, false]))
	it('origin', () => expect(matched([{ type: 'origin', value: `${CDN}/` }])).toEqual([false, false, true]))
	it('path-prefix', () => expect(matched([{ type: 'path-prefix', value: '/dist/' }])).toEqual([false, true, true]))
	it('path-pattern', () => expect(matched([{ type: 'path-pattern', value: '\\.(js|css)$' }])).toEqual([false, true, false]))
	it('query-param', () => expect(matched([{ type: 'query-param', value: 'utm' }])).toEqual([true, false, false]))
	it('destination', () => expect(matched([{ type: 'destination', value: ['script', 'image'] }])).toEqual([false, true, true]))
	it('mode', () => expect(matched([{ type: 'mode', value: ['navigate'] }])).toEqual([true, false, false]))
	it('negation', () => expect(matched([{ type: 'same-origin', negate: true }])).toEqual([false, false, true]))
	it('all conditions must hold', () => {
		expect(matched([{ type: 'path-prefix', value: '/dist/' }, { type: 'same-origin' }])).toEqual([false, true, false])
	})

	it('reports an invalid pattern and matches nothing with it', () => {
		const { result } = run({
			har: buildHar(`${ORIGIN}/`, specs),
			config: config({ routes: [route('bad', { ...swr, conditions: [{ type: 'path-pattern', value: '(' }] })] }),
		})
		expect(result.routes[0]?.count).toBe(0)
		expect(result.configProblems).toEqual([expect.objectContaining({ routeId: 'bad' })])
	})
})

describe('precache lookup', () => {
	const lookup = (requestUrl: string, entry: string, precache = {}) =>
		handledBy([{ url: requestUrl, dest: 'empty', mode: 'cors' }], config({ precache: { entries: [{ url: entry }], ...precache } }))[0]?.kind === 'precache'

	it('ignores the hash', () => expect(lookup(`${ORIGIN}/a.css#x`, '/a.css')).toBe(true))
	it('ignores utm_ and fbclid parameters by default', () => {
		expect(lookup(`${ORIGIN}/a.css?utm_source=x&fbclid=y`, '/a.css')).toBe(true)
	})
	it('does not ignore any other query string', () => expect(lookup(`${ORIGIN}/a.woff2?v=1.0`, '/a.woff2')).toBe(false))
	it('can be told to ignore more parameters', () => {
		expect(lookup(`${ORIGIN}/a.woff2?v=1.0`, '/a.woff2', { ignoreParams: ['^v$'] })).toBe(true)
	})
	it('tries the directory index', () => {
		expect(lookup(`${ORIGIN}/docs/`, '/docs/index.html')).toBe(true)
		expect(lookup(`${ORIGIN}/docs/`, '/docs/index.html', { directoryIndex: null })).toBe(false)
	})
	it('tries a clean URL', () => {
		expect(lookup(`${ORIGIN}/about`, '/about.html')).toBe(true)
		expect(lookup(`${ORIGIN}/about`, '/about.html', { cleanUrls: false })).toBe(false)
	})
	it('matches an entry that has its own query string exactly', () => {
		expect(lookup(`${ORIGIN}/a.woff2?v=1.0`, '/a.woff2?v=1.0')).toBe(true)
	})
})

describe('caching outcome', () => {
	it('summarises each cache and flags one that overflows its limit in a single load', () => {
		const { result } = run({
			har: buildHar(`${ORIGIN}/`, [
				page(),
				{ url: `${CDN}/a.jpg`, dest: 'image', mode: 'cors', size: 100 },
				{ url: `${CDN}/b.jpg`, dest: 'image', mode: 'cors', size: 200 },
				{ url: `${CDN}/b.jpg`, dest: 'image', mode: 'cors', size: 200 },
				{ url: `${CDN}/missing.jpg`, dest: 'image', mode: 'cors', status: 404 },
			]),
			config: config({
				routes: [route('images', { strategy: 'cache-first', cacheName: 'images', options: { maxEntries: 1 }, conditions: [{ type: 'origin', value: CDN }] })],
			}),
		})
		expect(result.caches).toEqual([{
			cacheName: 'images', entries: 2, bytes: 300, opaqueEntries: 0, maxEntries: 1, exceedsMaxEntries: true, usedBy: ['images'],
		}])
		expect(result.routes[0]).toMatchObject({ count: 4, transferBytes: 100 + 200 + 200 + 1000 + 4 * 300 })
		expect(result.network).toEqual({ count: 1, transferBytes: 18_300 })
	})

	it('does not apply a forced fetch mode to navigations', () => {
		const { result } = run({
			har: buildHar(`${ORIGIN}/`, [{ url: `${CDN}/page`, dest: 'document', mode: 'navigate', type: 'text/html' }]),
			config: config({ routes: [route('all', { strategy: 'network-first', cacheName: 'c', options: { fetchMode: 'no-cors' } })] }),
		})
		expect(result.requests[0]).toMatchObject({ opaque: false, cached: true })
	})
})
