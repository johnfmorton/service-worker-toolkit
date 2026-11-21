// One fixture per warning, each in a form that triggers it and one that does not.

import type { WarningCode } from '../../src/engine/types.ts'
import type { Scenario } from '../har-builder.ts'
import * as deadRoute from './dead-route.ts'
import * as mixedContentTypes from './mixed-content-types.ts'
import * as opaqueCached from './opaque-cached.ts'
import * as opaqueToCors from './opaque-to-cors.ts'
import * as precacheNeverRequested from './precache-never-requested.ts'
import * as precacheWeight from './precache-weight.ts'
import * as rangeOnCachingRoute from './range-on-caching-route.ts'
import * as unhashedCacheFirst from './unhashed-cache-first.ts'
import * as workerScriptCached from './worker-script-cached.ts'

export const warningFixtures: Record<WarningCode, { triggering: Scenario, clean: Scenario }> = {
	'dead-route': deadRoute,
	'mixed-content-types': mixedContentTypes,
	'opaque-to-cors': opaqueToCors,
	'opaque-cached': opaqueCached,
	'precache-never-requested': precacheNeverRequested,
	'precache-weight': precacheWeight,
	'range-on-caching-route': rangeOnCachingRoute,
	'unhashed-cache-first': unhashedCacheFirst,
	'worker-script-cached': workerScriptCached,
}
