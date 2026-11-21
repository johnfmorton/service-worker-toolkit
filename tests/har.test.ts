import { describe, expect, it } from 'vitest'
import { parseHar, parseHarText } from '../src/engine/index.ts'
import { CDN, ORIGIN, SECRET_BODY, buildHar, page } from '../fixtures/har-builder.ts'

describe('parseHar', () => {
	it('reads destination and mode from the Sec-Fetch headers', () => {
		const har = parseHar(buildHar(`${ORIGIN}/`, [
			page(),
			{ url: `${CDN}/a.jpg`, dest: 'image', mode: 'no-cors', type: 'image/jpeg; charset=binary', size: 500 },
		]))
		expect(har.origin).toBe(ORIGIN)
		expect(har.pageUrl).toBe(`${ORIGIN}/`)
		expect(har.requests[1]).toMatchObject({
			index: 1,
			method: 'GET',
			status: 200,
			contentType: 'image/jpeg',
			bodySize: 500,
			transferSize: 800,
			destination: 'image',
			destinationSource: 'header',
			mode: 'no-cors',
			modeSource: 'header',
			hasRange: false,
			isWorkerScript: false,
		})
	})

	it('falls back to the resource type, then the content type, and says so', () => {
		const har = parseHar(buildHar(`${ORIGIN}/`, [
			{ url: `${ORIGIN}/`, type: 'text/html' },
			{ url: `${ORIGIN}/app.js`, resourceType: 'script', type: 'text/plain' },
			{ url: `${ORIGIN}/a.mp3`, resourceType: 'media', type: 'audio/mpeg' },
			{ url: `${ORIGIN}/font`, type: 'font/woff2' },
			{ url: `${ORIGIN}/mystery`, resourceType: 'other' },
		]))
		expect(har.requests.map((r) => [r.destination, r.destinationSource])).toEqual([
			['document', 'content-type'],
			['script', 'resource-type'],
			['audio', 'resource-type'],
			['font', 'content-type'],
			['unknown', 'unknown'],
		])
	})

	it('infers navigate for the page document only, and leaves other modes unknown', () => {
		const har = parseHar(buildHar(`${ORIGIN}/`, [
			{ url: `${ORIGIN}/`, type: 'text/html' },
			{ url: `${ORIGIN}/app.js`, type: 'text/javascript' },
		]))
		expect(har.requests.map((r) => [r.mode, r.modeSource])).toEqual([
			['navigate', 'inferred'],
			['unknown', 'unknown'],
		])
	})

	it('takes the page from the first document that loaded, past a redirect', () => {
		const har = parseHar(buildHar('ignored', [
			{ url: 'http://example.com/', dest: 'document', mode: 'navigate', status: 301 },
			{ url: `${ORIGIN}/`, dest: 'document', mode: 'navigate', type: 'text/html' },
		]))
		expect(har.origin).toBe(ORIGIN)
	})

	it('notes Range requests and worker script fetches', () => {
		const har = parseHar(buildHar(`${ORIGIN}/`, [
			page(),
			{ url: `${ORIGIN}/a.mp4`, dest: 'video', mode: 'no-cors', range: true },
			{ url: `${ORIGIN}/sw.js`, requestHeaders: { 'Service-Worker': 'script' } },
		]))
		expect(har.requests[1]?.hasRange).toBe(true)
		expect(har.requests[2]?.isWorkerScript).toBe(true)
	})

	it('keeps caching headers and nothing else', () => {
		const har = parseHar(buildHar(`${ORIGIN}/`, [
			{ ...page(), responseHeaders: { 'Cache-Control': 'max-age=60', 'X-Internal-Host': 'placeholder-host' } },
		]))
		expect(har.requests[0]?.cacheHeaders).toEqual({ 'cache-control': 'max-age=60' })
	})

	it('drops cookies, authorisation headers and bodies', () => {
		const raw = buildHar(`${ORIGIN}/`, [page(), { url: `${ORIGIN}/api`, dest: 'empty', mode: 'cors' }])
		expect(JSON.stringify(raw)).toContain('placeholder-cookie')
		const kept = JSON.stringify(parseHar(raw))
		expect(kept).not.toContain('placeholder-cookie')
		expect(kept).not.toContain('placeholder-token')
		expect(kept).not.toContain(SECRET_BODY)
	})

	it('skips entries without a usable URL and tolerates missing fields', () => {
		const har = parseHar({ log: { entries: [{ request: { url: `${ORIGIN}/` } }, { request: {} }, null, 'nonsense'] } })
		expect(har.requests).toHaveLength(1)
		expect(har.skipped).toBe(3)
		expect(har.requests[0]).toMatchObject({ method: 'GET', status: 0, transferSize: 0, bodySize: 0 })
	})

	it('rejects anything that is not a HAR', () => {
		expect(() => parseHar({})).toThrow(/Not a HAR file/)
		expect(() => parseHar(null)).toThrow(/Not a HAR file/)
		expect(() => parseHarText('<html>')).toThrow(/not valid JSON/)
	})
})
