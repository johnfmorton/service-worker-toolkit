import { describe, expect, it } from 'vitest'
import { after, before } from '../fixtures/site-before-after.ts'
import { ConfigError, emptyConfig, parseConfig } from '../src/engine/index.ts'

describe('parseConfig', () => {
	it('round-trips a real configuration through JSON unchanged', () => {
		for (const { config } of [before, after]) {
			expect(parseConfig(JSON.parse(JSON.stringify(config)))).toEqual(config)
		}
		expect(parseConfig(emptyConfig('https://example.com'))).toEqual(emptyConfig('https://example.com'))
	})

	it('fills in names and ids, and accepts precache entries as plain strings', () => {
		const config = parseConfig({
			version: 1,
			origin: 'https://example.com',
			precache: { entries: ['offline.html'] },
			routes: [{ strategy: 'cache-first' }, { id: 'default', strategy: 'network-only', method: 'post' }],
		})
		expect(config.precache.entries).toEqual([{ url: 'offline.html' }])
		expect(config.routes).toEqual([
			{ id: 'route-1', name: 'route-1', conditions: [], strategy: 'cache-first', cacheName: '' },
			{ id: 'default-2', name: 'default-2', conditions: [], method: 'POST', strategy: 'network-only', cacheName: '' },
		])
		expect(config.defaultHandler).toBeNull()
	})

	it('drops fields it does not know', () => {
		const config = parseConfig({ version: 1, origin: 'https://example.com', secret: 'x', routes: [{ strategy: 'cache-first', extra: 1 }] })
		expect(JSON.stringify(config)).not.toMatch(/secret|extra/)
	})

	it('lists every problem at once', () => {
		const attempt = () => parseConfig({
			version: 2,
			routes: [
				{ strategy: 'cache-sometimes' },
				{ strategy: 'cache-first', conditions: [{ type: 'path-prefix' }, { type: 'colour' }], options: { maxEntries: -1 } },
			],
		})
		expect(attempt).toThrow(ConfigError)
		try {
			attempt()
		} catch (error) {
			expect((error as ConfigError).problems).toEqual([
				'Unsupported version 2; expected 1.',
				'The site origin is missing.',
				'Route 1 has an unknown strategy "cache-sometimes".',
				'Route 2 maxEntries must be a whole number.',
				'Route 2 condition 1 (path-prefix) has a missing or wrong value.',
				'Route 2 condition 2 has an unknown type "colour".',
			])
		}
	})

	it('rejects a value that is not an object', () => {
		expect(() => parseConfig([])).toThrow(/Expected a JSON object/)
	})
})
