import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

// The promise that a HAR never leaves the browser is enforced, not just kept:
// connect-src 'none' makes any upload impossible. The server sends the same
// policy as a response header; this meta tag covers copies served without it.
// It is left out of the dev server, whose hot reload needs a WebSocket.
const CSP = [
	'default-src \'none\'',
	'script-src \'self\'',
	'worker-src \'self\'',
	'style-src \'self\'',
	'img-src \'self\' data:',
	'connect-src \'none\'',
	'base-uri \'none\'',
	'form-action \'none\'',
].join('; ')

const contentSecurityPolicy = (): Plugin => ({
	name: 'swt-content-security-policy',
	apply: 'build',
	transformIndexHtml: () => [{
		tag: 'meta',
		attrs: { 'http-equiv': 'Content-Security-Policy', 'content': CSP },
		injectTo: 'head-prepend',
	}],
})

export default defineConfig({
	plugins: [tailwindcss(), contentSecurityPolicy()],
	// Bound to IPv4 on purpose. Vite's default listens on "localhost", which can
	// resolve to IPv6 only; a container router (DDEV, OrbStack) holding the same
	// port on 127.0.0.1 then answers the browser instead, and Vite never notices
	// the clash. On 127.0.0.1 a taken port is detected and the next one is used.
	server: {
		host: '127.0.0.1',
		port: 5180,
	},
	preview: {
		host: '127.0.0.1',
		port: 4180,
	},
	build: {
		target: 'es2023',
	},
	worker: {
		format: 'es',
	},
})
