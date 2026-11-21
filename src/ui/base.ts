import { LitElement } from 'lit'

/**
 * A Lit element that renders into itself rather than a shadow root, so the
 * page's one stylesheet applies. There are no slots without shadow DOM:
 * compose with properties and templates.
 */
export class LightElement extends LitElement {
	protected override createRenderRoot(): HTMLElement {
		return this
	}
}
