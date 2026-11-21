// Bug 3: a font precached without the query string the page requests it with.

import { ORIGIN, buildHar, config, page, type Scenario } from '../har-builder.ts'

const har = buildHar(`${ORIGIN}/`, [
	page(),
	{ url: `${ORIGIN}/static/fonts/Body.woff2?v=1.0`, dest: 'font', mode: 'cors', type: 'font/woff2', size: 27_000 },
])

export const triggering: Scenario = {
	har,
	config: config({ precache: { entries: [{ url: 'static/fonts/Body.woff2', revision: 'a1' }] } }),
}

/** Precached under the URL the page really uses. */
export const clean: Scenario = {
	har,
	config: config({ precache: { entries: [{ url: 'static/fonts/Body.woff2?v=1.0', revision: 'a1' }] } }),
}
