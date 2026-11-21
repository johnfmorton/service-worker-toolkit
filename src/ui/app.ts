import { html, nothing, type TemplateResult } from 'lit'
import { emptyConfig, parseConfig } from '../engine/index.ts'
import type { Config, ParsedHar, SimulationResult } from '../engine/index.ts'
import { LightElement } from './base.ts'
import { EngineClient, type LoadedHar } from './engine-client.ts'
import { count } from './format.ts'
import './caches-panel.ts'
import './config-pane.ts'
import './results-table.ts'
import './warnings-panel.ts'

const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/** The whole app: owns the loaded HAR, the configuration and the latest simulation. */
export class SwtApp extends LightElement {
	static override properties = {
		_har: { state: true },
		_harName: { state: true },
		_page: { state: true },
		_config: { state: true },
		_result: { state: true },
		_busy: { state: true },
		_error: { state: true },
		_focusWarning: { state: true },
	}

	declare _har: ParsedHar | null
	declare _harName: string
	/** Which page load of the HAR is shown, or null for all of them. */
	declare _page: number | null
	declare _config: Config | null
	declare _result: SimulationResult | null
	declare _busy: string
	declare _error: string
	declare _focusWarning: number | null

	#engine = new EngineClient()
	/** Counts simulations, so a slow one cannot overwrite a newer result. */
	#run = 0

	constructor() {
		super()
		this._har = null
		this._harName = ''
		this._page = null
		this._config = null
		this._result = null
		this._busy = ''
		this._error = ''
		this._focusWarning = null
	}

