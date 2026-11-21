import { html, nothing, type PropertyValues, type TemplateResult } from 'lit'
import { formatBytes, usesCache } from '../engine/index.ts'
import type { Config, Handler, ParsedHar, RequestResult, SimRequest, SimulationResult } from '../engine/index.ts'
import { LightElement } from './base.ts'
import { WARNING_NAMES, chevron, count, strategyLabel, warningIcon } from './format.ts'

type Sort = 'order' | 'size' | 'url'

type Row =
	| { kind: 'group', key: string, title: string, handler: Handler | null, detail: string, count: number, bytes: number, warned: number, open: boolean, empty: boolean, dead: boolean }
	| { kind: 'note', text: string, warn: boolean }
	| { kind: 'request', i: number }

/** Row heights, in units of one table row. */
const UNITS = { group: 1, request: 1, note: 2 } as const
const OVERSCAN = 8
/** Small enough that showing every row at once is an overview, not a wall. */
const OPEN_BY_DEFAULT_UP_TO = 100

function groupKey(result: RequestResult): string {
	const by = result.handledBy
	return by.kind === 'route' ? `route:${by.routeId}` : by.kind
}

/**
 * The request table. Grouped by handler, or flat in load order.
 *
 * Only the rows in view are in the DOM. Every row is a fixed height (a note
 * is two), so the groups, their notes and their requests flatten into one
 * list whose offsets are a running sum: collapsed groups cost nothing and an
 * open group of any size costs a screenful.
 */
export class SwtResults extends LightElement {
	static override properties = {
		har: { attribute: false },
		config: { attribute: false },
		result: { attribute: false },
		focusWarning: { attribute: false },
		_grouped: { state: true },
		_filter: { state: true },
		_sort: { state: true },
		_open: { state: true },
		_viewport: { state: true },
		_rowHeight: { state: true },
	}

	declare har: ParsedHar
	declare config: Config
	declare result: SimulationResult
	/** Index of a warning whose requests are the only ones shown, or null. */
	declare focusWarning: number | null
	declare _grouped: boolean
	declare _filter: string
	declare _sort: Sort
	declare _open: Set<string>
	declare _viewport: number
	declare _rowHeight: number

	#rows: Row[] = []
	/** Top of each row, in row units; one extra entry holds the total. */
	#offsets = new Float64Array(1)
	#shown = 0
	/** Index of the first row drawn. */
	#first = 0
	#scrollTop = 0
	#frame = 0
	#resize = new ResizeObserver(() => this.#measure())

	constructor() {
		super()
		this.focusWarning = null
		this._grouped = true
		this._filter = ''
		this._sort = 'order'
		this._open = new Set()
		this._viewport = 600
		this._rowHeight = 28
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback()
		this.#resize.disconnect()
		cancelAnimationFrame(this.#frame)
	}

	protected override firstUpdated(): void {
		const scroller = this.querySelector('.swt-scroller')
		if (scroller) this.#resize.observe(scroller)
		this.#measure()
	}

	// Sizes and positions are set through the style object, not a style
	// attribute: the page's Content-Security-Policy forbids inline styles.
	protected override updated(): void {
		const px = (units: number) => `${units * this._rowHeight}px`
		const spacer = this.querySelector<HTMLElement>('.swt-spacer')
		const view = this.querySelector<HTMLElement>('.swt-window')
		if (spacer) spacer.style.height = px(this.#offsets[this.#rows.length] ?? 0)
		if (view) view.style.transform = `translateY(${px(this.#offsets[this.#first] ?? 0)})`
	}

	#measure(): void {
		const scroller = this.querySelector<HTMLElement>('.swt-scroller')
		const header = this.querySelector<HTMLElement>('.swt-head')
		if (scroller) this._viewport = scroller.clientHeight
		if (header && header.offsetHeight > 0) this._rowHeight = header.offsetHeight
	}

	protected override willUpdate(changed: PropertyValues<this>): void {
		// A scroll or resize changes which rows are drawn, not what the rows are.
		if (changed.size === 0 || [...changed.keys()].every((key) => key === '_viewport' || key === '_rowHeight')) return

		if (changed.has('har')) {
			this._open = new Set(this.har.requests.length <= OPEN_BY_DEFAULT_UP_TO ? this.#groupKeys() : [])
			this.#scrollTo(0)
		}
		// Jumping to a warning's requests should show them, not their closed groups.
		if (changed.has('focusWarning') && this.focusWarning !== null) {
			const indexes = this.result.warnings[this.focusWarning]?.requestIndexes ?? []
			const keys = indexes.map((i) => this.result.requests[i]).filter((r) => r !== undefined).map(groupKey)
			this._open = new Set([...this._open, ...keys])
			this.#scrollTo(0)
		}
		this.#build()
	}

	#groupKeys(): string[] {
		return ['precache', ...this.config.routes.map((route) => `route:${route.id}`), 'default', 'network']
	}

	#scrollTo(top: number): void {
		this.#scrollTop = top
		const scroller = this.querySelector('.swt-scroller')
		if (scroller) scroller.scrollTop = top
	}

