// Bug 6: favicons in the same folder as content-hashed build files.

import { ORIGIN, buildHar, config, page, route, type Scenario } from '../har-builder.ts'
import type { Condition } from '../../src/engine/types.ts'

const har = buildHar(`${ORIGIN}/`, [
	page(),
	{ url: `${ORIGIN}/dist/assets/app-D4f8a1Zc.js`, dest: 'script', mode: 'cors', type: 'text/javascript' },
	{ url: `${ORIGIN}/dist/assets/app-B7kq2Xw9.css`, dest: 'style', mode: 'no-cors', type: 'text/css' },
	{ url: `${ORIGIN}/dist/assets/favicons/favicon-32x32.png`, dest: 'image', mode: 'no-cors', type: 'image/png' },
])

const assets = (extra: Condition[]) => route('assets', {
	name: 'Build files',
	conditions: [{ type: 'same-origin' }, { type: 'path-prefix', value: '/dist/assets/' }, ...extra],
	strategy: 'cache-first',
	cacheName: 'asset-cache',
})

export const triggering: Scenario = { har, config: config({ routes: [assets([])] }) }

export const clean: Scenario = {
	har,
	config: config({ routes: [assets([{ type: 'path-prefix', value: '/dist/assets/favicons/', negate: true }])] }),
}