	async #task(label: string, work: () => Promise<void>): Promise<void> {
		this._busy = label
		this._error = ''
		try {
			await work()
		} catch (error) {
			this._error = message(error)
		} finally {
			this._busy = ''
		}
	}

	async #simulate(): Promise<void> {
		if (!this._har || !this._config) return
		const run = ++this.#run
		const result = await this.#engine.simulate(this._config)
		if (run !== this.#run) return
		this._focusWarning = null
		this._result = result
	}

	async #useHar({ har, page }: LoadedHar, name: string): Promise<void> {
		if (har.requests.length === 0) throw new Error('That HAR file has no requests in it.')
		this._result = null
		this._har = har
		this._page = page
		this._harName = name
		// A configuration loaded earlier stays; without one, start empty on the HAR's own origin.
		this._config ??= emptyConfig(har.origin ?? '')
		await this.#simulate()
	}

	#loadHar(file: File): Promise<void> {
		return this.#task(`Reading ${file.name}`, async () => {
			await this.#useHar(await this.#engine.loadFile(file), file.name)
		})
	}

	#selectPage(page: number | null): Promise<void> {
		return this.#task('Switching page load', async () => {
			await this.#useHar(await this.#engine.selectPage(page), this._harName)
		})
	}

	#loadConfig(file: File): Promise<void> {
		return this.#task(`Reading ${file.name}`, async () => {
			let json: unknown
			try {
				json = JSON.parse(await file.text())
			} catch {
				throw new Error(`${file.name} is not valid JSON.`)
			}
			this._config = parseConfig(json)
			await this.#simulate()
		})
	}

	#loadExample(which: 'before' | 'after'): Promise<void> {
		return this.#task('Loading the example', async () => {
			// Fetched only on demand: the example is not part of the page's first load.
			const example = (await import('../../fixtures/site-before-after.ts'))[which]
			this._config = example.config
			await this.#useHar(await this.#engine.loadJson(example.har), which === 'before' ? 'Example: a worker with seven bugs' : 'Example: the same worker, fixed')
		})
	}

	/** A dropped file is a HAR if it starts like one; anything else is taken as a configuration. */
	async #loadDropped(file: File): Promise<void> {
		const head = await file.slice(0, 4096).text()
		await (/"log"\s*:/.test(head) ? this.#loadHar(file) : this.#loadConfig(file))
	}

	#onDrop(event: DragEvent): void {
		event.preventDefault()
		const file = event.dataTransfer?.files[0]
		if (file) void this.#loadDropped(file)
	}

	#filePicker(label: string, accept: string, load: (file: File) => Promise<void>, primary = false): TemplateResult {
		return html`
			<label class="swt-btn ${primary ? 'swt-btn-primary' : ''}">
				<input
					class="sr-only"
					type="file"
					accept=${accept}
					@change=${(event: Event) => {
						const input = event.target as HTMLInputElement
						const file = input.files?.[0]
						input.value = ''
						if (file) void load(file)
					}}
				>${label}
			</label>`
	}

	#status(): TemplateResult {
		return html`
			<p class="text-muted" role="status">${this._busy ? `${this._busy}…` : ''}</p>
			${this._error ? html`<p class="px-3 py-2 border border-error rounded text-error" role="alert">${this._error}</p>` : nothing}`
	}

	/** Saves the fixed example's configuration as a file, as a starting point to edit. */
	#downloadExampleConfig(): Promise<void> {
		return this.#task('Preparing the example configuration', async () => {
			const { after } = await import('../../fixtures/site-before-after.ts')
			const url = URL.createObjectURL(new Blob([JSON.stringify(after.config, null, '\t')], { type: 'application/json' }))
			const link = document.createElement('a')
			link.href = url
			link.download = 'example-configuration.json'
			link.click()
			URL.revokeObjectURL(url)
		})
	}

	#step(number: number, title: string, body: TemplateResult): TemplateResult {
		return html`
			<li class="grid gap-2 py-5 border-t border-line sm:grid-cols-[2rem_minmax(0,1fr)]">
				<span class="text-lg font-semibold text-muted" aria-hidden="true">${number}</span>
				<div class="grid gap-2 max-w-[70ch]">
					<h2 class="text-lg font-semibold">${title}</h2>
					${body}
				</div>
			</li>`
	}

	#welcome(): TemplateResult {
		return html`
			<main class="mx-auto max-w-[50rem] px-6 py-12">
				<h1 class="text-xl font-semibold text-balance">See what your service worker would do, before you deploy it</h1>
				<p class="mt-3 max-w-[70ch]">
					A service worker's caching rules fail quietly. A route that is too broad takes the requests meant
					for the routes after it; a cache fills with the wrong files; a precached font is never used.
					Nothing raises an error. This tool takes a recording of one page load of your site and a set of
					routes, and shows which route would handle every request, what each cache would end up holding,
					and which of those mistakes the routes make.
				</p>
				<p class="mt-3 flex flex-wrap items-center gap-3">
					<span>To see it working first:</span>
					<button type="button" class="swt-btn" @click=${() => this.#loadExample('before')}>Load a worker with seven bugs</button>
					<button type="button" class="swt-btn" @click=${() => this.#loadExample('after')}>Load the same worker, fixed</button>
				</p>

				<ol class="mt-8">
					${this.#step(1, 'Record one page load as a HAR file', html`
						<p>
							A HAR file is the browser's own record of every request a page made. Record it in Chrome,
							which notes how each request was made (its destination and mode); the routes are matched on those.
						</p>
						<ol class="pl-5 list-decimal grid gap-1">
							<li>Open the page you want to test, then open DevTools on that tab.</li>
							<li>
								If the site already has a service worker, go to Application, then Service workers, and tick
								<strong>Bypass for network</strong>. Otherwise the recording shows what the old worker did,
								and anything it served from its cache has no size or mode.
							</li>
							<li>
								In the Network panel, untick <strong>Keep log</strong> and tick <strong>Disable cache</strong>,
								so the file holds one complete page load and nothing left over from earlier ones.
							</li>
							<li>Reload the page and wait for it to finish. Scroll to the bottom if images load as you scroll.</li>
							<li>Click the download arrow in the Network toolbar, labelled <strong>Export HAR</strong>.</li>
						</ol>
						<p class="text-muted">
							Firefox and Safari can export a HAR too (right-click a request in their Network panel), but
							they may leave out the destination and mode. Values the tool had to infer are marked with an asterisk.
						</p>`)}

					${this.#step(2, 'Load the file here', html`
						<div class="flex flex-wrap items-center gap-3">
							${this.#filePicker('Choose a HAR file', '.har,.json,application/json', (file) => this.#loadHar(file), true)}
							<span class="text-muted">or drop one anywhere on this page</span>
						</div>
						<p>
							The file is read in this page and never uploaded. Cookies, authorisation headers and
							response bodies are discarded as it is read.
						</p>
						<p class="text-muted">
							If the file holds several page loads, or was recorded through a service worker, the tool says so
							and tells you what that costs.
						</p>
						${this.#status()}`)}

					${this.#step(3, 'Add your routes', html`
						<p>
							Routes come from a configuration file: the precache list, the routes in the order the worker
							registers them, and the default handler. Each route has conditions (origin, path, destination,
							mode), a strategy and a cache name. Once a HAR is loaded, use <strong>Load configuration</strong>
							at the top of the page.
						</p>
						<p>
							There is no editor in the page yet, so for now the file is written by hand.
							The example is the quickest way to learn the format.
						</p>
						<div>
							<button type="button" class="swt-btn" @click=${() => this.#downloadExampleConfig()}>Download an example configuration</button>
						</div>`)}

					${this.#step(4, 'Read the result', html`
						<ul class="pl-5 list-disc grid gap-1">
							<li>
								<strong>Requests are grouped by the route that would handle them</strong>, in route order, with
								a count and total size for each. A route with no requests keeps its group, with the reason:
								that empty group is usually the bug.
							</li>
							<li><strong>Warnings</strong> sit above the table. Each can narrow the table to the requests behind it.</li>
							<li><strong>Caches</strong> shows what each cache would hold after this one page load, and whether that is already over its limit.</li>
							<li>“Not handled by the worker” is everything no route matched, which goes to the network as if there were no worker.</li>
						</ul>
						<p class="text-muted">
							The result describes this one page load. It does not model repeat visits, cache expiry or being offline.
						</p>`)}
				</ol>
			</main>`
	}

	#workspace(har: ParsedHar, config: Config): TemplateResult {
		const result = this._result
		const inferred = har.requests.filter((request) => request.modeSource !== 'header' && request.modeSource !== 'worker-fetch').length
		const viaWorker = har.requests.filter((request) => request.viaWorker).length
		// Answered from the worker's cache: no fetch was recorded, so no size and no mode.
		const fromWorkerCache = har.requests.filter((request) => request.viaWorker && request.modeSource === 'unknown').length
		const cleanLoads = har.pages.filter((page) => page.requests > 0 && page.viaWorker === 0).length
		return html`
			<div class="flex flex-col lg:h-dvh">
				<header class="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 border-b border-line bg-surface">
					<h1 class="font-semibold">Service Worker Toolkit</h1>
					<p class="mr-auto text-muted truncate">${this._harName}, ${count(har.requests.length, 'request')}</p>
					${this.#status()}
					${this.#filePicker('Load another HAR', '.har,.json,application/json', (file) => this.#loadHar(file))}
					${this.#filePicker('Load configuration', '.json,application/json', (file) => this.#loadConfig(file))}
				</header>

				${har.pages.length > 1
					? html`<p class="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-line bg-warn-bg">
						<label for="swt-page">This HAR holds ${har.pages.length} page loads, which happens when “Keep log” is ticked. Showing</label>
						<select
							id="swt-page"
							class="swt-field"
							@change=${(event: Event) => {
								const value = (event.target as HTMLSelectElement).value
								void this.#selectPage(value === 'all' ? null : Number(value))
							}}
						>
							${har.pages.map((page, i) => html`<option value=${i} ?selected=${this._page === i}>load ${i + 1} of ${har.pages.length} (${count(page.requests, 'request')}${page.viaWorker > 0 ? ', through a service worker' : ''})</option>`)}
							<option value="all" ?selected=${this._page === null}>all of them together</option>
						</select>
					</p>`
					: nothing}

				${viaWorker > 0
					? html`<p class="px-3 py-1.5 border-b border-line bg-warn-bg">
						A service worker was already running during this page load and answered ${count(viaWorker, 'request')}.
						${fromWorkerCache > 0
							? `It served ${fromWorkerCache} of them from its cache, so their size and fetch mode were never recorded, and warnings that depend on those will be missing.`
							: 'Its own fetches have been folded into them, and their modes (marked *) are read from those fetches.'}
						${cleanLoads > 0
							? 'This file also has a load recorded without the worker: choose it above.'
							: 'For an exact recording, open DevTools on the site itself, tick “Bypass for network” under Application, Service workers, then reload and export.'}
					</p>`
					: nothing}

				${viaWorker === 0 && inferred > har.requests.length / 2
					? html`<p class="px-3 py-1.5 border-b border-line bg-warn-bg">
						This HAR does not record the fetch mode of ${count(inferred, 'request')}, so warnings that depend on it (opaque responses, CORS) may be missing. Values marked * are inferred.
					</p>`
					: nothing}

				<div class="lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:flex-1 lg:min-h-0">
					<swt-config class="p-3 border-b border-line lg:border-b-0 lg:border-r lg:overflow-auto" .config=${config} .result=${result}></swt-config>
					${result
						? html`<div class="flex flex-col min-w-0 lg:min-h-0" @select-warning=${(event: CustomEvent<number | null>) => { this._focusWarning = event.detail }}>
							<swt-warnings class="border-b border-line" .warnings=${result.warnings} .config=${config} .selected=${this._focusWarning}></swt-warnings>
							<swt-caches class="border-b border-line" .caches=${result.caches}></swt-caches>
							<swt-results class="flex flex-col h-[75vh] lg:h-auto lg:flex-1 lg:min-h-0" .har=${har} .config=${config} .result=${result} .focusWarning=${this._focusWarning}></swt-results>
						</div>`
						: nothing}
				</div>
			</div>`
	}

	protected override render(): TemplateResult {
		const body = this._har && this._config ? this.#workspace(this._har, this._config) : this.#welcome()
		return html`<div class="min-h-dvh" @dragover=${(event: DragEvent) => event.preventDefault()} @drop=${this.#onDrop}>${body}</div>`
	}
}

customElements.define('swt-app', SwtApp)