	#build(): void {
		const { har, config, result } = this
		const requests = har.requests
		const focused = this.focusWarning === null ? undefined : result.warnings[this.focusWarning]
		const text = this._filter.trim().toLowerCase()
		const filtering = focused !== undefined || text !== ''

		let indexes = focused ? [...focused.requestIndexes] : requests.map((_, i) => i)
		if (text !== '') indexes = indexes.filter((i) => requests[i]?.url.toLowerCase().includes(text))
		if (this._sort === 'size') {
			indexes.sort((a, b) => (requests[b]?.transferSize ?? 0) - (requests[a]?.transferSize ?? 0) || a - b)
		} else if (this._sort === 'url') {
			indexes.sort((a, b) => (requests[a]?.url ?? '').localeCompare(requests[b]?.url ?? '') || a - b)
		}
		this.#shown = indexes.length

		const rows: Row[] = []
		if (!this._grouped) {
			for (const i of indexes) rows.push({ kind: 'request', i })
		} else {
			const buckets = new Map<string, number[]>()
			for (const i of indexes) {
				const r = result.requests[i]
				if (!r) continue
				const key = groupKey(r)
				const bucket = buckets.get(key)
				if (bucket) bucket.push(i)
				else buckets.set(key, [i])
			}

			const group = (key: string, title: string, handler: Handler | null, detail: string, emptyNote: string, warn = false) => {
				const list = buckets.get(key) ?? []
				// A filter hides the groups it empties; without one, an empty group is a finding.
				if (list.length === 0 && filtering) return
				let bytes = 0
				let warned = 0
				for (const i of list) {
					bytes += requests[i]?.transferSize ?? 0
					if ((result.requests[i]?.warnings.length ?? 0) > 0) warned++
				}
				const open = this._open.has(key)
				rows.push({ kind: 'group', key, title, handler, detail, count: list.length, bytes, warned, open, empty: list.length === 0, dead: warn })
				if (list.length === 0) rows.push({ kind: 'note', text: emptyNote, warn })
				else if (open) for (const i of list) rows.push({ kind: 'request', i })
			}

			if (config.precache.entries.length > 0) {
				group('precache', 'Precache', null, 'answered before any route', 'No request in this HAR was answered from the precache.')
			}
			config.routes.forEach((route, n) => {
				const dead = result.warnings.find((warning) => warning.code === 'dead-route' && warning.routeId === route.id)
				group(`route:${route.id}`, `${n + 1}. ${route.name}`, route, '', dead?.message ?? 'No request in this HAR matches this route.', dead !== undefined)
			})
			if (config.defaultHandler) {
				group('default', 'Default handler', config.defaultHandler, '', 'Every routable request was matched by a route.')
			}
			if (buckets.has('network') || rows.length === 0) {
				group('network', 'Not handled by the worker', null, 'goes straight to the network', 'No requests to show.')
			}
		}

