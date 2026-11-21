// The acceptance case: one page load of a small site, against the worker as
// it was before an afternoon of fixes and as it was after.
//
// Modelled by hand on a real site's worker (a Craft CMS blog with a CDN for
// uploads); every URL is a placeholder. The "before" config has the seven
// bugs this tool exists to catch. Bugs 2 and 6 are latent in it: the routes
// that carry them never run.

import { CDN, ORIGIN, buildHar, config, page, route, type RequestSpec, type Scenario } from './har-builder.ts'
import type { Condition, Handler } from '../src/engine/types.ts'

const requests = (workerHeaders: Record<string, string>): RequestSpec[] => [
	page(),
	{ url: `${ORIGIN}/dist/assets/app-B7kq2Xw9.css`, dest: 'style', mode: 'no-cors', type: 'text/css', size: 42_000 },
	{ url: `${ORIGIN}/dist/assets/app-D4f8a1Zc.js`, dest: 'script', mode: 'cors', type: 'text/javascript', size: 96_000 },
	{ url: `${ORIGIN}/static/fonts/Body.var.woff2?v=3.19`, dest: 'font', mode: 'cors', type: 'font/woff2', size: 27_000 },
	{ url: `${ORIGIN}/static/fonts/Display.var.woff2?v=1.0`, dest: 'font', mode: 'cors', type: 'font/woff2', size: 310_000 },
	{ url: `${ORIGIN}/dist/assets/favicons/favicon-32x32.png`, dest: 'image', mode: 'no-cors', type: 'image/png', size: 1200 },
	{ url: `${ORIGIN}/static/grid_pattern_2x.webp`, dest: 'image', mode: 'no-cors', type: 'image/webp', size: 40_000 },
	{ url: `${CDN}/images/hero.jpg`, dest: 'image', mode: 'no-cors', type: 'image/jpeg', size: 180_000 },
	{ url: `${CDN}/images/thumb-1.jpg`, dest: 'image', mode: 'no-cors', type: 'image/jpeg', size: 22_000 },
	// Drawn to a canvas by a web component, so requested with crossorigin="anonymous".
	{ url: `${CDN}/images/shade-sample.jpg`, dest: 'image', mode: 'cors', type: 'image/jpeg', size: 95_000 },
	{ url: `${CDN}/audio/episode-12.mp3`, dest: 'audio', mode: 'no-cors', type: 'audio/mpeg', status: 206, range: true, size: 2_400_000 },
	{ url: `${ORIGIN}/actions/blog/like-count?id=12`, dest: 'empty', mode: 'cors', type: 'application/json', size: 80 },
	{ url: `${ORIGIN}/actions/metrics/hit`, method: 'POST', dest: 'empty', mode: 'cors', type: 'application/json', size: 20 },
	{
		url: `${ORIGIN}/sw.js`,
		dest: 'serviceworker',
		mode: 'same-origin',
		type: 'text/javascript',
		size: 31_000,
		requestHeaders: { 'Service-Worker': 'script' },
		responseHeaders: workerHeaders,
	},
]

const offline = [
	{ url: 'static/grid_pattern_2x.webp', revision: 'bde453' },
	{ url: 'offline-message.html', revision: '000b34', size: 6000 },
	{ url: 'offline-clouds.jpg', revision: 'f73588', size: 220_000 },
]

const notCms: Condition[] = [
	{ type: 'path-prefix', value: '/actions/', negate: true },
	{ type: 'path-prefix', value: '/admin/', negate: true },
	{ type: 'path-prefix', value: '/cpresources/', negate: true },
	{ type: 'query-param', value: 'utm', negate: true },
	{ type: 'query-param', value: 'fbclid', negate: true },
]

const pageHandler: Handler & { name: string } = {
	name: 'Pages',
	strategy: 'network-first',
	cacheName: 'html-cache',
	options: { maxEntries: 100, maxAgeSeconds: 7 * 24 * 60 * 60, purgeOnQuotaError: true, cacheableStatuses: [200] },
}

export const before: Scenario = {
	har: buildHar(`${ORIGIN}/`, requests({ 'Cache-Control': 'public, max-age=14400', 'CF-Cache-Status': 'HIT', 'Age': '5210' })),
	config: config({
		precache: {
			entries: [
				...offline,
				{ url: 'static/fonts/Body.var.woff2', revision: '8dd26c' },
				{ url: 'static/fonts/Display.var.woff2', revision: '4c1f66' },
			],
		},
		routes: [
			// Meant for pages, but matches any URL that is not a CMS path.
			route('pages', { ...pageHandler, conditions: notCms }),
			route('cdn', {
				name: 'CDN files',
				conditions: [{ type: 'origin', value: CDN }],
				strategy: 'cache-first',
				cacheName: 'static-cache',
				options: { fetchMode: 'no-cors', ignoreVary: true, maxEntries: 50, maxAgeSeconds: 30 * 24 * 60 * 60, cacheableStatuses: [0, 200] },
			}),
		],
		defaultHandler: { strategy: 'network-only', cacheName: '' },
	}),
}

export const after: Scenario = {
	har: buildHar(`${ORIGIN}/`, requests({ 'Cache-Control': 'no-cache' })),
	config: config({
		precache: { entries: offline },
		routes: [
			route('cdn-images', {
				name: 'CDN images',
				conditions: [{ type: 'origin', value: CDN }, { type: 'destination', value: ['image'] }],
				strategy: 'cache-first',
				cacheName: 'static-cache',
				options: { fetchMode: 'cors', fetchCredentials: 'omit', ignoreVary: true, maxEntries: 50, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true, cacheableStatuses: [200] },
			}),
			route('assets', {
				name: 'Build files',
				conditions: [
					{ type: 'same-origin' },
					{ type: 'path-prefix', value: '/dist/assets/' },
					{ type: 'path-prefix', value: '/dist/assets/favicons/', negate: true },
				],
				strategy: 'cache-first',
				cacheName: 'asset-cache',
				options: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true, cacheableStatuses: [200] },
			}),
			route('pages', {
				...pageHandler,
				conditions: [{ type: 'mode', value: ['navigate'] }, { type: 'same-origin' }, ...notCms],
			}),
		],
		defaultHandler: { strategy: 'network-only', cacheName: '' },
	}),
}
