// Reading a configuration from JSON someone else wrote. Everything is
// checked, and only known fields are copied, so the rest of the app can
// trust the Config type.

import type { Condition, Config, Destination, Handler, HandlerOptions, Mode, PrecacheEntry, Route, Strategy } from './types.ts'

const STRATEGIES: readonly Strategy[] = ['cache-first', 'network-first', 'stale-while-revalidate', 'network-only', 'cache-only']
const FETCH_MODES = ['cors', 'no-cors', 'same-origin'] as const
const CREDENTIALS = ['omit', 'same-origin', 'include'] as const

export class ConfigError extends Error {
	problems: string[]

	constructor(problems: string[]) {
		super(`The configuration is not valid: ${problems.join(' ')}`)
		this.name = 'ConfigError'
		this.problems = problems
	}
}

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const isCount = (value: unknown): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value >= 0

const isStrings = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((item) => typeof item === 'string')

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

function readCondition(value: unknown, where: string, problems: string[]): Condition | null {
	if (!isObject(value)) {
		problems.push(`${where} is not an object.`)
		return null
	}
	const negate = value.negate === true ? { negate: true } : {}
	switch (value.type) {
		case 'same-origin':
			return { type: 'same-origin', ...negate }
		case 'origin':
		case 'path-prefix':
		case 'query-param':
			if (typeof value.value !== 'string') break
			return { type: value.type, value: value.value, ...negate }
		case 'path-pattern':
			if (typeof value.value !== 'string') break
			return {
				type: 'path-pattern',
				value: value.value,
				...(typeof value.flags === 'string' ? { flags: value.flags } : {}),
				...negate,
			}
		case 'destination':
			if (!isStrings(value.value)) break
			return { type: 'destination', value: value.value as Destination[], ...negate }
		case 'mode':
			if (!isStrings(value.value)) break
			return { type: 'mode', value: value.value as Mode[], ...negate }
		default:
			problems.push(`${where} has an unknown type "${String(value.type)}".`)
			return null
	}
	problems.push(`${where} (${value.type}) has a missing or wrong value.`)
	return null
}

function readOptions(value: unknown, where: string, problems: string[]): HandlerOptions | undefined {
	if (value === undefined) return undefined
	if (!isObject(value)) {
		problems.push(`${where} options is not an object.`)
		return undefined
	}
	const options: HandlerOptions = {}
	if (value.fetchMode !== undefined) {
		if (oneOf(value.fetchMode, FETCH_MODES)) options.fetchMode = value.fetchMode
		else problems.push(`${where} has an unknown fetch mode.`)
	}
	if (value.fetchCredentials !== undefined) {
		if (oneOf(value.fetchCredentials, CREDENTIALS)) options.fetchCredentials = value.fetchCredentials
		else problems.push(`${where} has an unknown credentials setting.`)
	}
	if (value.cacheableStatuses !== undefined) {
		if (Array.isArray(value.cacheableStatuses) && value.cacheableStatuses.every(isCount)) options.cacheableStatuses = value.cacheableStatuses
		else problems.push(`${where} cacheable statuses must be a list of status codes.`)
	}
	for (const key of ['maxEntries', 'maxAgeSeconds'] as const) {
		if (value[key] === undefined) continue
		if (isCount(value[key])) options[key] = value[key]
		else problems.push(`${where} ${key} must be a whole number.`)
	}
	return options
}

function readHandler(value: Json, where: string, problems: string[]): Handler | null {
	if (!oneOf(value.strategy, STRATEGIES)) {
		problems.push(`${where} has an unknown strategy "${String(value.strategy)}".`)
		return null
	}
	const options = readOptions(value.options, where, problems)
	return {
		strategy: value.strategy,
		cacheName: typeof value.cacheName === 'string' ? value.cacheName : '',
		...(options ? { options } : {}),
	}
}

/** Checks a parsed JSON value and returns it as a Config. Throws ConfigError listing every problem. */
export function parseConfig(value: unknown): Config {
	const problems: string[] = []
	if (!isObject(value)) throw new ConfigError(['Expected a JSON object.'])
	if (value.version !== 1) problems.push(`Unsupported version ${JSON.stringify(value.version)}; expected 1.`)
	if (typeof value.origin !== 'string') problems.push('The site origin is missing.')

	const precacheIn = isObject(value.precache) ? value.precache : {}
	const entries: PrecacheEntry[] = []
	for (const [i, entry] of (Array.isArray(precacheIn.entries) ? precacheIn.entries : []).entries()) {
		if (typeof entry === 'string') {
			entries.push({ url: entry })
		} else if (isObject(entry) && typeof entry.url === 'string') {
			entries.push({
				url: entry.url,
				...(typeof entry.revision === 'string' || entry.revision === null ? { revision: entry.revision } : {}),
				...(isCount(entry.size) ? { size: entry.size } : {}),
			})
		} else {
			problems.push(`Precache entry ${i + 1} has no URL.`)
		}
	}

	const routes: Route[] = []
	const ids = new Set<string>()
	for (const [i, routeIn] of (Array.isArray(value.routes) ? value.routes : []).entries()) {
		const where = `Route ${i + 1}`
		if (!isObject(routeIn)) {
			problems.push(`${where} is not an object.`)
			continue
		}
		const handler = readHandler(routeIn, where, problems)
		const conditions = (Array.isArray(routeIn.conditions) ? routeIn.conditions : [])
			.map((condition, c) => readCondition(condition, `${where} condition ${c + 1}`, problems))
			.filter((condition) => condition !== null)
		let id = typeof routeIn.id === 'string' && routeIn.id !== '' ? routeIn.id : `route-${i + 1}`
		// 'precache' and 'default' name the two built-in handlers in results.
		while (ids.has(id) || id === 'precache' || id === 'default') id += '-2'
		ids.add(id)
		if (!handler) continue
		routes.push({
			id,
			name: typeof routeIn.name === 'string' && routeIn.name !== '' ? routeIn.name : id,
			conditions,
			...(typeof routeIn.method === 'string' ? { method: routeIn.method.toUpperCase() } : {}),
			...handler,
		})
	}

	const defaultHandler = isObject(value.defaultHandler)
		? readHandler(value.defaultHandler, 'The default handler', problems)
		: null

	if (problems.length > 0) throw new ConfigError(problems)

	return {
		version: 1,
		origin: value.origin as string,
		precache: {
			entries,
			...(isStrings(precacheIn.ignoreParams) ? { ignoreParams: precacheIn.ignoreParams } : {}),
			...(typeof precacheIn.directoryIndex === 'string' || precacheIn.directoryIndex === null ? { directoryIndex: precacheIn.directoryIndex } : {}),
			...(typeof precacheIn.cleanUrls === 'boolean' ? { cleanUrls: precacheIn.cleanUrls } : {}),
			...(isCount(precacheIn.budgetBytes) ? { budgetBytes: precacheIn.budgetBytes } : {}),
		},
		routes,
		defaultHandler,
		...(typeof value.workerScript === 'string' ? { workerScript: value.workerScript } : {}),
	}
}

/** A configuration with no routes: every request goes to the network. */
export function emptyConfig(origin: string): Config {
	return { version: 1, origin, precache: { entries: [] }, routes: [], defaultHandler: null }
}
