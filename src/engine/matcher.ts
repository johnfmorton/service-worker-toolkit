// Evaluates a route's conditions against a request.

import type { Condition, ConfigProblem, SimRequest } from './types.ts'

/** A request with its URL parsed once, ready to be matched many times. */
export interface Facts {
	request: SimRequest
	url: URL
	sameOrigin: boolean
}

export type Predicate = (facts: Facts) => boolean

function compileCondition(condition: Condition): Predicate {
	switch (condition.type) {
		case 'same-origin':
			return (f) => f.sameOrigin
		case 'origin': {
			const origin = URL.canParse(condition.value) ? new URL(condition.value).origin : condition.value
			return (f) => f.url.origin === origin
		}
		case 'path-prefix':
			return (f) => f.url.pathname.startsWith(condition.value)
		case 'path-pattern': {
			// 'g' and 'y' make test() stateful, which would make matching depend on call order.
			const pattern = new RegExp(condition.value, (condition.flags ?? '').replace(/[gy]/g, ''))
			return (f) => pattern.test(f.url.pathname)
		}
		case 'query-param':
			return (f) => f.url.searchParams.has(condition.value)
		case 'destination': {
			const wanted = new Set<string>(condition.value)
			return (f) => wanted.has(f.request.destination)
		}
		case 'mode': {
			const wanted = new Set<string>(condition.value)
			return (f) => wanted.has(f.request.mode)
		}
	}
}

/**
 * Turns a condition list into one predicate: all conditions must hold, and an
 * empty list matches everything. A condition that cannot be compiled is
 * reported and makes the route match nothing.
 */
export function compileConditions(conditions: Condition[], problems: ConfigProblem[], routeId?: string): Predicate {
	const predicates: Predicate[] = []
	for (const condition of conditions) {
		try {
			const test = compileCondition(condition)
			predicates.push(condition.negate ? (f) => !test(f) : test)
		} catch (error) {
			problems.push({
				...(routeId === undefined ? {} : { routeId }),
				message: `Invalid ${condition.type} condition: ${error instanceof Error ? error.message : String(error)}`,
			})
			return () => false
		}
	}
	return (f) => predicates.every((test) => test(f))
}
