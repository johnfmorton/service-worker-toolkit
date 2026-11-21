// Bug 5: audio, which is fetched with Range requests, on a cache-first route.

import { CDN, ORIGIN, buildHar, config, page, route, type Scenario } from '../har-builder.ts'
import type { Condition } from '../../src/engine/types.ts'

const har = buildHar(`${ORIGIN}/`, [
	page(),
	{ url: `${CDN}/images/hero-3fa9c21b.jpg`, dest: 'image', mode: 'no-cors', type: 'image/jpeg' },
	{ url: `${CDN}/audio/episode-12.mp3`, dest: 'audio', mode: 'no-cors', type: 'audio/mpeg', status: 206, range: true, size: 2_400_000 },
])

const cdn = (extra: Condition[]) => route('cdn', {
	name: 'CDN files',
	conditions: [{ type: 'origin', value: CDN }, ...extra],
	strategy: 'cache-first',
	cacheName: 'static-cache',
	options: { fetchMode: 'cors', cacheableStatuses: [200] },
})

export const triggering: Scenario = { har, config: config({ routes: [cdn([])] }) }

/** Limited to images, so media is left to the network. */
export const clean: Scenario = { har, config: config({ routes: [cdn([{ type: 'destination', value: ['image'] }])] }) }
