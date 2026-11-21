// Bug 2: a no-cors cache route answering an image that a canvas component
// requested with crossorigin="anonymous".

import { CDN, ORIGIN, buildHar, config, page, route, type Scenario } from '../har-builder.ts'

const har = buildHar(`${ORIGIN}/`, [
	page(),
	{ url: `${CDN}/images/hero-3fa9c21b.jpg`, dest: 'image', mode: 'no-cors', type: 'image/jpeg' },
	{ url: `${CDN}/images/shade-7c2d91aa.jpg`, dest: 'image', mode: 'cors', type: 'image/jpeg' },
])

const cdn = (fetchMode: 'cors' | 'no-cors') => route('cdn-images', {
	name: 'CDN images',
	conditions: [{ type: 'origin', value: CDN }],
	strategy: 'cache-first',
	cacheName: 'static-cache',
	options: { fetchMode, cacheableStatuses: [200] },
})

export const triggering: Scenario = { har, config: config({ routes: [cdn('no-cors')] }) }
export const clean: Scenario = { har, config: config({ routes: [cdn('cors')] }) }
