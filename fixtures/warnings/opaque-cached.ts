// A route that writes opaque (status 0) responses to its cache.

import { CDN, ORIGIN, buildHar, config, page, route, type Scenario } from '../har-builder.ts'

const har = buildHar(`${ORIGIN}/`, [
	page(),
	{ url: `${CDN}/images/hero-3fa9c21b.jpg`, dest: 'image', mode: 'no-cors', type: 'image/jpeg' },
])

const cdn = (cacheableStatuses: number[]) => route('cdn-images', {
	name: 'CDN images',
	conditions: [{ type: 'origin', value: CDN }],
	strategy: 'cache-first',
	cacheName: 'static-cache',
	options: { cacheableStatuses },
})

export const triggering: Scenario = { har, config: config({ routes: [cdn([0, 200])] }) }
export const clean: Scenario = { har, config: config({ routes: [cdn([200])] }) }
