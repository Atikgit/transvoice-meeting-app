export const DEFAULT_AFTER_LOGIN = '/dashboard'

/**
 * Returns `next` only if it is a same-origin path ("/dashboard?x=1"), otherwise the fallback.
 * Blocks open redirects such as "//evil.com", "/\evil.com" and "https://evil.com".
 */
export function safeNextPath(next: unknown, fallback = DEFAULT_AFTER_LOGIN): string {
  if (typeof next !== 'string' || next.length === 0 || next.length > 2048) return fallback
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  if (/[\u0000-\u001f]/.test(next)) return fallback
  try {
    const url = new URL(next, 'http://local.invalid')
    if (url.origin !== 'http://local.invalid') return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

/** "/login?next=…" style link that preserves where the user was going. */
export function withNext(path: '/login' | '/signup', next: string | undefined): string {
  const safe = safeNextPath(next, '')
  return safe ? `${path}?next=${encodeURIComponent(safe)}` : path
}
