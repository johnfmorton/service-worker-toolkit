// Bug 4: a precache heavier than anyone realised, most of it one file.

import { ORIGIN, buildHar, config, page, type Scenario } from '../har-builder.ts'

const har = buildHar(`${ORIGIN}/`, [page()])

const offline = [
	{ url: 'offline.html', revision: 'a1', size: 6000 },
	{ url: 'offline.jpg', revision: 'a2', size: 220_000 },
]

export const triggering: Scenario = {
	har,
	config: config({ precache: { entries: [...offline, { url: 'static/fonts/Display.woff2', revision: 'a3', size: 310_000 }] } }),
}

export const clean: Scenario = { har, config: config({ precache: { entries: offline } }) }
