import { html, nothing, type TemplateResult } from 'lit'
import type { Config } from '../engine/index.ts'
import { WORKBOX_EXPORT_DEFAULTS, generateWorkbox, type WorkboxExportOptions } from '../export/workbox.ts'
import { LightElement } from './base.ts'

/** A dialog showing the configuration as Workbox service worker source, to copy or download. */
export class SwtExport extends LightElement {
	static override properties = {
		config: { attribute: false },
		_options: { state: true },
		_copied: { state: true },
	}

	declare config: Config
	declare _options: WorkboxExportOptions
	declare _copied: boolean

	constructor() {
		super()
		this._options = WORKBOX_EXPORT_DEFAULTS
		this._copied = false
	}

	show(): void {
		this._copied = false
		this.querySelector('dialog')?.showModal()
	}

	#set(change: Partial<WorkboxExportOptions>): void {
		this._options = { ...this._options, ...change }
		this._copied = false
	}

	async #copy(source: string): Promise<void> {
		await navigator.clipboard.writeText(source)
		this._copied = true
	}

	#download(source: string): void {
		const url = URL.createObjectURL(new Blob([source], { type: 'text/plain' }))
		const link = document.createElement('a')
		link.href = url
		link.download = `sw.${this._options.language}`
		link.click()
		URL.revokeObjectURL(url)
	}

	#choice<K extends keyof WorkboxExportOptions>(legend: string, key: K, choices: [WorkboxExportOptions[K], string][]): TemplateResult {
		return html`
			<fieldset class="flex flex-wrap items-center gap-x-3 gap-y-1">
				<legend class="float-left mr-3 font-semibold">${legend}</legend>
				${choices.map(([choice, label]) => html`
					<label class="flex items-center gap-1">
						<input type="radio" name=${key} .checked=${this._options[key] === choice} @change=${() => this.#set({ [key]: choice })}>${label}
					</label>`)}
			</fieldset>`
	}

	protected override render(): TemplateResult {
		const source = generateWorkbox(this.config, this._options)
		return html`
			<dialog class="swt-dialog" aria-labelledby="swt-export-title">
				<div class="flex flex-col max-h-[90dvh]">
					<div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
						<h2 id="swt-export-title" class="text-lg font-semibold">Service worker source</h2>
						<form method="dialog"><button class="swt-btn">Close</button></form>
					</div>
					<div class="grid gap-2 px-4 py-3 border-b border-line">
						${this.#choice('Language', 'language', [['ts', 'TypeScript'], ['js', 'JavaScript']])}
						${this.config.precache.entries.length > 0
							? this.#choice('Precache list', 'precache', [['manifest', 'Filled in by the build'], ['inline', 'Written out here']])
							: nothing}
						<p class="max-w-[75ch] text-muted">
							Workbox code for these routes, in this order. It holds the caching rules only: an offline fallback,
							skipWaiting and error handling are yours to add around them.
						</p>
					</div>
					<pre class="flex-1 min-h-0 overflow-auto px-4 py-3 bg-sunken font-mono [tab-size:4]" tabindex="0"><code>${source}</code></pre>
					<div class="flex items-center gap-3 px-4 py-3 border-t border-line">
						<button type="button" class="swt-btn swt-btn-primary" @click=${() => this.#download(source)}>Download sw.${this._options.language}</button>
						<button type="button" class="swt-btn" @click=${() => this.#copy(source)}>Copy</button>
						<span class="text-muted" role="status">${this._copied ? 'Copied' : ''}</span>
					</div>
				</div>
			</dialog>`
	}
}

customElements.define('swt-export', SwtExport)
