import { NextResponse, type NextRequest } from 'next/server'
import { DEFAULT_AFTER_LOGIN, safeNextPath } from '@/lib/auth/redirect'
import { updateSession } from '@/lib/supabase/middleware'

const PROTECTED = [/^\/dashboard(\/|$)/, /^\/m\//]
const AUTH_PAGES = ['/login', '/signup']

export async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request)
  const { pathname, search } = request.nextUrl

  if (!userId && PROTECTED.some((pattern) => pattern.test(pathname))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = `?next=${encodeURIComponent(pathname + search)}`
    return redirectWithCookies(url, response)
  }

  if (userId && AUTH_PAGES.includes(pathname)) {
    const url = request.nextUrl.clone()
    const next = safeNextPath(request.nextUrl.searchParams.get('next'), DEFAULT_AFTER_LOGIN)
    const target = new URL(next, request.url)
    url.pathname = target.pathname
    url.search = target.search
    return redirectWithCookies(url, response)
  }

  return response
}

/** Keeps refreshed session cookies when redirecting. */
function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url)
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
  return redirect
}

export const config = {
  // Pages only: API routes authenticate themselves, and static assets need no session.
  matcher: [
    '/((?!api/|_next/static|_next/image|favicon.ico|icon|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
