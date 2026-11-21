import { html, nothing, type TemplateResult } from 'lit'
import { repeat } from 'lit/directives/repeat.js'
import { formatBytes } from '../engine/index.ts'
import type { Condition, Config, Destination, Handler, HandlerOptions, Mode, Route, SimulationResult, Strategy } from '../engine/index.ts'
import { LightElement } from './base.ts'
import { STRATEGY_NAMES, count, describeCondition, describeOptions, icon, strategyLabel, warningIcon } from './format.ts'

const STRATEGIES = Object.keys(STRATEGY_NAMES) as Strategy[]
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']

const CONDITION_NAMES: Record<Condition['type'], string> = {
	'same-origin': 'Site\'s own origin',
	'origin': 'Origin',
	'path-prefix': 'Path starts with',
	'path-pattern': 'Path matches pattern',
	'query-param': 'Has query parameter',
	'destination': 'Destination',
	'mode': 'Mode',
}

/** The destinations worth a tick box. Any other value already in a condition is shown too. */
const DESTINATIONS: Destination[] = ['document', 'script', 'style', 'image', 'font', 'audio', 'video', 'manifest', 'iframe', 'worker', 'empty']
const MODES: Mode[] = ['navigate', 'cors', 'no-cors', 'same-origin']

const AGE_UNITS = [
	{ name: 'days', seconds: 86_400 },
	{ name: 'hours', seconds: 3600 },
	{ name: 'minutes', seconds: 60 },
	{ name: 'seconds', seconds: 1 },
] as const

