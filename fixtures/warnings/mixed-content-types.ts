// A cache named for HTML that fills up with scripts and fonts.

import { ORIGIN, buildHar, config, page, route, type Scenario } from '../har-builder.ts'

const har = buildHar(`${ORIGIN}/`, [
	page(),
	{ url: `${ORIGIN}/dist/assets/app-D4f8a1Zc.js`, dest: 'script', mode: 'cors', type: 'text/javascript' },
	{ url: `${ORIGIN}/static/fonts/Body.woff2?v=1.0`, dest: 'font', mode: 'cors', type: 'font/woff2' },
])

const handler = { strategy: 'network-first', cacheName: 'html-cache' } as const

export const triggering: Scenario = {
	har,
	config: config({ routes: [route('pages', { name: 'Pages', conditions: [{ type: 'same-origin' }], ...handler })] }),
}

export const clean: Scenario = {
	har,
	config: config({ routes: [route('pages', { name: 'Pages', conditions: [{ type: 'mode', value: ['navigate'] }], ...handler })] }),
}
