# Service Worker Toolkit: project plan

Written 21 November 2026, at the end of a session fixing the service worker on SuperGeekery.com. This document is the brief for building the tool in a fresh session. It assumes no knowledge of that session.

## What this is

A static web app that lets you configure a service worker's caching rules and see what they would do to a real site's requests **before** deploying anything.

You load a HAR file exported from browser DevTools. You define routes (match rule, strategy, cache). The app shows, for every request in the HAR, which route would handle it and what would happen, and it warns about known mistakes. When the result looks right, it gives you the service worker code.

The core idea: which route handles a request depends only on the request's URL, type and mode. That can be computed in an ordinary page. No real service worker has to be installed to answer "what would this config do?".

## Decisions already made

- **The name is "Service Worker Toolkit".** Checked on 21 November 2026: no npm package named `service-worker-toolkit`, and no established project uses the exact name. Two near neighbours to be aware of: Google's deprecated "Service Worker Toolbox" (`sw-toolbox`), and Google's own description of Workbox as "a high-level service worker toolkit". Say what the tool does early in the README so it isn't mistaken for a library.
- **It will live at `sw.morton.dev`, on John's Laravel Forge server.** That does not make it a Laravel app: it stays a static site with no backend. See "Hosting" below.
- **It will be open source.** See "Open source" below for what that requires.
- **John is the primary user.** Build for his sites and workflow first; wider appeal is a bonus.
- **Workbox-style rules only.** The tool simulates an ordered list of routes, each with a named strategy. Hand-written `fetch` handlers are not supported. They would only be added at some future date if a real need appears, and as a separate "run an existing worker against a HAR" mode, not by stretching this design.
- **Workbox export first.** Version 1 generates Workbox code. A dependency-free export, or one for a Workbox fork such as Serwist, is a possible later addition.
- **Library-neutral internals.** Name the engine's concepts generically (routes, strategies, caches) and keep Workbox's API out of the engine. Workbox-specific behaviour lives in two places only: the matching defaults and the exporter. This is what keeps the later export options open.

## Why it's worth building

Every item below is a real bug found on SuperGeekery.com in one afternoon. None produced an error. Each should become a warning in the tool and a test fixture in the repo.

1. **A broad route shadowed the routes after it.** The first route matched every URL that wasn't an admin or action path. Scripts, fonts and CDN images all went network-first into a cache named for HTML and capped at 100 entries. The cache-first CDN route registered after it never ran.
2. **A `no-cors` cache route would have broken canvas images.** The CDN route forced `mode: 'no-cors'`, which yields opaque responses. A web component requested the same images with `crossorigin="anonymous"`. A browser refuses to give an opaque response to a CORS request. This was latent only because of bug 1.
3. **Precached files that were never used.** Fonts were precached as `static/fonts/X.woff2`, but pages requested `static/fonts/X.woff2?v=1.0`. The query string meant the precached copy never matched. Every visitor downloaded 337 KB for nothing.
4. **Precache weight nobody was looking at.** The precache was 603 KB, more than half of it one unused font.
5. **Media on a cache-first route.** Audio and video use Range requests, which don't mix with a plain cache-first strategy. Caught in review, before it shipped.
6. **Unhashed files on a cache-first route.** Favicons shared a folder with content-hashed build files. Cache-first is safe for hashed names and stale forever for unhashed ones.
7. **The CDN cached the worker file itself.** `sw.js` was served with a four-hour edge cache, so a deployed fix didn't reach browsers. This one is visible in a HAR as response headers on the worker script.

## Prior art

Searched on 21 November 2026: a focused pass of five web searches plus GitHub and npm searches, covering routing simulators, config builders, auditors and linters, and HAR analysers. **No tool was found that simulates service worker routing against a set of requests before deployment.** A focused pass can miss things described in other words, so treat this as "nothing well known", not proof.

What exists nearby, and how it relates:

