import { html, nothing, type TemplateResult } from 'lit'
import { formatBytes, type CacheSummary } from '../engine/index.ts'
import { LightElement } from './base.ts'
import { count, warningIcon } from './format.ts'

/** What each cache would hold after this one page load. */
export class SwtCaches extends LightElement {
	static override properties = {
		caches: { attribute: false },
	}

	declare caches: CacheSummary[]

	protected override render(): TemplateResult | typeof nothing {
		if (this.caches.length === 0) return nothing
		return html`
			<details>
				<summary class="px-3 py-2 font-semibold cursor-pointer">${count(this.caches.length, 'cache')} after this page load</summary>
				<div class="overflow-x-auto border-t border-line">
					<table class="w-full text-left">
						<thead class="text-muted">
							<tr>
								<th class="px-3 py-1 font-semibold" scope="col">Cache</th>
								<th class="px-3 py-1 font-semibold swt-num" scope="col">Entries</th>
								<th class="px-3 py-1 font-semibold swt-num" scope="col">Limit</th>
								<th class="px-3 py-1 font-semibold swt-num" scope="col">Size</th>
								<th class="px-3 py-1 font-semibold swt-num" scope="col">Opaque</th>
							</tr>
						</thead>
						<tbody>
							${this.caches.map((cache) => html`
								<tr class="border-t border-line">
									<th class="px-3 py-1 font-mono font-normal" scope="row">${cache.cacheName}</th>
									<td class="px-3 py-1 swt-num">${cache.entries.toLocaleString('en')}</td>
									<td class="px-3 py-1 swt-num">
										${cache.exceedsMaxEntries ? html`${warningIcon()} <span class="text-warn">over </span>` : nothing}${cache.maxEntries ?? 'none'}
									</td>
									<td class="px-3 py-1 swt-num">${formatBytes(cache.bytes)}</td>
									<td class="px-3 py-1 swt-num">${cache.opaqueEntries}</td>
								</tr>`)}
						</tbody>
					</table>
				</div>
			</details>`
	}
}

customElements.define('swt-caches', SwtCaches)
