// Bug 7: the CDN caching sw.js itself, so a deployed fix does not arrive.

import { ORIGIN, buildHar, config, page, type RequestSpec, type Scenario } from '../har-builder.ts'

const worker = (responseHeaders: Record<string, string>): RequestSpec => ({
	url: `${ORIGIN}/sw.js`,
	dest: 'serviceworker',
	mode: 'same-origin',
	type: 'text/javascript',
	requestHeaders: { 'Service-Worker': 'script' },
	responseHeaders,
})

export const triggering: Scenario = {
	har: buildHar(`${ORIGIN}/`, [page(), worker({ 'Cache-Control': 'public, max-age=0, s-maxage=14400', 'Age': '600' })]),
	config: config(),
}

export const clean: Scenario = {
	har: buildHar(`${ORIGIN}/`, [page(), worker({ 'Cache-Control': 'no-cache' })]),
	config: config(),
}
