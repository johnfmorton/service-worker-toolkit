import { describe, expect, it } from 'vitest'
import { bestPage, parseHar, parseHarText, selectPage } from '../src/engine/index.ts'
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

	describe('a HAR recorded while a service worker was active', () => {
		const har = parseHar(buildHar(`${ORIGIN}/`, [
			// As the page made them: answered by the worker, no Sec-Fetch headers, no transfer size.
			{ url: `${ORIGIN}/`, resourceType: 'document', type: 'text/html', viaWorker: true, size: 18_000 },
			{ url: `${CDN}/a.jpg`, resourceType: 'image', type: 'image/jpeg', viaWorker: true, size: 500 },
			{ url: `${ORIGIN}/cached.css`, resourceType: 'stylesheet', type: 'text/css', viaWorker: true },
			// The worker's own fetches of the first two.
			{ url: `${ORIGIN}/`, resourceType: 'fetch', dest: 'empty', mode: 'navigate', type: 'text/html', size: 18_000 },
			{ url: `${CDN}/a.jpg`, resourceType: 'fetch', dest: 'empty', mode: 'no-cors', type: 'image/jpeg', size: 500, responseHeaders: { 'Cache-Control': 'max-age=60' } },
			// A fetch() the page made itself, which no worker answered.
			{ url: `${ORIGIN}/api`, resourceType: 'fetch', dest: 'empty', mode: 'cors', type: 'application/json' },
		]))

		it('folds each worker fetch into the request it answered', () => {
			expect(har.workerFetches).toBe(2)
			expect(har.requests.map((r) => new URL(r.url).pathname)).toEqual(['/', '/a.jpg', '/cached.css', '/api'])
			expect(har.requests.map((r) => r.index)).toEqual([0, 1, 2, 3])
			expect(har.requests[1]).toMatchObject({
				destination: 'image',
				destinationSource: 'resource-type',
				mode: 'no-cors',
				modeSource: 'worker-fetch',
				transferSize: 800,
				viaWorker: true,
				cacheHeaders: { 'cache-control': 'max-age=60' },
			})
			expect(har.requests[0]).toMatchObject({ destination: 'document', mode: 'navigate', modeSource: 'worker-fetch' })
		})

		it('keeps a request the worker answered from its cache, with what little is known', () => {
			expect(har.requests[2]).toMatchObject({ destination: 'style', mode: 'unknown', transferSize: 0, viaWorker: true })
		})

		it('leaves the page\'s own fetches alone', () => {
			expect(har.requests[3]).toMatchObject({ destination: 'empty', mode: 'cors', modeSource: 'header', viaWorker: false })
		})
	})

	describe('a HAR holding several page loads', () => {
		const har = parseHar(buildHar(`${ORIGIN}/`, [
			{ ...page('/first'), pageref: 'page_1' },
			{ url: `${ORIGIN}/a.js`, dest: 'script', mode: 'cors', pageref: 'page_1' },
			{ url: `${ORIGIN}/beacon`, dest: 'empty', mode: 'cors' },
			{ ...page('/second'), pageref: 'page_2' },
			{ url: `${ORIGIN}/b.js`, dest: 'script', mode: 'cors', pageref: 'page_2' },
		]))

		it('lists the pages and assigns every request to one', () => {
			expect(har.pages).toEqual([
				{ title: `${ORIGIN}/`, requests: 3, viaWorker: 0 },
				{ title: `${ORIGIN}/`, requests: 2, viaWorker: 0 },
			])
			// An entry with no page of its own stays with the load it followed.
			expect(har.requests.map((r) => r.page)).toEqual([0, 0, 0, 1, 1])
		})

		it('prefers the latest load recorded without a service worker', () => {
			expect(bestPage(har)).toBe(1)
			const loads = (viaWorker: boolean[]) => parseHar(buildHar(`${ORIGIN}/`, viaWorker.map((via, i) =>
				({ url: `${ORIGIN}/${i}`, resourceType: 'document', type: 'text/html', viaWorker: via, pageref: `page_${i}` }))))
			expect(bestPage(loads([true, false, true]))).toBe(1)
			expect(bestPage(loads([true, true]))).toBe(1)
			expect(bestPage(loads([false]))).toBeNull()
		})

		it('can be narrowed to one page load', () => {
			const second = selectPage(har, 1)
			expect(second.pageUrl).toBe(`${ORIGIN}/second`)
			expect(second.requests.map((r) => [r.index, new URL(r.url).pathname])).toEqual([[0, '/second'], [1, '/b.js']])
			expect(second.pages).toEqual(har.pages)
			// The original is untouched.
			expect(har.requests[3]?.index).toBe(3)
		})
	})
})
