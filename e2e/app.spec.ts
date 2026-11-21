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
	await expect(page.getByRole('button', { name: /1\. CDN images/ })).toContainText('3 requests')
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
	await expect(page.getByRole('button', { name: /1\. CDN images/ })).toContainText('3 requests')
	expect(errors).toEqual([])
})