| Tool | What it does | Relation to this project |
|---|---|---|
| [Progressier Service Worker Strategy Builder](https://progressier.com/service-worker-strategy-builder) | Web form that generates a Workbox worker; you pick one strategy each for HTML, assets and images | Closest config builder. Three fixed categories, no custom routes, no ordering, no simulation. Part of a commercial product's site. |
| [Workbox CLI wizard](https://developer.chrome.com/docs/workbox/modules/workbox-cli) | Command-line questions that write a `workbox-config.js` | Builder only. No preview of what the config does. |
| [hardrefresh](https://github.com/hamodywe/hardrefresh) | CLI that finds cache headers pinning visitors to an old build, including a cached `sw.js` | Overlaps one warning (worker script cached upstream). MIT licensed, small. Worth reading for its header rules. |
| [Stakataka](https://github.com/cheeaun/stakataka) | Browser extension that visualises what is in Cache Storage and how big it is | Shows the result after a worker has run. Complementary: this project predicts, that one inspects. Good reference for cache-size visualisation. No licence file, so ideas only, no code. |
| [J.A. Watte's Service Worker Audit](https://jwatte.com/blog/blog-tool-service-worker-scope/) | Fetches a live `sw.js` and checks for handlers, `skipWaiting`, navigation preload and an offline fallback | Audits worker code, not routing against requests. A personal-site tool; not examined beyond its description. |
| Chrome DevTools (Application panel) and Workbox debug logging | Show which route handled each request on a live, installed worker | The existing way to find these bugs: after deploying, one request at a time. This project's reason to exist. |
| [Workbox recipe test templates](https://tessl.io/registry/testland/workbox-tests/1.2.8/files/references/recipe-tests.md) | Playwright tests asserting cache behaviour of a built worker | Tests a real worker in a real browser after the build. Heavier, and needs code rather than a form. |
| [HAR analyzer by Flavio Copes](https://flaviocopes.com/tools/har-analyzer/) | Browser-based HAR summary by domain, status, cache hits and size, parsed locally | Not service-worker aware. A reference for HAR parsing in the page and for the privacy wording. |

Two facts checked along the way:

- **Workbox is still being released.** `workbox-routing` 7.4.1 was published in May 2026.
- **Serwist, the Workbox fork, is active** (version 9.5.15, November 2026). A Serwist export remains a sensible later option.

Conclusion: the gap is real. Builders stop at generating code, and inspectors start after deployment. Nothing found sits in between, which is where this tool goes.

## Scope of version 1

In scope:

- Import one HAR file, entirely in the browser.
- Edit an ordered list of routes and a precache list.
- Show the per-request result table and a per-cache summary.
- Show warnings for the seven cases above.
- Export the configuration as service worker source.
- Save and reload a configuration (local storage, plus JSON export/import).

Out of scope for version 1:

- Installing or running a generated worker against a live site. A browser only lets a worker control pages on its own origin, so this needs a sandbox or a local companion tool. Revisit after version 1 is useful.
- Simulating time: cache expiry, repeat visits, offline replay. Version 1 answers "where does each request go on this page load", not "what is in the cache next week".
- Hand-written `fetch` handlers. See "Decisions already made".
- Accounts, a backend, or any server-side processing.

## How the simulation works

### Inputs

**From the HAR, per entry:** URL, method, response status, response content type, transfer size and body size, request headers, response headers.

Three request properties drive route matching, and a HAR does not record them directly:

| Property | Where to get it | Fallback |
|---|---|---|
| destination (`image`, `script`, `font`, `document`…) | `Sec-Fetch-Dest` request header | Chrome's `_resourceType` field, then content type |
| mode (`navigate`, `cors`, `no-cors`, `same-origin`) | `Sec-Fetch-Mode` request header | infer `navigate` for the first document; otherwise mark unknown |
| same-origin or cross-origin | compare with the page URL in the HAR | n/a |

**Verify early:** confirm that HAR exports from Chrome, Firefox and Safari actually include the `Sec-Fetch-*` request headers. This plan assumes Chrome does. If a browser omits them, the app must show the value as inferred and let the user correct it, because warnings 2 and 5 depend on mode and Range headers being right.

**From the user:** the site's own origin (pre-filled from the HAR), the ordered routes, the precache list, and the default handler.

### The route model

A route has:

- a **matcher**, built from conditions that can be combined: origin equals, path starts with, path matches a pattern, destination is, mode is, and negations of each;
- a **strategy**: cache-first, network-first, stale-while-revalidate, network-only, cache-only;
- a **cache name**;
- **options**: forced fetch mode, forced credentials, cacheable statuses, max entries, max age.

Keep matchers declarative (data, not code). That is what makes them editable in a form, serialisable, and safe to evaluate. An "advanced" free-form function matcher can come later.

### Matching order

Model Workbox's behaviour, and **confirm each point against the current Workbox documentation before coding it**:

1. Only GET requests are routed unless a route says otherwise.
2. Precached URLs are answered by the precache route when it is registered first.
3. Remaining routes are tried in registration order; the first match wins.
4. Anything unmatched goes to the default handler if one is set, otherwise straight to the network.

Precache matching needs its own care: Workbox ignores some query parameters by default and can be configured to ignore more. Bug 3 lives exactly here, so model the default faithfully.

### Outputs

**Request table.** One row per HAR entry: URL, destination, mode, size, the route that matched (or "default" or "precache"), strategy, cache name, and any warnings. Sortable and filterable by route, cache, origin and warning.

**Cache summary.** Per cache: number of entries, total bytes, and whether it exceeds its own max-entries setting from this one page load.

**Route summary.** Per route: how many requests it matched. A route with zero matches is a finding in itself.

**Warnings.** Each links to the rows that triggered it and explains the consequence in a sentence.

| Warning | Rule |
|---|---|
| Dead route | A route matches nothing, and an earlier route matches requests it would have matched |
| Mixed content types in one cache | A route's matches span documents and subresources (the "HTML cache full of fonts" case) |
| Opaque response to a CORS request | A route forces `no-cors` and matches a request whose mode is `cors` |
| Opaque responses cached | A route caches status 0; note the storage padding cost |
| Precache entry never requested | A precache URL appears in no HAR request once query handling is applied, while a near-match with a query string does |
| Precache weight | Total precache size, with the largest entries listed |
| Range request on a caching route | A matched request carries a `Range` header or has destination `audio`/`video` |
| Unhashed file on cache-first | A cache-first match whose filename has no content hash and no version query |
| Worker script cached upstream | The HAR contains the worker script with a cache lifetime above zero |

### Export

Generate a Workbox-based `sw.ts`/`sw.js` equivalent to the configuration, with each route commented. Also export the raw configuration as JSON so it can be reloaded.

A stretch goal is the reverse: import an existing Workbox service worker and recover the configuration. Parsing arbitrary worker code is unreliable, so treat it as a later experiment.

## Privacy and safety

HAR files contain cookies, authorisation headers and sometimes response bodies. This shapes the design:

- Parse the file in the browser. Never upload it. There is no backend.
- Read only the fields listed above. Discard cookies, auth headers and bodies at parse time, so they never reach application state or local storage.
- Say this on the import screen, in one plain sentence.
- No analytics or third-party scripts on the page that handles the file.

## Technical approach

Recommendations, not requirements. The new session should confirm them with John before scaffolding.

- **Static site, TypeScript, Vite.** No server-side code. Hosted as described in "Hosting".
- **Keep the engine separate from the UI, and free of Workbox's API.** A pure module, `simulate(har, config) → result`, with no DOM access. All warnings come from it. This is the part worth testing hard, and it could later run in a CLI or a CI check.
- **UI layer:** decided; see "UI decisions" below. The table is the demanding part: a HAR can hold thousands of entries.
- **Performance is a requirement, not a polish step.** Render the request table with virtual scrolling or pagination from the start. Parse large HAR files (tens of MB) without freezing the page; a Web Worker for parsing and simulation is the likely answer. Measure with a real large HAR before and after.
- **Code style John uses elsewhere:** tabs, no semicolons, single quotes, ESLint with TypeScript rules.

Suggested layout:

```
src/
  engine/      har parsing, matcher evaluation, simulation, warnings (no DOM)
  export/      config → service worker source
  ui/          import screen, route editor, results table, summaries
fixtures/      small hand-written HAR files and configs, one per warning
tests/
```

## Hosting

The app will be served from **`sw.morton.dev`** on John's Forge-managed server (the same one reached with `ssh jfm`).

- **Static site, no Laravel, no PHP, no database.** Forge can host a plain static site. The site's web directory should point at the Vite build output (`dist`).
- **Deploy by pushing to the repository.** The Forge deploy script only needs to install dependencies and build, along the lines of `npm ci && npm run build`. Confirm the Node version on the server meets the project's requirement before the first deploy.
- **Being public raises the stakes on the privacy promise.** People will load HAR files into a page on the open web, so enforce "nothing leaves the browser" with a response header rather than relying on the code: a Content-Security-Policy with `connect-src 'none'` (plus no third-party script or font origins) makes uploads impossible even by mistake. That header is set in the site's NGINX config through Forge.
- **Caching:** hashed build files can be cached for a long time; `index.html` should not be.
- **The app does not need a service worker of its own.** Adding one would be on theme, but it is not part of version 1.
- **Repository housekeeping:** repositories deployed to this server keep Dependabot alerts and security updates switched on.

John still needs to do two things himself: point DNS for `sw.morton.dev` at the server, and create the site in Forge.

## Open source

The repository will be public. That changes a few things from day one, since git history is public too:

- **Fixtures must be safe to publish.** Hand-write the fixture HAR files, or generate them from a script. Never commit a HAR exported from a real browsing session, even a trimmed one: they carry cookies, tokens and internal URLs. Use placeholder domains such as `example.com` and `cdn.example.com`.
- **The SuperGeekery before-and-after test case** should be rebuilt as a fixture from the route configuration and a hand-written request list, not from a real HAR of the site.
- **No secrets or server details in the repository.** Deploy configuration lives in Forge, not in committed files.
- **Licence:** MIT, confirmed by John on 21 November 2026. The `LICENSE` file is in the first commit.
- **README from the start,** stating what the tool does in the first two sentences, that HAR files never leave the browser, and how to run it locally.
- **Dependencies:** check that each one's licence is compatible, and keep the list short.

## UI decisions

John chose all of these on 21 November 2026. Treat them as settled.

| Topic | Decision |
|---|---|
| Framework | **Lit** web components |
| Styling | **Tailwind CSS v4** |
| Lit with Tailwind | **Light DOM components** (no shadow DOM), so the single page-level Tailwind stylesheet applies everywhere. Style encapsulation is given up on purpose. |
| Main layout | **Two panes side by side**: route editor on the left, results on the right, both always visible. Stack vertically on narrow windows. |
| Route editor | Each route is a **card in an ordered list**. **Drag to reorder**; click a card to **expand and edit it in place**. Results update live. |
| Results table | **Grouped by route** by default: collapsible sections for each route, plus precache and default, each showing request count and total size. A toggle switches to a flat list in load order. |
| Visual direction | **Neutral now, branded later.** A plain, dense developer-tool look built entirely on design tokens (colour, type, spacing as CSS custom properties), so a SuperGeekery "Press Check" theme can be applied later without touching components. |
| Colour scheme | **Light and dark, following the system setting**, through the same tokens. |

What follows from those choices:

- **Light DOM in Lit** means overriding `createRenderRoot()` to return the element itself. Slots don't work without shadow DOM, so compose with properties and templates instead.
- **Dragging must not be the only way to reorder.** Give each card keyboard-operable move up and move down controls, and announce the new position to screen readers.
- **Grouping and virtual scrolling have to work together.** Collapsed groups cost nothing; an expanded group with thousands of rows still needs virtualised rendering. Decide the approach before building the table, and measure it with a large real HAR.
- **A zero-match route still gets a group**, shown empty with its dead-route warning. That empty section is the tool's most useful single view.
- **No hard-coded colours or font names in components.** Everything goes through tokens, in both schemes, or the later brand theme becomes a rewrite.
- **Strategy and warning colours must not rely on colour alone**; pair each with a label or icon.

## Milestones

Each one ends with something that can be shown and checked.

1. **Engine with fixtures.** HAR parsing, the route model, matching order, and the dead-route warning. Hand-written fixture for bug 1. Unit tests only, no UI.
   *Done when:* a test feeds in the "broad first route" config and gets a dead-route warning naming the right route.
2. **Remaining warnings.** One fixture and one test per row of the warnings table.
   *Done when:* all nine warnings have a passing test with a fixture that triggers it and one that doesn't.
3. **Read-only results UI.** Load a HAR, load a JSON config, see the grouped request table, summaries and warnings, in light and dark schemes.
   *Done when:* a real HAR from SuperGeekery.com renders and scrolls smoothly, and the numbers match the engine's test output.
4. **Route editor.** Add, edit, reorder (drag and keyboard) and delete routes in the left pane, with results updating live. Save to local storage.
   *Done when:* dragging the broad route below the CDN route makes the dead-route warning disappear without a reload.
5. **Export.** Generate the Workbox service worker source and the JSON config.
   *Done when:* the exported worker for the SuperGeekery config is behaviourally the same as the one now in that repo (`sw.ts`), checked by reading both.
6. **Real-world pass and launch.** Try HAR files from three or four different sites and from Firefox and Safari. Fix what breaks. Write the README. Deploy to `sw.morton.dev` and confirm the Content-Security-Policy header is in place.

## Testing

- The engine is tested with fixtures, one per warning, each in a triggering and a non-triggering form.
- The seven bugs listed at the top are the acceptance suite. The SuperGeekery worker **before** today's fixes should raise warnings 1, 3 and 4 at least. The worker **after** the fixes should raise none of them.
- Both versions of that worker are in the SuperGeekery repo history: the commit before `a0367fa` has the broken route order, and `ef04728` has the corrected worker and precache. Use them as the reference for writing the fixtures by hand (see "Open source").
- UI tests can stay light: one browser test that loads a fixture HAR and checks a warning appears.

## Open questions for John

None. The licence question was settled on 21 November 2026: MIT.

## First steps for the new session

1. Read this file.
2. Skim the "Prior art" section. The search is done; repeat it only if something there looks out of date.
3. Check the Workbox documentation for the four matching-order points and the precache query-string defaults.
4. Export a HAR from Chrome and confirm the `Sec-Fetch-*` headers are present.
5. Ask John the open questions above, then scaffold and start milestone 1.
