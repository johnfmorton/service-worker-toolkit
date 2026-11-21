// Does a URL look safe to cache forever? A heuristic: it reads the URL only,
// so it can be wrong in both directions. It errs towards calling a name
// hashed, because a missed warning costs less than a false alarm on every
// build file.

const VERSION_PARAM = /^(v|ver|version|rev|revision|hash|h|cb|t|ts|mtime|_)$/i

function isHashLike(token: string): boolean {
	if (token.length < 8 || !/^[A-Za-z0-9_-]+$/.test(token)) return false
	const digits = token.replace(/\D/g, '').length
	const hasLower = /[a-z]/.test(token)
	const hasUpper = /[A-Z]/.test(token)
	// 'a3f9c21b', 'BxK2a9Qz', 'BdKQzXnA'; but not 'bootstrap5' or 'MyComponent'.
	if (digits >= 2 && (hasLower || hasUpper)) return true
	if (digits >= 1 && hasLower && hasUpper) return true
	const innerCapitals = token.slice(1).replace(/[^A-Z]/g, '').length
	return hasLower && innerCapitals >= 3
}

/** True when the file name carries something that looks like a content hash. */
export function hasContentHash(pathname: string): boolean {
	const file = pathname.slice(pathname.lastIndexOf('/') + 1)
	const dot = file.lastIndexOf('.')
	const stem = dot > 0 ? file.slice(0, dot) : file
	if (stem.split(/[.\-_]/).some(isHashLike)) return true
	// Base64url hashes can contain '-' and '_' themselves: 'index-B-x2_9Qz.js'.
	const tail = /[.-]([A-Za-z0-9_-]{8})$/.exec(stem)?.[1]
	return tail !== undefined && /\d/.test(tail) && /[A-Z]/.test(tail) && /[a-z]/.test(tail)
}

/** True when the URL is versioned by a content hash, a version number or a version query. */
export function looksVersioned(url: URL): boolean {
	if (hasContentHash(url.pathname)) return true
	// 'jquery-3.7.1.min.js', '/npm/lit@3.2.0/index.js'
	if (/\d+\.\d+\.\d+/.test(url.pathname)) return true
	for (const [name, value] of url.searchParams) {
		// '?v=1.0', or a bare '?8f3a2c'
		if (value === '' || VERSION_PARAM.test(name)) return true
	}
	return false
}
