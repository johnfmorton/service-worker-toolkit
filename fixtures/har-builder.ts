// Builds HAR objects for fixtures from a short list of requests.
//
// Fixtures are written by hand on placeholder domains. Never commit a HAR
// exported from a real browsing session: they carry cookies, tokens and
// internal URLs.

import type { Config, Handler, Route } from '../src/engine/types.ts'

export interface RequestSpec {
	url: string
	/** Sec-Fetch-Dest. */
	dest?: string
	/** Sec-Fetch-Mode. */
	mode?: string
	method?: string
	status?: number
	/** Response content type. */
	type?: string
	/** Body size in bytes. */
	size?: number
	/** Send a Range header. */
	range?: boolean
	requestHeaders?: Record<string, string>
	responseHeaders?: Record<string, string>
	/** Chrome's _resourceType, for entries that lack Sec-Fetch headers. */
	resourceType?: string
}

export interface Scenario {
	har: unknown
	config: Config
}

/** Stand-ins for the sensitive values every real HAR contains. The parser must drop them. */
export const SECRET_COOKIE = 'session=placeholder-cookie'
export const SECRET_TOKEN = 'Bearer placeholder-token'
export const SECRET_BODY = 'placeholder-body'

const headerList = (headers: Record<string, string>) =>
	Object.entries(headers).map(([name, value]) => ({ name, value }))

export function buildHar(pageUrl: string, specs: RequestSpec[]): unknown {
	const entries = specs.map((spec) => {
		const size = spec.size ?? 1000
		const requestHeaders: Record<string, string> = {
			Cookie: SECRET_COOKIE,
			Authorization: SECRET_TOKEN,
			...(spec.dest ? { 'Sec-Fetch-Dest': spec.dest } : {}),
			...(spec.mode ? { 'Sec-Fetch-Mode': spec.mode } : {}),
			...(spec.range ? { Range: 'bytes=0-' } : {}),
			...spec.requestHeaders,
		}
		const responseHeaders: Record<string, string> = {
			'Content-Type': spec.type ?? 'application/octet-stream',
			'Set-Cookie': SECRET_COOKIE,
			...spec.responseHeaders,
		}
		return {
			startedDateTime: '2026-11-21T12:00:00.000Z',
			time: 10,
			request: {
				method: spec.method ?? 'GET',
				url: spec.url,
				httpVersion: 'h2',
				headers: headerList(requestHeaders),
				queryString: [],
				cookies: [{ name: 'session', value: 'placeholder-cookie' }],
				headersSize: -1,
				bodySize: 0,
			},
			response: {
				status: spec.status ?? 200,
				statusText: '',
				httpVersion: 'h2',
				headers: headerList(responseHeaders),
				cookies: [{ name: 'session', value: 'placeholder-cookie' }],
				content: { size, mimeType: spec.type ?? 'application/octet-stream', text: SECRET_BODY },
				redirectURL: '',
				headersSize: -1,
				bodySize: size,
				_transferSize: size + 300,
			},
			cache: {},
			timings: { send: 0, wait: 5, receive: 5 },
			...(spec.resourceType ? { _resourceType: spec.resourceType } : {}),
		}
	})
	return {
		log: {
			version: '1.2',
			creator: { name: 'service-worker-toolkit fixtures', version: '1' },
			pages: [{ startedDateTime: '2026-11-21T12:00:00.000Z', id: 'page_1', title: pageUrl, pageTimings: {} }],
			entries,
		},
	}
}

export const ORIGIN = 'https://example.com'
export const CDN = 'https://cdn.example.com'

export function config(parts: Partial<Config> = {}): Config {
	return {
		version: 1,
		origin: ORIGIN,
		precache: { entries: [] },
		routes: [],
		defaultHandler: null,
		...parts,
	}
}

export function route(id: string, parts: Partial<Route> & Handler): Route {
	return { id, name: id, conditions: [], ...parts }
}

/** A page document: the first request of nearly every fixture. */
export const page = (path = '/'): RequestSpec =>
	({ url: ORIGIN + path, dest: 'document', mode: 'navigate', type: 'text/html', size: 18_000 })
