import { html, nothing, type TemplateResult } from 'lit'
import { formatBytes, type Config, type Handler, type SimulationResult } from '../engine/index.ts'
import { LightElement } from './base.ts'
import { count, describeCondition, describeOptions, strategyLabel, warningIcon } from './format.ts'

/** The configuration, read-only: the precache, the routes in order, and the default handler. */
export class SwtConfig extends LightElement {
	static override properties = {
		config: { attribute: false },
		result: { attribute: false },
	}

	declare config: Config
	declare result: SimulationResult | null

	#handler(handler: Handler): TemplateResult {
		const options = describeOptions(handler)
		return html`
			<p class="mt-1 flex flex-wrap items-baseline gap-x-2">
				${strategyLabel(handler.strategy)}
				${handler.strategy === 'network-only' ? nothing : html`<span class="font-mono text-muted">${handler.cacheName}</span>`}
			</p>
			${options.length > 0 ? html`<p class="mt-1 text-muted">${options.join('; ')}</p>` : nothing}`
	}

	#card(title: TemplateResult | string, matched: number | undefined, dead: boolean, body: TemplateResult): TemplateResult {
		return html`
			<li class="p-3 border border-line rounded bg-surface">
				<div class="flex items-baseline justify-between gap-2">
					<h3 class="font-semibold">${title}</h3>
					${matched === undefined
						? nothing
						: html`<span class="flex-none ${dead ? 'text-warn font-semibold' : 'text-muted'}">${dead ? html`${warningIcon()} ` : nothing}${count(matched, 'request')}</span>`}
				</div>
				${body}
			</li>`
	}

	protected override render(): TemplateResult {
		const { config, result } = this
		const precache = config.precache.entries.length
		return html`
			<h2 class="text-lg font-semibold">Configuration</h2>
			<p class="mt-1 text-muted">Site origin <span class="font-mono text-fg">${config.origin || 'not set'}</span></p>

			${result && result.configProblems.length > 0
				? html`<ul class="mt-3 p-3 border border-line rounded bg-warn-bg text-warn" role="alert">
					${result.configProblems.map((problem) => html`<li>${problem.message}</li>`)}
				</ul>`
				: nothing}

			<ol class="mt-3 grid gap-2">
				${precache > 0
					? this.#card('Precache', result?.precache.count, false, html`
						<p class="mt-1 text-muted">
							${count(precache, 'file')}${result ? `, ${formatBytes(result.precache.knownBytes)}` : ''}${result && result.precache.unknownSizeCount > 0 ? ` plus ${result.precache.unknownSizeCount} of unknown size` : ''}.
							Answered before any route.
						</p>`)
					: nothing}

				${config.routes.map((route, i) => {
					const summary = result?.routes[i]
					const dead = summary !== undefined && summary.count === 0 && summary.shadowedCount > 0
					return this.#card(html`<span class="text-muted font-normal">${i + 1}.</span> ${route.name}`, summary?.count, dead, html`
						${this.#handler(route)}
						${route.conditions.length === 0
							? html`<p class="mt-1">Matches every ${route.method ?? 'GET'} request.</p>`
							: html`<ul class="mt-1">${route.conditions.map((condition) => html`<li>${describeCondition(condition)}</li>`)}</ul>`}`)
				})}

				${config.defaultHandler
					? this.#card('Default handler', result?.defaultHandler.count, false, html`
						${this.#handler(config.defaultHandler)}
						<p class="mt-1 text-muted">Takes whatever no route matched.</p>`)
					: nothing}
			</ol>

			${config.routes.length === 0
				? html`<p class="mt-3 max-w-[60ch] text-muted">
					No routes yet, so every request goes straight to the network. Load a configuration file to see how its routes would sort these requests.
				</p>`
				: nothing}`
	}
}

customElements.define('swt-config', SwtConfig)
