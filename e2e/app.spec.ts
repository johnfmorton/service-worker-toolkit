/// <reference types="node" />
import { Buffer } from 'node:buffer'
import { expect, test, type Page } from '@playwright/test'
import { before } from '../fixtures/site-before-after.ts'

/** Fails the test on any console error, which is how a Content-Security-Policy violation shows up. */
function watchConsole(page: Page): string[] {
	const errors: string[] = []
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text())
	})
	page.on('pageerror', (error) => errors.push(error.message))
	return errors
}

const asFile = (name: string, value: unknown) =>
	({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) })

test('loading a HAR and a configuration shows the dead route', async ({ page }) => {
	const errors = watchConsole(page)
	const requests: string[] = []
	page.on('request', (request) => requests.push(request.url()))

	await page.goto('/')
	await page.getByLabel('Choose a HAR file').setInputFiles(asFile('site.har', before.har))
	await expect(page.getByRole('heading', { name: '14 requests' })).toBeVisible()
	// No routes yet: nothing is handled.
	await expect(page.getByRole('button', { name: /Not handled by the worker/ })).toContainText('14 requests')

	await page.getByLabel('Load configuration').setInputFiles(asFile('config.json', before.config))
	await expect(page.locator('swt-warnings summary')).toHaveText('6 warnings')
	await expect(page.locator('swt-warnings').getByText('Dead route')).toBeVisible()

	// The dead route keeps its group in the table, empty, with the reason.
	const table = page.getByRole('table', { name: 'Requests' })
	await expect(table.getByRole('button', { name: /2\. CDN files/ })).toContainText('0 requests')
	await expect(table.getByText(/"CDN files" never runs/)).toBeVisible()

	// A warning narrows the table to the requests behind it.
	await page.getByRole('button', { name: 'Show 4 requests' }).click()
	await expect(page.getByRole('heading', { name: '4 of 14 requests' })).toBeVisible()
	await expect(table.getByText('/images/hero.jpg')).toBeVisible()
	await expect(table.getByText('/dist/assets/app-D4f8a1Zc.js')).toBeHidden()

	expect(errors).toEqual([])
	// Nothing left the page: every request was for the app's own files.
	expect(requests.filter((url) => !url.startsWith('http://127.0.0.1:4174/'))).toEqual([])
})

test('the fixed example raises no dead route', async ({ page }) => {
	const errors = watchConsole(page)
	await page.goto('/')
	await page.getByRole('button', { name: 'Load the same worker, fixed' }).click()
	await expect(page.locator('swt-warnings summary')).toHaveText('1 warning')
	await expect(page.locator('swt-warnings').getByText('Dead route')).toBeHidden()
	await expect(page.getByRole('table', { name: 'Requests' }).getByRole('button', { name: /1\. CDN images/ })).toContainText('3 requests')
	expect(errors).toEqual([])
})

test('a file that is not a HAR is refused with a reason', async ({ page }) => {
	await page.goto('/')
	await page.getByLabel('Choose a HAR file').setInputFiles(asFile('notes.json', { hello: 'world' }))
	await expect(page.getByRole('alert')).toContainText('Not a HAR file')
})

test('the example configuration downloads and loads back', async ({ page }) => {
	const errors = watchConsole(page)
	await page.goto('/')
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Download an example configuration' }).click(),
	])
	expect(download.suggestedFilename()).toBe('example-configuration.json')

	await page.getByLabel('Choose a HAR file').setInputFiles(asFile('site.har', before.har))
	await page.getByLabel('Load configuration').setInputFiles(await download.path())
	await expect(page.getByRole('table', { name: 'Requests' }).getByRole('button', { name: /1\. CDN images/ })).toContainText('3 requests')
	expect(errors).toEqual([])
})

