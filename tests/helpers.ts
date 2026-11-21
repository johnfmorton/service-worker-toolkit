import { parseHar, simulate } from '../src/engine/index.ts'
import type { ParsedHar, SimulationResult, WarningCode } from '../src/engine/index.ts'
import type { Scenario } from '../fixtures/har-builder.ts'

export function run(scenario: Scenario): { har: ParsedHar, result: SimulationResult } {
	const har = parseHar(scenario.har)
	return { har, result: simulate(har, scenario.config) }
}

export function codes(result: SimulationResult): WarningCode[] {
	return [...new Set(result.warnings.map((warning) => warning.code))]
}

/** The URL paths of the requests a warning points at. */
export function paths(har: ParsedHar, indexes: number[]): string[] {
	return indexes.map((i) => new URL(har.requests[i]?.url ?? 'http://missing').pathname)
}