		const offsets = new Float64Array(rows.length + 1)
		rows.forEach((row, i) => {
			offsets[i + 1] = (offsets[i] ?? 0) + UNITS[row.kind]
		})
		this.#rows = rows
		this.#offsets = offsets
	}

	/** The rows in view, plus a few either side so a fast scroll does not show a gap. */
	#window(): { first: number, last: number } {
		const offsets = this.#offsets
		// The sticky header covers the top row's worth of the viewport.
		const top = this.#scrollTop / this._rowHeight
		const bottom = top + this._viewport / this._rowHeight
		let low = 0
		let high = this.#rows.length
		while (low < high) {
			const middle = (low + high) >> 1
			if ((offsets[middle + 1] ?? 0) <= top) low = middle + 1
			else high = middle
		}
		let last = low
		while (last < this.#rows.length && (offsets[last] ?? 0) < bottom) last++
		return { first: Math.max(0, low - OVERSCAN), last: Math.min(this.#rows.length, last + OVERSCAN) }
	}

	#onScroll(event: Event): void {
		this.#scrollTop = (event.currentTarget as HTMLElement).scrollTop
		if (this.#frame) return
		this.#frame = requestAnimationFrame(() => {
			this.#frame = 0
			this.requestUpdate()
		})
	}

	#toggle(key: string): void {
		const open = new Set(this._open)
		if (!open.delete(key)) open.add(key)
		this._open = open
	}

	#handledBy(result: RequestResult): string {
		const by = result.handledBy
		switch (by.kind) {
			case 'precache': return 'Precache'
			case 'default': return 'Default handler'
			case 'route': return this.config.routes.find((route) => route.id === by.routeId)?.name ?? by.routeId
			case 'network': return 'Not handled'
		}
	}

	#storedIn(result: RequestResult): TemplateResult | string {
		if (result.handledBy.kind === 'precache') return html`<span class="font-mono">precache</span>`
		if (result.cached) {
			return html`<span class="font-mono" title=${result.opaque ? 'Stored as an opaque response' : ''}>${result.cacheName}${result.opaque ? ' (opaque)' : ''}</span>`
		}
		if (result.strategy && usesCache(result.strategy)) {
			return html`<span class="text-muted" title="This response would not be written to the cache">not stored</span>`
		}
		return ''
	}

	#url(request: SimRequest): TemplateResult {
		const url = new URL(request.url)
		const ownOrigin = url.origin === this.config.origin
		return html`<span class="font-mono" title=${request.url}>${ownOrigin ? nothing : html`<span class="text-muted">${url.host}</span>`}${url.pathname}${url.search}</span>`
	}

	#guess(value: string, source: string): TemplateResult | string {
		if (source === 'header') return value
		const how = source === 'unknown'
			? 'Not recorded in this HAR'
			: source === 'worker-fetch'
				? 'Read from the recorded service worker\'s own fetch of this request'
				: `Not in the HAR's request headers; inferred from the ${source.replace('-', ' ')}`
		return html`<span class="italic" title=${how}>${value}*</span>`
	}

	#row(row: Row, index: number): TemplateResult {
		const position = index + 2 // aria-rowindex is 1-based and the header is row 1
		if (row.kind === 'group') {
			return html`
				<div class="swt-row-wide h-(--swt-row) bg-bg" role="row" aria-rowindex=${position}>
					<div class="w-full h-full" role="cell">
						<button
							type="button"
							class="flex items-center gap-2 w-full h-full px-2 text-left ${row.empty ? 'cursor-default' : 'cursor-pointer'}"
							aria-expanded=${row.empty ? nothing : row.open ? 'true' : 'false'}
							aria-disabled=${row.empty ? 'true' : nothing}
							@click=${row.empty ? nothing : () => this.#toggle(row.key)}
						>
							${row.empty ? html`<span class="swt-icon"></span>` : chevron(row.open)}
							<span class="font-semibold truncate">${row.title}</span>
							${row.handler ? strategyLabel(row.handler.strategy) : nothing}
							${row.handler && usesCache(row.handler.strategy) ? html`<span class="font-mono text-muted truncate">${row.handler.cacheName}</span>` : nothing}
							${row.detail ? html`<span class="text-muted truncate">${row.detail}</span>` : nothing}
							<span class="ml-auto flex flex-none items-center gap-3 swt-num">
								${row.warned > 0 ? html`<span class="text-warn">${warningIcon()} ${row.warned} with warnings</span>` : nothing}
								<span class=${row.dead ? 'font-semibold text-warn' : ''}>${row.dead ? html`${warningIcon()} ` : nothing}${count(row.count, 'request')}</span>
								<span class="w-16 text-muted">${formatBytes(row.bytes)}</span>
							</span>
						</button>
					</div>
				</div>`
		}
		if (row.kind === 'note') {
			return html`
				<div class="swt-row-wide h-[calc(var(--swt-row)*2)] bg-surface" role="row" aria-rowindex=${position}>
					<p class="flex items-start gap-2 pl-8 pr-3 line-clamp-2 ${row.warn ? 'text-warn' : 'text-muted'}" role="cell" title=${row.text}>
						${row.warn ? warningIcon() : nothing}<span class="line-clamp-2">${row.text}</span>
					</p>
				</div>`
		}
		const request = this.har.requests[row.i]
		const result = this.result.requests[row.i]
		if (!request || !result) return html``
		const warnings = result.warnings.map((w) => this.result.warnings[w]).filter((w) => w !== undefined)
		return html`
			<div class="swt-row bg-surface" role="row" aria-rowindex=${position}>
				<span class="swt-num text-muted" role="cell">${row.i + 1}</span>
				<span role="cell">${this.#url(request)}</span>
				<span role="cell">${this.#guess(request.destination, request.destinationSource)}</span>
				<span role="cell">${this.#guess(request.mode, request.modeSource)}</span>
				<span class="swt-num" role="cell">${request.method === 'GET' ? '' : `${request.method} `}${request.status || 'failed'}</span>
				<span class="swt-num" role="cell">${formatBytes(request.transferSize)}</span>
				${this._grouped ? nothing : html`<span role="cell">${this.#handledBy(result)}</span>`}
				<span role="cell">${this.#storedIn(result)}</span>
				<span role="cell" title=${warnings.map((w) => WARNING_NAMES[w.code]).join('\n')}>
					${warnings.length > 0 ? html`${warningIcon()} <span class="text-warn">${warnings.length}</span><span class="sr-only"> ${warnings.length === 1 ? 'warning' : 'warnings'}</span>` : nothing}
				</span>
			</div>`
	}

	protected override render(): TemplateResult {
		const { first, last } = this.#window()
		const total = this.har.requests.length
		const focused = this.focusWarning === null ? undefined : this.result.warnings[this.focusWarning]
		const allOpen = this.#groupKeys().every((key) => this._open.has(key))
		this.#first = first

		return html`
			<div class="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line">
				<h2 class="text-lg font-semibold mr-auto">
					${this.#shown === total ? count(total, 'request') : `${this.#shown.toLocaleString('en')} of ${count(total, 'request')}`}
				</h2>
				<label class="flex items-center gap-1.5">
					<span class="text-muted">Filter</span>
					<input
						class="swt-field w-44"
						type="search"
						placeholder="Part of a URL"
						.value=${this._filter}
						@input=${(event: Event) => { this._filter = (event.target as HTMLInputElement).value }}
					>
				</label>
				<label class="flex items-center gap-1.5">
					<span class="text-muted">Sort</span>
					<select class="swt-field" @change=${(event: Event) => { this._sort = (event.target as HTMLSelectElement).value as Sort }}>
						<option value="order" ?selected=${this._sort === 'order'}>Load order</option>
						<option value="size" ?selected=${this._sort === 'size'}>Largest first</option>
						<option value="url" ?selected=${this._sort === 'url'}>URL</option>
					</select>
				</label>
				<div class="flex" role="group" aria-label="Layout">
					<button type="button" class="swt-btn rounded-r-none" aria-pressed=${this._grouped ? 'true' : 'false'} @click=${() => { this._grouped = true }}>By route</button>
					<button type="button" class="swt-btn rounded-l-none -ml-px" aria-pressed=${this._grouped ? 'false' : 'true'} @click=${() => { this._grouped = false }}>Load order</button>
				</div>
				${this._grouped
					? html`<button type="button" class="swt-btn" @click=${() => { this._open = new Set(allOpen ? [] : this.#groupKeys()) }}>${allOpen ? 'Collapse all' : 'Expand all'}</button>`
					: nothing}
			</div>

			${focused
				? html`<p class="flex items-center gap-2 px-3 py-1.5 border-b border-line bg-warn-bg">
					${warningIcon()}
					<span>Showing only the requests behind “${WARNING_NAMES[focused.code]}”.</span>
					<button type="button" class="swt-btn" @click=${() => this.dispatchEvent(new CustomEvent('select-warning', { detail: null, bubbles: true }))}>Show all requests</button>
				</p>`
				: nothing}

			<div
				class="swt-scroller flex-1 min-h-0 overflow-auto bg-surface"
				role="table"
				aria-label="Requests"
				aria-rowcount=${this.#rows.length + 1}
				tabindex="0"
				@scroll=${this.#onScroll}
			>
				<div class="swt-table" ?data-flat=${!this._grouped} role="presentation">
					<div class="swt-row swt-head sticky top-0 z-10 bg-sunken font-semibold" role="row" aria-rowindex="1">
						<span class="swt-num" role="columnheader">#</span>
						<span role="columnheader">URL</span>
						<span role="columnheader">Destination</span>
						<span role="columnheader">Mode</span>
						<span class="swt-num" role="columnheader">Status</span>
						<span class="swt-num" role="columnheader">Size</span>
						${this._grouped ? nothing : html`<span role="columnheader">Handled by</span>`}
						<span role="columnheader">Stored in</span>
						<span role="columnheader"><span class="sr-only">Warnings</span>${warningIcon()}</span>
					</div>
					<div class="swt-spacer relative overflow-hidden" role="presentation">
						<div class="swt-window absolute inset-x-0 top-0" role="presentation">
							${this.#rows.slice(first, last).map((row, i) => this.#row(row, first + i))}
						</div>
					</div>
				</div>
			</div>`
	}
}

customElements.define('swt-results', SwtResults)
