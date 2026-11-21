// Configuration to Workbox service worker source. The only place, with the
// engine's defaults, that knows Workbox's API.

import { DEFAULT_METHOD, PRECACHE_DEFAULTS } from '../engine/defaults.ts'
import type { Condition, Config, Handler, Strategy } from '../engine/types.ts'

export interface WorkboxExportOptions {
	/** 'ts' adds the type declaration a TypeScript worker needs. */
	language: 'ts' | 'js'
	/**
	 * 'manifest' leaves the precache list to the build (self.__WB_MANIFEST,
	 * filled in by workbox-build's injectManifest); 'inline' writes it out.
	 */
	precache: 'manifest' | 'inline'
}

export const WORKBOX_EXPORT_DEFAULTS: WorkboxExportOptions = { language: 'ts', precache: 'manifest' }

const STRATEGY_CLASSES: Record<Strategy, string> = {
	'cache-first': 'CacheFirst',
	'network-first': 'NetworkFirst',
	'stale-while-revalidate': 'StaleWhileRevalidate',
	'network-only': 'NetworkOnly',
	'cache-only': 'CacheOnly',
}

const STRATEGY_NAMES: Record<Strategy, string> = {
	'cache-first': 'cache first',
	'network-first': 'network first',
	'stale-while-revalidate': 'stale while revalidate',
	'network-only': 'network only',
	'cache-only': 'cache only',
}

/** A single-quoted JavaScript string literal. */
function quote(text: string): string {
	return `'${text.replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`
}

/** Comment text that cannot end the comment or start a new line of code. */
function plain(text: string): string {
	return text.replace(/\s+/g, ' ').trim()
}

function duration(seconds: number): string {
	for (const [unit, size] of [['day', 86_400], ['hour', 3600], ['minute', 60]] as const) {
		if (seconds >= size && seconds % size === 0) return `${seconds / size} ${unit}${seconds === size ? '' : 's'}`
	}
	return `${seconds} second${seconds === 1 ? '' : 's'}`
}

/** `request.destination === 'image'`, or an includes() test for several values. */
function oneOf(subject: string, values: string[], negate: boolean): string {
	// The Fetch API spells the 'empty' destination as an empty string.
	const literals = values.map((value) => quote(subject === 'request.destination' && value === 'empty' ? '' : value))
	if (literals.length === 1) return `${subject} ${negate ? '!==' : '==='} ${literals[0] ?? '\'\''}`
	return `${negate ? '!' : ''}[${literals.join(', ')}].includes(${subject})`
}

/** One condition as a JavaScript expression over the match callback's arguments. */
function expression(condition: Condition): string {
	const not = condition.negate === true
	switch (condition.type) {
		case 'same-origin':
			return `${not ? '!' : ''}sameOrigin`
		case 'origin': {
			const origin = URL.canParse(condition.value) ? new URL(condition.value).origin : condition.value
			return `url.origin ${not ? '!==' : '==='} ${quote(origin)}`
		}
		case 'path-prefix':
			return `${not ? '!' : ''}url.pathname.startsWith(${quote(condition.value)})`
		case 'path-pattern':
			try {
				// Printing a RegExp escapes any '/' in the source.
				return `${not ? '!' : ''}${String(new RegExp(condition.value, (condition.flags ?? '').replace(/[gy]/g, '')))}.test(url.pathname)`
			} catch {
				return `false /* invalid pattern: ${plain(condition.value).replaceAll('*/', '* /')} */`
			}
		case 'query-param':
			return `${not ? '!' : ''}url.searchParams.has(${quote(condition.value)})`
		case 'destination':
			return oneOf('request.destination', condition.value, not)
		case 'mode':
			return oneOf('request.mode', condition.value, not)
	}
}

