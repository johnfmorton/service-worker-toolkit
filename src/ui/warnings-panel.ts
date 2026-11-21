import { html, nothing, type TemplateResult } from 'lit'
import type { Config, Warning } from '../engine/index.ts'
import { LightElement } from './base.ts'
import { WARNING_NAMES, count, warningIcon } from './format.ts'

/** The warnings for the current simulation. Fires `select-warning` with a warning index, or null. */
export class SwtWarnings extends LightElement {
	static override properties = {
		warnings: { attribute: false },
		config: { attribute: false },
		selected: { attribute: false },
	}

	declare warnings: Warning[]
	declare config: Config
	declare selected: number | null

	#select(index: number | null): void {
		this.dispatchEvent(new CustomEvent('select-warning', { detail: index, bubbles: true }))
	}

	#item(warning: Warning, index: number): TemplateResult {
		const pressed = this.selected === index
		return html`
			<li class="flex items-start gap-2 px-3 py-2 border-t border-line">
				<span class="pt-0.5">${warningIcon()}</span>
				<div class="min-w-0 flex-1">
					<p class="font-semibold">${WARNING_NAMES[warning.code]}</p>
					<p class="max-w-[75ch] text-muted">${warning.message}</p>
				</div>
				${warning.requestIndexes.length > 0
					? html`<button
						type="button"
						class="swt-btn flex-none"
						aria-pressed=${pressed ? 'true' : 'false'}
						@click=${() => this.#select(pressed ? null : index)}
					>${pressed ? 'Show all requests' : `Show ${count(warning.requestIndexes.length, 'request')}`}</button>`
					: nothing}
			</li>`
	}

	protected override render(): TemplateResult {
		if (this.warnings.length === 0) {
			return html`<p class="px-3 py-2 text-muted">No warnings for this page load.</p>`
		}
		return html`
			<details open>
				<summary class="px-3 py-2 font-semibold cursor-pointer bg-warn-bg text-warn">
					${count(this.warnings.length, 'warning')}
				</summary>
				<ul class="max-h-[32vh] overflow-auto">${this.warnings.map((warning, i) => this.#item(warning, i))}</ul>
			</details>`
	}
}

customElements.define('swt-warnings', SwtWarnings)
