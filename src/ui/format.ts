// Words and small templates shared by the components.

import { html, svg, type TemplateResult } from 'lit'
import type { Condition, Handler, Strategy, WarningCode } from '../engine/index.ts'

export const STRATEGY_NAMES: Record<Strategy, string> = {
	'cache-first': 'Cache first',
	'network-first': 'Network first',
	'stale-while-revalidate': 'Stale while revalidate',
	'network-only': 'Network only',
	'cache-only': 'Cache only',
}

export const WARNING_NAMES: Record<WarningCode, string> = {
	'dead-route': 'Dead route',
	'mixed-content-types': 'Mixed content types in one cache',
	'opaque-to-cors': 'Opaque response to a CORS request',
	'opaque-cached': 'Opaque responses cached',
	'precache-never-requested': 'Precache entry never requested',
	'precache-weight': 'Precache weight',
	'range-on-caching-route': 'Range request on a caching route',
	'unhashed-cache-first': 'Unhashed file on cache-first',
	'worker-script-cached': 'Worker script cached upstream',
}

export function strategyLabel(strategy: Strategy): TemplateResult {
	return html`<span class="swt-strategy" data-strategy=${strategy}>${STRATEGY_NAMES[strategy]}</span>`
}

export function warningIcon(): TemplateResult {
	return html`<svg class="swt-icon text-warn" viewBox="0 0 16 16" aria-hidden="true">${svg`<path d="M8 1.2 15.4 14H.6L8 1.2Zm-.8 4.6v4h1.6v-4H7.2Zm0 5.2v1.6h1.6V11H7.2Z"/>`}</svg>`
}

const ICONS = {
	right: 'M5.5 3v10l6-5-6-5Z',
	down: 'M3 5.5h10L8 11.5 3 5.5Z',
	up: 'M3 10.5h10L8 4.5l-5 6Z',
	close: 'M4.1 3 8 6.9 11.9 3 13 4.1 9.1 8l3.9 3.9-1.1 1.1L8 9.1 4.1 13 3 11.9 6.9 8 3 4.1 4.1 3Z',
	grip: 'M5 2.5h2.2v2.2H5V2.5Zm3.8 0H11v2.2H8.8V2.5ZM5 6.9h2.2v2.2H5V6.9Zm3.8 0H11v2.2H8.8V6.9ZM5 11.3h2.2v2.2H5v-2.2Zm3.8 0H11v2.2H8.8v-2.2Z',
} as const

export function icon(name: keyof typeof ICONS): TemplateResult {
	return html`<svg class="swt-icon" viewBox="0 0 16 16" aria-hidden="true">${svg`<path d=${ICONS[name]}/>`}</svg>`
}

export function chevron(open: boolean): TemplateResult {
	return html`<svg class="swt-icon text-muted" viewBox="0 0 16 16" aria-hidden="true">${svg`<path d=${open ? 'M3 5.5h10L8 11.5 3 5.5Z' : 'M5.5 3v10l6-5-6-5Z'}/>`}</svg>`
}

const list = (values: string[]) => new Intl.ListFormat('en', { type: 'disjunction' }).format(values)

/** A condition as a short phrase: "path starts with /dist/". */
export function describeCondition(condition: Condition): string {
	const not = condition.negate === true
	switch (condition.type) {
		case 'same-origin':
			return not ? 'is on another origin' : 'is on the site\'s own origin'
		case 'origin':
			return `origin is ${not ? 'not ' : ''}${condition.value}`
		case 'path-prefix':
			return `path ${not ? 'does not start' : 'starts'} with ${condition.value}`
		case 'path-pattern':
			return `path ${not ? 'does not match' : 'matches'} /${condition.value}/${condition.flags ?? ''}`
		case 'query-param':
			return `${not ? 'has no' : 'has a'} "${condition.value}" query parameter`
		case 'destination':
			return `destination is ${not ? 'not ' : ''}${list(condition.value)}`
		case 'mode':
			return `mode is ${not ? 'not ' : ''}${list(condition.value)}`
	}
}

function duration(seconds: number): string {
	if (seconds % 86_400 === 0) return `${seconds / 86_400} d`
	if (seconds % 3600 === 0) return `${seconds / 3600} h`
	return `${seconds} s`
}

/** A handler's options as short phrases, omitting what is unset. */
export function describeOptions(handler: Handler): string[] {
	const options = handler.options
	if (!options) return []
	return [
		options.fetchMode ? `fetches as ${options.fetchMode}` : '',
		options.fetchCredentials ? `credentials ${options.fetchCredentials}` : '',
		options.cacheableStatuses ? `caches status ${options.cacheableStatuses.join(', ')}` : '',
		options.maxEntries === undefined ? '' : `at most ${options.maxEntries} entries`,
		options.maxAgeSeconds === undefined ? '' : `kept ${duration(options.maxAgeSeconds)}`,
		options.purgeOnQuotaError ? 'emptied if storage runs out' : '',
		options.ignoreVary ? 'ignores Vary' : '',
	].filter((phrase) => phrase !== '')
}

export const count = (n: number, noun: string) => `${n.toLocaleString('en')} ${noun}${n === 1 ? '' : 's'}`