const value = (event: Event) => (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value

/** A whole number of zero or more from a number field, or undefined when it is empty or invalid. */
function wholeNumber(event: Event): number | undefined {
	const n = (event.target as HTMLInputElement).valueAsNumber
	return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
}

function ageUnit(seconds: number | undefined): (typeof AGE_UNITS)[number] {
	return AGE_UNITS.find((unit) => seconds !== undefined && seconds > 0 && seconds % unit.seconds === 0) ?? AGE_UNITS[0]
}

/**
 * The configuration, editable in place: the site origin, the precache, the
 * routes as an ordered list of cards, and the default handler.
 *
 * Every edit fires `config-change` with a complete new Config; this element
 * keeps no copy of its own, so what is shown is always what was simulated.
 */
export class SwtConfig extends LightElement {
	static override properties = {
		config: { attribute: false },
		result: { attribute: false },
		harOrigin: { attribute: false },
		_expanded: { state: true },
		_dropAt: { state: true },
		_undo: { state: true },
		_announcement: { state: true },
	}

	declare config: Config
	declare result: SimulationResult | null
	/** The origin the loaded HAR was recorded on, to offer when the configuration names another. */
	declare harOrigin: string | null
	/** The card open for editing: 'precache', 'default' or a route id. */
	declare _expanded: string | null
	/** While dragging: the position the dragged route would be dropped at. */
	declare _dropAt: number | null
	declare _undo: { config: Config, label: string } | null
	/** Read out by screen readers after a move. */
	declare _announcement: string

	#dragging: string | null = null
	/** Selector of the control to focus once the next render is done. */
	#refocus: string | null = null

	constructor() {
		super()
		this.result = null
		this.harOrigin = null
		this._expanded = null
		this._dropAt = null
		this._undo = null
		this._announcement = ''
	}

	// --- Changing the configuration ---------------------------------------

	#emit(config: Config): void {
		this.dispatchEvent(new CustomEvent('config-change', { detail: config, bubbles: true }))
	}

	/** Applies a change to a copy of the configuration and sends it on. A label makes the change undoable. */
	#change(mutate: (draft: Config) => void, undoLabel?: string): void {
		const draft = structuredClone(this.config)
		mutate(draft)
		this._undo = undoLabel === undefined ? null : { config: this.config, label: undoLabel }
		this.#emit(draft)
	}

	#changeRoute(id: string, mutate: (route: Route) => void): void {
		this.#change((draft) => {
			const route = draft.routes.find((r) => r.id === id)
			if (route) mutate(route)
		})
	}

	#setOption<K extends keyof HandlerOptions>(handler: Handler, key: K, to: HandlerOptions[K] | undefined): void {
		const options: HandlerOptions = Object.fromEntries(Object.entries(handler.options ?? {}).filter(([name]) => name !== key))
		if (to !== undefined) options[key] = to
		if (Object.keys(options).length > 0) handler.options = options
		else delete handler.options
	}

	#addRoute(): void {
		const taken = new Set(this.config.routes.map((route) => route.id))
		let n = this.config.routes.length + 1
		while (taken.has(`route-${n}`)) n++
		const id = `route-${n}`
		this.#change((draft) => {
			draft.routes.push({
				id,
				name: `Route ${n}`,
				conditions: [{ type: 'same-origin' }],
				strategy: 'network-first',
				cacheName: `cache-${n}`,
			})
		})
		this._expanded = id
	}

	#deleteRoute(route: Route): void {
		this.#change((draft) => {
			draft.routes = draft.routes.filter((r) => r.id !== route.id)
		}, `Deleted “${route.name}”.`)
		this._expanded = null
	}

	#setPrecacheUrls(text: string): void {
		// Keep what is already known about a URL that is still listed.
		const known = new Map(this.config.precache.entries.map((entry) => [entry.url, entry]))
		const urls = [...new Set(text.split('\n').map((line) => line.trim()).filter((line) => line !== ''))]
		this.#change((draft) => {
			draft.precache.entries = urls.map((url) => known.get(url) ?? { url })
		})
	}

	/** Moves a route to a slot between routes: 0 is before the first, routes.length after the last. */
	#move(from: number, slot: number): void {
		const to = slot > from ? slot - 1 : slot
		const route = this.config.routes[from]
		if (!route || to === from || to < 0 || to >= this.config.routes.length) return
		this.#change((draft) => {
			const [moved] = draft.routes.splice(from, 1)
			if (moved) draft.routes.splice(to, 0, moved)
		})
		this._announcement = `${route.name} moved to position ${to + 1} of ${this.config.routes.length}.`
	}

	/** Moves a route one place with its buttons, keeping focus on the button used. */
	#step(index: number, direction: 'up' | 'down'): void {
		const route = this.config.routes[index]
		if (!route) return
		this.#refocus = `li[data-route="${CSS.escape(route.id)}"] [data-move="${direction}"]`
		this.#move(index, direction === 'up' ? index - 1 : index + 2)
	}

	// Reordering moves the card in the document, and a moved element loses
	// focus. Put it back, or a keyboard user is thrown out of the list.
	protected override updated(): void {
		if (this.#refocus === null) return
		this.querySelector<HTMLElement>(this.#refocus)?.focus()
		this.#refocus = null
	}

	// --- Dragging -----------------------------------------------------------

	#onDragStart(event: DragEvent, route: Route): void {
		this.#dragging = route.id
		const card = (event.target as HTMLElement).closest('li')
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move'
			event.dataTransfer.setData('text/plain', route.name)
			if (card) event.dataTransfer.setDragImage(card, 16, 16)
		}
	}

	#onDragOver(event: DragEvent, index: number): void {
		if (this.#dragging === null) return
		event.preventDefault()
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
		this._dropAt = event.clientY > box.top + box.height / 2 ? index + 1 : index
	}

	#onDrop(event: DragEvent): void {
		if (this.#dragging === null) return
		event.preventDefault()
		const from = this.config.routes.findIndex((route) => route.id === this.#dragging)
		if (from !== -1 && this._dropAt !== null) this.#move(from, this._dropAt)
		this.#onDragEnd()
	}

	#onDragEnd(): void {
		this.#dragging = null
		this._dropAt = null
	}

	// --- Form pieces --------------------------------------------------------

	#handlerFields(handler: Handler, change: (mutate: (handler: Handler) => void) => void): TemplateResult {
		const options = handler.options ?? {}
		const unit = ageUnit(options.maxAgeSeconds)
		const caches = handler.strategy !== 'network-only'
		const setAge = (event: Event) => {
			const row = (event.target as HTMLElement).closest('.swt-age')
			const amount = row?.querySelector('input')?.valueAsNumber ?? NaN
			const seconds = AGE_UNITS.find((u) => u.name === row?.querySelector('select')?.value)?.seconds ?? 1
			change((h) => this.#setOption(h, 'maxAgeSeconds', Number.isFinite(amount) && amount >= 0 ? Math.round(amount * seconds) : undefined))
		}
		return html`
			<label class="swt-label">Strategy
				<select class="swt-field" @change=${(event: Event) => change((h) => { h.strategy = value(event) as Strategy })}>
					${STRATEGIES.map((strategy) => html`<option value=${strategy} ?selected=${handler.strategy === strategy}>${STRATEGY_NAMES[strategy]}</option>`)}
				</select>
			</label>
			${caches
				? html`<label class="swt-label">Cache name
					<input class="swt-field font-mono" type="text" spellcheck="false" .value=${handler.cacheName} @input=${(event: Event) => change((h) => { h.cacheName = value(event) })}>
				</label>`
				: nothing}

			<fieldset class="grid gap-2 sm:grid-cols-2">
				<legend class="swt-legend">Options</legend>
				<label class="swt-label">Fetch mode
					<select class="swt-field" @change=${(event: Event) => change((h) => this.#setOption(h, 'fetchMode', (value(event) || undefined) as HandlerOptions['fetchMode']))}>
						<option value="" ?selected=${options.fetchMode === undefined}>As requested</option>
						${(['cors', 'no-cors', 'same-origin'] as const).map((mode) => html`<option value=${mode} ?selected=${options.fetchMode === mode}>Force ${mode}</option>`)}
					</select>
				</label>
				<label class="swt-label">Credentials
					<select class="swt-field" @change=${(event: Event) => change((h) => this.#setOption(h, 'fetchCredentials', (value(event) || undefined) as HandlerOptions['fetchCredentials']))}>
						<option value="" ?selected=${options.fetchCredentials === undefined}>As requested</option>
						${(['omit', 'same-origin', 'include'] as const).map((c) => html`<option value=${c} ?selected=${options.fetchCredentials === c}>Force ${c}</option>`)}
					</select>
				</label>
				${caches
					? html`
						<label class="swt-label">Cacheable statuses
							<input
								class="swt-field"
								type="text"
								inputmode="numeric"
								placeholder="Strategy default"
								.value=${options.cacheableStatuses?.join(', ') ?? ''}
								@change=${(event: Event) => {
									const statuses = value(event).split(/[\s,]+/).filter((part) => /^\d+$/.test(part)).map(Number)
									change((h) => this.#setOption(h, 'cacheableStatuses', statuses.length > 0 ? statuses : undefined))
								}}
							>
						</label>
						<label class="swt-label">Most entries
							<input
								class="swt-field"
								type="number"
								min="0"
								placeholder="No limit"
								.value=${options.maxEntries?.toString() ?? ''}
								@input=${(event: Event) => change((h) => this.#setOption(h, 'maxEntries', wholeNumber(event)))}
							>
						</label>
						<div class="swt-label sm:col-span-2">
							<span id="swt-age-label">Keep entries for</span>
							<div class="swt-age flex gap-2">
								<input
									class="swt-field w-24"
									type="number"
									min="0"
									placeholder="Forever"
									aria-labelledby="swt-age-label"
									.value=${options.maxAgeSeconds === undefined ? '' : String(options.maxAgeSeconds / unit.seconds)}
									@input=${setAge}
								>
								<select class="swt-field" aria-label="Unit" @change=${setAge}>
									${AGE_UNITS.map((u) => html`<option value=${u.name} ?selected=${u === unit}>${u.name}</option>`)}
								</select>
							</div>
						</div>`
					: nothing}
			</fieldset>`
	}

	#conditionValue(route: Route, condition: Condition, index: number): TemplateResult | typeof nothing {
		const set = (mutate: (c: Condition) => void) => this.#changeRoute(route.id, (r) => {
			const target = r.conditions[index]
			if (target) mutate(target)
		})
		if (condition.type === 'same-origin') return nothing
		if (condition.type === 'destination' || condition.type === 'mode') {
			const known: string[] = condition.type === 'destination' ? DESTINATIONS : MODES
			const all = [...known, ...condition.value.filter((v) => !known.includes(v))]
			const chosen = new Set<string>(condition.value)
			return html`
				<div class="flex flex-wrap gap-x-3 gap-y-1" role="group" aria-label=${CONDITION_NAMES[condition.type]}>
					${all.map((option) => html`
						<label class="flex items-center gap-1">
							<input
								type="checkbox"
								.checked=${chosen.has(option)}
								@change=${(event: Event) => set((c) => {
									if (c.type !== 'destination' && c.type !== 'mode') return
									const next = new Set<string>(c.value)
									if ((event.target as HTMLInputElement).checked) next.add(option)
									else next.delete(option)
									c.value = [...next] as Destination[] & Mode[]
								})}
							>${option === 'empty' ? 'empty (fetch)' : option}
						</label>`)}
				</div>`
		}
		return html`
			<input
				class="swt-field w-full font-mono"
				type="text"
				spellcheck="false"
				aria-label=${CONDITION_NAMES[condition.type]}
				placeholder=${condition.type === 'origin' ? 'https://cdn.example.com' : condition.type === 'path-pattern' ? '\\.(js|css)$' : condition.type === 'query-param' ? 'name' : '/path/'}
				.value=${condition.value}
				@input=${(event: Event) => set((c) => {
					if (c.type !== 'same-origin' && c.type !== 'destination' && c.type !== 'mode') c.value = value(event)
				})}
			>`
	}

	#newCondition(type: Condition['type'], negate: boolean): Condition {
		const not = negate ? { negate: true } : {}
		switch (type) {
			case 'same-origin': return { type, ...not }
			case 'origin': return { type, value: this.harOrigin ?? this.config.origin, ...not }
			case 'path-prefix': return { type, value: '/', ...not }
			case 'path-pattern': return { type, value: '', ...not }
			case 'query-param': return { type, value: '', ...not }
			case 'destination': return { type, value: ['image'], ...not }
			case 'mode': return { type, value: ['navigate'], ...not }
		}
	}

	#conditions(route: Route): TemplateResult {
		return html`
			<fieldset class="grid gap-2">
				<legend class="swt-legend">Matches a request when all of these hold</legend>
				${route.conditions.length === 0
					? html`<p class="text-muted">No conditions: this route matches every ${route.method ?? 'GET'} request, and no route after it can run.</p>`
					: nothing}
				${route.conditions.map((condition, i) => html`
					<div class="grid gap-1 p-2 border border-line rounded bg-bg">
						<div class="flex items-center gap-2">
							<label class="flex items-center gap-1 flex-none">
								<input
									type="checkbox"
									.checked=${condition.negate === true}
									@change=${(event: Event) => this.#changeRoute(route.id, (r) => {
										const target = r.conditions[i]
										if (!target) return
										if ((event.target as HTMLInputElement).checked) target.negate = true
										else delete target.negate
									})}
								>Not
							</label>
							<select
								class="swt-field min-w-0 flex-1"
								aria-label="Condition"
								@change=${(event: Event) => this.#changeRoute(route.id, (r) => {
									r.conditions[i] = this.#newCondition(value(event) as Condition['type'], condition.negate === true)
								})}
							>
								${(Object.keys(CONDITION_NAMES) as Condition['type'][]).map((type) => html`<option value=${type} ?selected=${condition.type === type}>${CONDITION_NAMES[type]}</option>`)}
							</select>
							<button
								type="button"
								class="swt-btn swt-btn-icon"
								aria-label="Remove this condition"
								title="Remove this condition"
								@click=${() => this.#changeRoute(route.id, (r) => { r.conditions.splice(i, 1) })}
							>${icon('close')}</button>
						</div>
						${this.#conditionValue(route, condition, i)}
					</div>`)}
				<div>
					<button type="button" class="swt-btn" @click=${() => this.#changeRoute(route.id, (r) => { r.conditions.push(this.#newCondition('path-prefix', false)) })}>Add a condition</button>
				</div>
			</fieldset>`
	}

	// --- Cards --------------------------------------------------------------

	#summary(handler: Handler): TemplateResult {
		const options = describeOptions(handler)
		return html`
			<p class="mt-1 flex flex-wrap items-baseline gap-x-2">
				${strategyLabel(handler.strategy)}
				${handler.strategy === 'network-only' ? nothing : html`<span class="font-mono text-muted">${handler.cacheName}</span>`}
			</p>
			${options.length > 0 ? html`<p class="mt-1 text-muted">${options.join('; ')}</p>` : nothing}`
	}

	#matched(n: number | undefined, dead = false): TemplateResult | typeof nothing {
		if (n === undefined) return nothing
		return html`<span class="flex-none ${dead ? 'text-warn font-semibold' : 'text-muted'}">${dead ? html`${warningIcon()} ` : nothing}${count(n, 'request')}</span>`
	}

	/** The button that opens and closes a card. The whole heading is the target. */
	#toggle(key: string, title: TemplateResult | string): TemplateResult {
		const open = this._expanded === key
		return html`
			<h3 class="min-w-0 flex-1 font-semibold">
				<button
					type="button"
					class="flex items-center gap-1.5 w-full text-left cursor-pointer"
					aria-expanded=${open ? 'true' : 'false'}
					@click=${() => { this._expanded = open ? null : key }}
				>${icon(open ? 'down' : 'right')}<span class="truncate">${title}</span></button>
			</h3>`
	}

	#routeCard(route: Route, index: number): TemplateResult {
		const total = this.config.routes.length
		const summary = this.result?.routes[index]
		const dead = summary !== undefined && summary.count === 0 && summary.shadowedCount > 0
		const open = this._expanded === route.id
		const drop = this._dropAt === index ? 'swt-drop-before' : this._dropAt === total && index === total - 1 ? 'swt-drop-after' : ''
		return html`
			<li
				class="p-3 border border-line rounded bg-surface ${drop}"
				data-route=${route.id}
				@dragover=${(event: DragEvent) => this.#onDragOver(event, index)}
				@drop=${this.#onDrop}
			>
				<div class="flex items-center gap-1.5">
					<span
						class="swt-grip"
						draggable="true"
						title="Drag to reorder"
						aria-hidden="true"
						@dragstart=${(event: DragEvent) => this.#onDragStart(event, route)}
						@dragend=${this.#onDragEnd}
					>${icon('grip')}</span>
					${this.#toggle(route.id, html`<span class="text-muted font-normal">${index + 1}.</span> ${route.name}`)}
					${this.#matched(summary?.count, dead)}
					<button type="button" class="swt-btn swt-btn-icon" aria-label="Move ${route.name} up" title="Move up" data-move="up" aria-disabled=${index === 0 ? 'true' : 'false'} @click=${() => this.#step(index, 'up')}>${icon('up')}</button>
					<button type="button" class="swt-btn swt-btn-icon" aria-label="Move ${route.name} down" title="Move down" data-move="down" aria-disabled=${index === total - 1 ? 'true' : 'false'} @click=${() => this.#step(index, 'down')}>${icon('down')}</button>
				</div>
				${open
					? html`
						<div class="mt-3 grid gap-3">
							<label class="swt-label">Name
								<input class="swt-field" type="text" .value=${route.name} @input=${(event: Event) => this.#changeRoute(route.id, (r) => { r.name = value(event) })}>
							</label>
							${this.#conditions(route)}
							${this.#handlerFields(route, (mutate) => this.#changeRoute(route.id, mutate))}
							<label class="swt-label">Method
								<select class="swt-field" @change=${(event: Event) => this.#changeRoute(route.id, (r) => {
									if (value(event) === 'GET') delete r.method
									else r.method = value(event)
								})}>
									${METHODS.map((method) => html`<option value=${method} ?selected=${(route.method ?? 'GET') === method}>${method}</option>`)}
								</select>
							</label>
							<div>
								<button type="button" class="swt-btn" @click=${() => this.#deleteRoute(route)}>Delete this route</button>
							</div>
						</div>`
					: html`
						${this.#summary(route)}
						${route.conditions.length === 0
							? html`<p class="mt-1">Matches every ${route.method ?? 'GET'} request.</p>`
							: html`<ul class="mt-1">${route.conditions.map((condition) => html`<li>${describeCondition(condition)}</li>`)}</ul>`}`}
			</li>`
	}

	#precacheCard(): TemplateResult {
		const { config, result } = this
		const entries = config.precache.entries
		const open = this._expanded === 'precache'
		return html`
			<li class="p-3 border border-line rounded bg-surface">
				<div class="flex items-center gap-1.5">
					${this.#toggle('precache', 'Precache')}
					${entries.length > 0 ? this.#matched(result?.precache.count) : nothing}
				</div>
				${open
					? html`
						<div class="mt-3 grid gap-3">
							<label class="swt-label">Precached URLs, one per line
								<textarea
									class="swt-field font-mono min-h-32 whitespace-pre"
									spellcheck="false"
									placeholder="offline.html&#10;static/logo.svg"
									.value=${entries.map((entry) => entry.url).join('\n')}
									@change=${(event: Event) => this.#setPrecacheUrls(value(event))}
								></textarea>
							</label>
							<label class="swt-label">Warn when the precache is larger than (KB)
								<input
									class="swt-field w-32"
									type="number"
									min="0"
									placeholder="500"
									.value=${config.precache.budgetBytes === undefined ? '' : String(config.precache.budgetBytes / 1000)}
									@input=${(event: Event) => this.#change((draft) => {
										const kb = wholeNumber(event)
										if (kb === undefined) delete draft.precache.budgetBytes
										else draft.precache.budgetBytes = kb * 1000
									})}
								>
							</label>
							<p class="text-muted">Sizes are taken from the HAR for files the page requested. Query parameters starting <span class="font-mono">utm_</span> and <span class="font-mono">fbclid</span> are ignored when matching, as Workbox does by default.</p>
						</div>`
					: html`<p class="mt-1 text-muted">
						${entries.length === 0
							? 'Nothing is precached.'
							: html`${count(entries.length, 'file')}${result ? `, ${formatBytes(result.precache.knownBytes)}` : ''}${result && result.precache.unknownSizeCount > 0 ? ` plus ${result.precache.unknownSizeCount} of unknown size` : ''}. Answered before any route.`}
					</p>`}
			</li>`
	}

	#defaultCard(): TemplateResult {
		const handler = this.config.defaultHandler
		const open = this._expanded === 'default'
		return html`
			<li class="p-3 border border-line rounded bg-surface">
				<div class="flex items-center gap-1.5">
					${this.#toggle('default', 'Default handler')}
					${handler ? this.#matched(this.result?.defaultHandler.count) : nothing}
				</div>
				${open
					? html`
						<div class="mt-3 grid gap-3">
							<label class="flex items-center gap-1.5">
								<input
									type="checkbox"
									.checked=${handler !== null}
									@change=${(event: Event) => this.#change((draft) => {
										draft.defaultHandler = (event.target as HTMLInputElement).checked ? { strategy: 'network-only', cacheName: '' } : null
									})}
								>Handle requests no route matched
							</label>
							${handler
								? this.#handlerFields(handler, (mutate) => this.#change((draft) => {
										if (draft.defaultHandler) mutate(draft.defaultHandler)
									}))
								: nothing}
						</div>`
					: handler
						? html`${this.#summary(handler)}<p class="mt-1 text-muted">Takes whatever no route matched.</p>`
						: html`<p class="mt-1 text-muted">None: requests no route matched go to the network untouched.</p>`}
			</li>`
	}

	protected override render(): TemplateResult {
		const { config, result } = this
		const mismatch = this.harOrigin !== null && this.harOrigin !== config.origin
		return html`
			<h2 class="text-lg font-semibold">Configuration</h2>
			<label class="swt-label mt-2">Site origin
				<input
					class="swt-field font-mono"
					type="url"
					spellcheck="false"
					placeholder="https://example.com"
					.value=${config.origin}
					@input=${(event: Event) => this.#change((draft) => { draft.origin = value(event).trim() })}
				>
			</label>
			${mismatch
				? html`<p class="mt-2 p-2 border border-line rounded bg-warn-bg">
					This HAR was recorded on <span class="font-mono">${this.harOrigin}</span>, so the configuration treats all of its requests as another site's.
					<button type="button" class="swt-btn mt-1" @click=${() => this.#change((draft) => { draft.origin = this.harOrigin ?? draft.origin })}>Use ${this.harOrigin}</button>
				</p>`
				: nothing}

			${result && result.configProblems.length > 0
				? html`<ul class="mt-3 p-3 border border-line rounded bg-warn-bg text-warn" role="alert">
					${result.configProblems.map((problem) => html`<li>${problem.message}</li>`)}
				</ul>`
				: nothing}

			${this._undo
				? html`<p class="mt-3 flex items-center justify-between gap-2 p-2 border border-line rounded bg-sunken" role="status">
					<span>${this._undo.label}</span>
					<button
						type="button"
						class="swt-btn"
						@click=${() => {
							if (this._undo) this.#emit(this._undo.config)
							this._undo = null
						}}
					>Undo</button>
				</p>`
				: nothing}

			<ul class="mt-3 grid gap-2">${this.#precacheCard()}</ul>

			<h3 class="mt-4 font-semibold">Routes, tried in this order</h3>
			${config.routes.length === 0
				? html`<p class="mt-1 max-w-[60ch] text-muted">No routes yet, so every request goes to ${config.defaultHandler ? 'the default handler' : 'the network'}.</p>`
				: nothing}
			<ol class="mt-2 grid gap-2">
				${repeat(config.routes, (route) => route.id, (route, i) => this.#routeCard(route, i))}
			</ol>
			<p class="mt-2"><button type="button" class="swt-btn" @click=${() => this.#addRoute()}>Add a route</button></p>

			<ul class="mt-4 grid gap-2">${this.#defaultCard()}</ul>

			<p class="sr-only" aria-live="polite">${this._announcement}</p>`
	}
}

customElements.define('swt-config', SwtConfig)
