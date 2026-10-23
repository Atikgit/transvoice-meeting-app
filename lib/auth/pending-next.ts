import 'server-only'
import { cookies } from 'next/headers'
import { DEFAULT_AFTER_LOGIN, safeNextPath } from '@/lib/auth/redirect'

/**
 * Where an email signup wanted to go (e.g. /invite/abc). The confirmation email template links to
 * /auth/confirm with a fixed next=/dashboard, so the destination is kept in this cookie and
 * applied by /auth/confirm when the link is opened in the same browser.
 */
export const PENDING_NEXT_COOKIE = 'tv_pending_next'

export async function rememberPendingNext(next: string): Promise<void> {
  if (next === DEFAULT_AFTER_LOGIN) return
  ;(await cookies()).set(PENDING_NEXT_COOKIE, next, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24,
  })
}

/** The link's own next, unless it is the default and a pending destination was remembered. */
export function resolveNext(linkNext: string | null, pending: string | undefined): string {
  const next = safeNextPath(linkNext)
  if (next !== DEFAULT_AFTER_LOGIN || !pending) return next
  return safeNextPath(pending)
}
