import { describe, expect, it } from 'vitest'
import { looksVersioned } from '../src/engine/index.ts'

const versioned = (path: string) => looksVersioned(new URL(path, 'https://example.com'))

describe('looksVersioned', () => {
	it.each([
		'/dist/assets/app-D4f8a1Zc.js',
		'/dist/assets/app-BdKQzXnA.css',
		'/dist/assets/index-B-x2_9Qz.js',
		'/build/main.3f9a2c1b.js',
		'/build/main.3f9a2c1b.min.js',
		'/_next/static/chunks/8a3c1f0e9b2d4c5a.js',
		'/vendor/jquery-3.7.1.min.js',
		'/npm/lit@3.2.0/index.js',
		'/static/fonts/Body.woff2?v=1.0',
		'/app.css?8f3a2c',
	])('%s is versioned', (path) => expect(versioned(path)).toBe(true))

	it.each([
		'/dist/assets/favicons/favicon-32x32.png',
		'/dist/assets/favicons/apple-touch-icon-180x180.png',
		'/images/hero.jpg',
		'/css/bootstrap5.css',
		'/js/MyComponent.js',
		'/static/a-web-font.woff2',
		'/photo.jpg?width=300',
		'/',
	])('%s is not versioned', (path) => expect(versioned(path)).toBe(false))
})