test.describe('the route editor', () => {
	const order = (page: Page) => page.locator('swt-config li[data-route]').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-route')))
	const deadRoute = (page: Page) => page.locator('swt-warnings').getByText('Dead route')

	test('dragging the broad route below the narrow one clears the dead route', async ({ page }) => {
		const errors = watchConsole(page)
		await page.goto('/')
		await page.getByRole('button', { name: 'Load a worker with seven bugs' }).click()
		await expect(deadRoute(page)).toBeVisible()
		expect(await order(page)).toEqual(['pages', 'cdn'])

		const target = page.locator('li[data-route="cdn"]')
		const box = await target.boundingBox()
		await page.locator('li[data-route="pages"] .swt-grip').dragTo(target, { targetPosition: { x: 40, y: (box?.height ?? 0) - 6 } })

		expect(await order(page)).toEqual(['cdn', 'pages'])
		await expect(deadRoute(page)).toBeHidden()
		await expect(page.getByRole('table', { name: 'Requests' }).getByRole('button', { name: /1\. CDN files/ })).toContainText('4 requests')
		expect(errors).toEqual([])
	})

	test('a route can be reordered from the keyboard, and the move is announced', async ({ page }) => {
		await page.goto('/')
		await page.getByRole('button', { name: 'Load a worker with seven bugs' }).click()
		await expect(deadRoute(page)).toBeVisible()

		const down = page.getByRole('button', { name: 'Move Pages down' })
		await down.focus()
		await page.keyboard.press('Enter')

		expect(await order(page)).toEqual(['cdn', 'pages'])
		await expect(deadRoute(page)).toBeHidden()
		await expect(page.locator('swt-config [aria-live]')).toHaveText('Pages moved to position 2 of 2.')
		// Focus stays on the control that was used, even though it can go no further.
		await expect(down).toBeFocused()
		await expect(down).toHaveAttribute('aria-disabled', 'true')
	})

	test('routes can be added, edited and deleted, and survive a reload', async ({ page }) => {
		const errors = watchConsole(page)
		const table = page.getByRole('table', { name: 'Requests' })
		await page.goto('/')
		await page.getByLabel('Choose a HAR file').setInputFiles(asFile('site.har', before.har))

		await page.getByRole('button', { name: 'Add a route' }).click()
		await page.getByLabel('Name', { exact: true }).fill('Images')
		await page.getByLabel('Condition', { exact: true }).selectOption('destination')
		await expect(table.getByRole('button', { name: /1\. Images/ })).toContainText('5 requests')
		await page.getByLabel('Strategy').selectOption('cache-first')
		await page.getByLabel('Cache name').fill('image-cache')
		await page.getByLabel('Most entries').fill('2')
		await expect(table.getByRole('button', { name: /1\. Images/ })).toContainText('Cache first')

		// Saved in this browser: a reload and the same HAR bring the route back.
		await page.reload()
		await page.getByLabel('Choose a HAR file').setInputFiles(asFile('site.har', before.har))
		await expect(table.getByRole('button', { name: /1\. Images/ })).toContainText('5 requests')
		await expect(page.locator('li[data-route]')).toContainText('at most 2 entries')

		await page.locator('swt-config').getByRole('button', { name: /1\. Images/ }).click()
		await page.getByRole('button', { name: 'Delete this route' }).click()
		await expect(page.locator('li[data-route]')).toHaveCount(0)
		await page.getByRole('button', { name: 'Undo' }).click()
		await expect(page.locator('li[data-route]')).toHaveCount(1)
		expect(errors).toEqual([])
	})

	test('an example does not replace the saved configuration', async ({ page }) => {
		await page.goto('/')
		await page.getByLabel('Choose a HAR file').setInputFiles(asFile('site.har', before.har))
		await page.getByRole('button', { name: 'Add a route' }).click()
		await page.getByLabel('Name', { exact: true }).fill('Mine')

		await page.reload()
		await page.getByRole('button', { name: 'Load the same worker, fixed' }).click()
		await page.getByRole('button', { name: 'Move CDN images down' }).click()
		await page.getByLabel('Load another HAR').setInputFiles(asFile('site.har', before.har))
		await expect.poll(() => order(page)).toEqual(['route-1'])
		await expect(page.locator('li[data-route]')).toContainText('Mine')
	})
})

test('the service worker source can be exported', async ({ page, context }) => {
	const errors = watchConsole(page)
	await context.grantPermissions(['clipboard-read', 'clipboard-write'])
	await page.goto('/')
	await page.getByRole('button', { name: 'Load the same worker, fixed' }).click()
	await page.getByRole('button', { name: 'Export service worker' }).click()

	const dialog = page.getByRole('dialog', { name: 'Service worker source' })
	await expect(dialog).toContainText('precacheAndRoute(self.__WB_MANIFEST)')
	await expect(dialog).toContainText('declare const self: ServiceWorkerGlobalScope')

	await dialog.getByLabel('JavaScript').check()
	await dialog.getByLabel('Written out here').check()
	await expect(dialog).not.toContainText('declare const self')
	await expect(dialog).toContainText('{ url: \'offline-message.html\', revision: \'000b34\' },')

	await dialog.getByRole('button', { name: 'Copy' }).click()
	await expect(dialog.getByRole('status')).toHaveText('Copied')
	expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('registerRoute(')

	const [download] = await Promise.all([
		page.waitForEvent('download'),
		dialog.getByRole('button', { name: 'Download sw.js' }).click(),
	])
	expect(download.suggestedFilename()).toBe('sw.js')

	await dialog.getByRole('button', { name: 'Close' }).click()
	await expect(dialog).toBeHidden()
	expect(errors).toEqual([])
})

test('the two cache options can be set in the editor and reach the export', async ({ page }) => {
	await page.goto('/')
	await page.getByLabel('Choose a HAR file').setInputFiles(asFile('site.har', before.har))
	await page.getByRole('button', { name: 'Add a route' }).click()

	// Purging is part of expiry, so it waits for a limit.
	const purge = page.getByLabel(/Empty this cache if storage runs out/)
	await expect(purge).toBeDisabled()
	await page.getByLabel('Most entries').fill('20')
	await purge.check()
	await page.getByLabel('Ignore the Vary header when matching cached responses').check()

	await page.getByRole('button', { name: 'Export service worker' }).click()
	const dialog = page.getByRole('dialog', { name: 'Service worker source' })
	await expect(dialog).toContainText('matchOptions: { ignoreVary: true },')
	await expect(dialog).toContainText('purgeOnQuotaError: true,')
})
