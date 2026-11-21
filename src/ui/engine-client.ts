// The page's side of the engine worker: one promise per request.

import type { Config, ParsedHar, SimulationResult } from '../engine/index.ts'
import type { EngineRequest, EngineResponse } from '../worker/engine.worker.ts'

type Outgoing = EngineRequest extends infer R ? R extends { id: number } ? Omit<R, 'id'> : never : never

/** A HAR, and which of its page loads it is narrowed to (null for all of them). */
export interface LoadedHar {
	har: ParsedHar
	page: number | null
}

export class EngineClient {
	#worker = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), { type: 'module' })
	#pending = new Map<number, { resolve: (response: EngineResponse) => void, reject: (error: Error) => void }>()
	#nextId = 1

	constructor() {
		this.#worker.addEventListener('message', (event: MessageEvent<EngineResponse>) => {
			const waiting = this.#pending.get(event.data.id)
			if (!waiting) return
			this.#pending.delete(event.data.id)
			if (event.data.type === 'error') waiting.reject(new Error(event.data.message))
			else waiting.resolve(event.data)
		})
	}

	#send(message: Outgoing): Promise<EngineResponse> {
		const id = this.#nextId++
		return new Promise((resolve, reject) => {
			this.#pending.set(id, { resolve, reject })
			this.#worker.postMessage({ ...message, id })
		})
	}

	async #loaded(message: Outgoing): Promise<LoadedHar> {
		const response = await this.#send(message)
		if (response.type !== 'har') throw new Error('Unexpected reply from the engine.')
		return { har: response.har, page: response.page }
	}

	/** Reads and parses a HAR file. The file is read inside the worker and goes nowhere else. */
	loadFile(file: File): Promise<LoadedHar> {
		return this.#loaded({ type: 'load-file', file })
	}

	loadJson(har: unknown): Promise<LoadedHar> {
		return this.#loaded({ type: 'load-json', har })
	}

	/** Narrows the loaded HAR to one of its page loads, or widens it to all of them with null. */
	selectPage(page: number | null): Promise<LoadedHar> {
		return this.#loaded({ type: 'select-page', page })
	}

	async simulate(config: Config): Promise<SimulationResult> {
		const response = await this.#send({ type: 'simulate', config })
		if (response.type !== 'result') throw new Error('Unexpected reply from the engine.')
		return response.result
	}
}
