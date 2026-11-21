// The engine's public surface: parse a HAR, simulate a config against it.
// No DOM, no network, no storage, so it runs the same in a page, a Web
// Worker, Node or CI.

export { bestPage, parseHar, parseHarText, selectPage } from './har.ts'
export { simulate } from './simulate.ts'
export { cacheLifetime, formatBytes } from './warnings.ts'
export { hasContentHash, looksVersioned } from './versioning.ts'
export * from './defaults.ts'
export type * from './types.ts'
export { ConfigError, emptyConfig, parseConfig } from './config.ts'
