# Service Worker Toolkit

A static web app that lets you configure a service worker's caching rules and see what they would do to a real site's requests **before** you deploy anything. You load a HAR file exported from browser DevTools, define an ordered list of routes, and it shows which route would handle every request, what would end up in each cache, and which known mistakes the configuration makes.

It is a tool, not a library: it does not run in your service worker. (It is unrelated to Google's deprecated `sw-toolbox`, and it generates [Workbox](https://developer.chrome.com/docs/workbox) code rather than replacing it.)

**HAR files never leave your browser.** The file is parsed in the page, there is no backend, and cookies, authorisation headers and response bodies are discarded at parse time.

## Status

Early. The simulation engine and its nine warnings are built and tested. The web interface and the Workbox export are not built yet. See [PROJECT-PLAN.md](PROJECT-PLAN.md) for the milestones.

## What it warns about

| Warning | What it means |
|---|---|
| Dead route | A route matches nothing because an earlier route takes its requests |
| Mixed content types | One caching route handles both pages and subresources |
| Opaque response to a CORS request | A route forces `no-cors` and handles a request made in CORS mode |
| Opaque responses cached | A route writes opaque (status 0) responses to its cache |
| Precache entry never requested | A precached URL is only ever requested with a query string that does not match |
| Precache weight | The precache is over its size budget |
| Range request on a caching route | Audio, video or a `Range` request is answered from a cache |
| Unhashed file on cache-first | A cache-first route handles a URL with no content hash or version |
| Worker script cached upstream | The service worker script is served with a cache lifetime |

## Running it locally

Requires Node 22.12 or later.

```sh
npm install
npm run check   # typecheck, lint and tests
npm test        # tests only
```

## Layout

```
src/engine/   HAR parsing, route matching, simulation, warnings (no DOM)
fixtures/     hand-written requests and configs, one pair per warning
tests/
```

The engine is one pure function, `simulate(parseHar(har), config)`. Its concepts (routes, strategies, caches) are not tied to a library; the Workbox behaviour it models is confined to `src/engine/defaults.ts`.

Fixtures are written by hand on placeholder domains. Never commit a HAR exported from a real browsing session.

## Licence

[MIT](LICENSE)