function matchCallback(conditions: Condition[]): string[] {
	if (conditions.length === 0) return ['() => true,']
	const tests = conditions.map(expression)
	const used = ['url', 'request', 'sameOrigin'].filter((name) => tests.some((test) => new RegExp(`\\b${name}\\b`).test(test.replace(/'(?:[^'\\]|\\.)*'/g, ''))))
	const lines = [`({ ${used.join(', ')} }) =>`]
	tests.forEach((test, i) => lines.push(`\t${i === 0 ? '' : '&& '}${test}${i === tests.length - 1 ? ',' : ''}`))
	return lines
}

function strategy(handler: Handler, used: Set<string>): string[] {
	const name = STRATEGY_CLASSES[handler.strategy]
	used.add(name)
	const options = handler.options ?? {}
	const caches = handler.strategy !== 'network-only'
	const body: string[] = []

	if (caches && handler.cacheName !== '') body.push(`cacheName: ${quote(handler.cacheName)},`)

	const fetchOptions = [
		options.fetchMode ? `mode: ${quote(options.fetchMode)}` : '',
		options.fetchCredentials ? `credentials: ${quote(options.fetchCredentials)}` : '',
	].filter((part) => part !== '')
	if (fetchOptions.length > 0) body.push(`fetchOptions: { ${fetchOptions.join(', ')} },`)
	if (caches && options.ignoreVary) body.push('matchOptions: { ignoreVary: true },')

	const plugins: string[] = []
	if (caches && (options.maxEntries !== undefined || options.maxAgeSeconds !== undefined)) {
		used.add('ExpirationPlugin')
		// Workbox refuses to expire entries in its default runtime cache.
		if (handler.cacheName === '') plugins.push('// ExpirationPlugin needs a cache name: give this handler one.')
		plugins.push('new ExpirationPlugin({')
		if (options.maxEntries !== undefined) plugins.push(`\tmaxEntries: ${options.maxEntries},`)
		if (options.maxAgeSeconds !== undefined) plugins.push(`\tmaxAgeSeconds: ${options.maxAgeSeconds}, // ${duration(options.maxAgeSeconds)}`)
		if (options.purgeOnQuotaError) plugins.push('\tpurgeOnQuotaError: true,')
		plugins.push('}),')
	}
	if (caches && options.cacheableStatuses !== undefined) {
		used.add('CacheableResponsePlugin')
		plugins.push(`new CacheableResponsePlugin({ statuses: [${options.cacheableStatuses.join(', ')}] }),`)
	}
	if (plugins.length > 0) body.push('plugins: [', ...plugins.map((line) => `\t${line}`), '],')

	if (body.length === 0) return [`new ${name}()`]
	return [`new ${name}({`, ...body.map((line) => `\t${line}`), '})']
}

function precache(config: Config, options: WorkboxExportOptions): string[] {
	const { entries, ignoreParams, directoryIndex, cleanUrls } = config.precache
	if (entries.length === 0) return []

	const settings: string[] = []
	if (ignoreParams && ignoreParams.join() !== PRECACHE_DEFAULTS.ignoreParams.join()) {
		const patterns = ignoreParams.flatMap((source) => {
			try {
				return [String(new RegExp(source))]
			} catch {
				return []
			}
		})
		settings.push(`\tignoreURLParametersMatching: [${patterns.join(', ')}],`)
	}
	if (directoryIndex !== undefined && directoryIndex !== PRECACHE_DEFAULTS.directoryIndex) {
		settings.push(`\tdirectoryIndex: ${directoryIndex === null ? 'null' : quote(directoryIndex)},`)
	}
	if (cleanUrls !== undefined && cleanUrls !== PRECACHE_DEFAULTS.cleanUrls) settings.push(`\tcleanURLs: ${String(cleanUrls)},`)
	const tail = settings.length > 0 ? [', {', ...settings, '})'] : [')']

	if (options.precache === 'manifest') {
		return [
			`// Precache: ${entries.length} file${entries.length === 1 ? '' : 's'}, answered before any route.`,
			'// self.__WB_MANIFEST is replaced with the list by the build (workbox-build injectManifest).',
			`precacheAndRoute(self.__WB_MANIFEST${tail[0] ?? ')'}`,
			...tail.slice(1),
			'',
		]
	}
	return [
		`// Precache: ${entries.length} file${entries.length === 1 ? '' : 's'}, answered before any route.`,
		'// An entry needs a revision unless its URL already contains a content hash.',
		'precacheAndRoute([',
		...entries.map((entry) => `\t{ url: ${quote(entry.url)}, revision: ${typeof entry.revision === 'string' ? quote(entry.revision) : 'null'} },`),
		`]${tail[0] ?? ')'}`,
		...tail.slice(1),
		'',
	]
}

/** Generates a Workbox service worker equivalent to the configuration. */
export function generateWorkbox(config: Config, options: WorkboxExportOptions = WORKBOX_EXPORT_DEFAULTS): string {
	const used = new Set<string>()
	const body: string[] = []

	const precacheLines = precache(config, options)
	if (precacheLines.length > 0) used.add('precacheAndRoute')
	body.push(...precacheLines)

	if (config.routes.length > 0) {
		used.add('registerRoute')
		body.push(
			'// Routes are tried in the order they are registered, and the first match',
			'// wins: a broad matcher takes the requests meant for the routes after it.',
			'',
		)
	}
	config.routes.forEach((route, i) => {
		const method = (route.method ?? DEFAULT_METHOD).toUpperCase()
		const handler = strategy(route, used)
		body.push(
			`// ${i + 1}. ${plain(route.name)}: ${STRATEGY_NAMES[route.strategy]}.`,
			'registerRoute(',
			...matchCallback(route.conditions).map((line) => `\t${line}`),
			...handler.map((line, n) => `\t${line}${n === handler.length - 1 ? ',' : ''}`),
			...(method === DEFAULT_METHOD ? [] : [`\t${quote(method)},`]),
			')',
			'',
		)
	})

	if (config.defaultHandler) {
		used.add('setDefaultHandler')
		const handler = strategy(config.defaultHandler, used)
		body.push(`// Everything no route matched: ${STRATEGY_NAMES[config.defaultHandler.strategy]}.`)
		if (handler.length === 1) body.push(`setDefaultHandler(${handler[0] ?? ''})`)
		else body.push(`setDefaultHandler(${handler[0] ?? ''}`, ...handler.slice(1, -1), '}))')
		body.push('')
	}

	const imports = ([
		['workbox-precaching', ['precacheAndRoute']],
		['workbox-routing', ['registerRoute', 'setDefaultHandler']],
		['workbox-strategies', Object.values(STRATEGY_CLASSES)],
		['workbox-expiration', ['ExpirationPlugin']],
		['workbox-cacheable-response', ['CacheableResponsePlugin']],
	] as const).flatMap(([module, names]) => {
		const needed = names.filter((name) => used.has(name))
		return needed.length > 0 ? [`import { ${needed.join(', ')} } from ${quote(module)}`] : []
	})

	const usesSelf = used.has('precacheAndRoute') && options.precache === 'manifest'
	return [
		'// Generated by Service Worker Toolkit. It holds the caching rules only:',
		'// add whatever else the worker needs (an offline fallback, skipWaiting,',
		'// error handling) around them.',
		`// Site: ${plain(config.origin)}`,
		'',
		...imports,
		...(imports.length > 0 ? [''] : []),
		...(usesSelf && options.language === 'ts' ? ['declare const self: ServiceWorkerGlobalScope', ''] : []),
		...body,
	].join('\n').trimEnd() + '\n'
}
