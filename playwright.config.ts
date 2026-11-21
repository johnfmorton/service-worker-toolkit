import { defineConfig, devices } from '@playwright/test'

// Runs against the production build, so the Content-Security-Policy that
// forbids uploads and inline styles is in force during the test.
export default defineConfig({
	testDir: 'e2e',
	fullyParallel: true,
	reporter: 'list',
	use: {
		baseURL: 'http://127.0.0.1:4174',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'npm run build && npx vite preview --port 4174 --strictPort',
		url: 'http://127.0.0.1:4174',
		reuseExistingServer: false,
	},
})
