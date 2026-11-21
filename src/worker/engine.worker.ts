// Runs HAR parsing and simulation off the main thread, so a large file never
// freezes the page. The parsed HAR is kept here between simulations.

import { bestPage, parseHar, parseHarText, selectPage, simulate } from '../engine/index.ts'
import type { Config, ParsedHar, SimulationResult } from '../engine/index.ts'

export type EngineRequest =
	| { id: number, type: 'load-file', file: File }
	| { id: number, type: 'load-json', har: unknown }
	| { id: number, type: 'select-page', page: number | null }
	| { id: number, type: 'simulate', config: Config }

export type EngineResponse =
	| { id: number, type: 'har', har: ParsedHar, page: number | null, ms: number }
	| { id: number, type: 'result', result: SimulationResult, ms: number }
	| { id: number, type: 'error', message: string }

/** Everything in the file, and the part of it being simulated. */
let whole: ParsedHar | null = null
let har: ParsedHar | null = null

function loaded(id: number, parsed: ParsedHar, started: number): EngineResponse {
	whole = parsed
	// A HAR kept across reloads holds several page loads; the simulation is of one.
	const page = bestPage(parsed)
	har = page === null ? parsed : selectPage(parsed, page)
	return { id, type: 'har', har, page, ms: performance.now() - started }
}

async function handle(message: EngineRequest): Promise<EngineResponse> {
	const started = performance.now()
	switch (message.type) {
		case 'load-file':
			return loaded(message.id, parseHarText(await message.file.text()), started)
		case 'load-json':
			return loaded(message.id, parseHar(message.har), started)
		case 'select-page':
			if (!whole) throw new Error('No HAR file is loaded.')
			har = message.page === null ? whole : selectPage(whole, message.page)
			return { id: message.id, type: 'har', har, page: message.page, ms: performance.now() - started }
		case 'simulate':
			if (!har) throw new Error('No HAR file is loaded.')
			return { id: message.id, type: 'result', result: simulate(har, message.config), ms: performance.now() - started }
	}
}

addEventListener('message', (event: MessageEvent<EngineRequest>) => {
	handle(event.data)
		.catch((error: unknown): EngineResponse => ({
			id: event.data.id,
			type: 'error',
			message: error instanceof Error ? error.message : String(error),
		}))
		.then((response) => postMessage(response))
})
