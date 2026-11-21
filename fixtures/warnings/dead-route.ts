// Bug 1: a broad first route takes the requests meant for the routes after it.

import { CDN, ORIGIN, buildHar, config, page, route, type Scenario } from '../har-builder.ts'
import type { Route } from '../../src/engine/types.ts'

const har = buildHar(`${ORIGIN}/`, [
	page(),
	{ url: `${ORIGIN}/dist/assets/app-D4f8a1Zc.js`, dest: 'script', mode: 'cors', type: 'text/javascript' },
	{ url: `${CDN}/images/hero-3fa9c21b.jpg`, dest: 'image', mode: 'no-cors', type: 'image/jpeg' },
	{ url: `${CDN}/images/thumb-9b1e44d0.jpg`, dest: 'image', mode: 'no-cors', type: 'image/jpeg' },
	{ url: `${ORIGIN}/actions/blog/like`, dest: 'empty', mode: 'cors', type: 'application/json' },
])

// Everything that is not an action or admin path: far broader than "pages".
const pages: Route = route('pages', {
	name: 'Pages',
	conditions: [
		{ type: 'path-prefix', value: '/actions/', negate: true },
		{ type: 'path-prefix', value: '/admin/', negate: true },
	],
	strategy: 'network-first',
	cacheName: 'html-cache',
	options: { maxEntries: 100, cacheableStatuses: [200] },
})

const cdnImages: Route = route('cdn-images', {
	name: 'CDN images',
	conditions: [{ type: 'origin', value: CDN }],
	strategy: 'cache-first',
	cacheName: 'static-cache',
	options: { cacheableStatuses: [200] },
})

export const triggering: Scenario = { har, config: config({ routes: [pages, cdnImages] }) }

/** The same two routes with the narrow one first. */
export const clean: Scenario = { har, config: config({ routes: [cdnImages, pages] }) }
