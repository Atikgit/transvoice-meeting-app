import { NextResponse, type NextRequest } from 'next/server'
import { afterSignIn } from '@/lib/auth/account'
import { classifyLinkError, EMAIL_FLOW_PARAM, loginErrorFor } from '@/lib/auth/link-errors'
import { safeNextPath } from '@/lib/auth/redirect'
import { requestOrigin } from '@/lib/http/request'
import { createClient } from '@/lib/supabase/server'

/**
 * OAuth (and PKCE email-link) callback: exchanges ?code for a session cookie.
 * Supabase reports provider and link errors as ?error=&error_code=&error_description=.
 * Failures are logged server-side and explained on /login.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const next = safeNextPath(params.get('next'))
  const origin = await requestOrigin()
  const code = params.get('code')
  const fromEmail = params.get(EMAIL_FLOW_PARAM) === 'email'

  let errorCode = params.get('error_code') ?? params.get('error')
  if (errorCode) {
    console.error('[auth/callback] provider returned an error', {
      error: params.get('error'),
      code: params.get('error_code'),
      description: params.get('error_description'),
    })
  } else if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // OAuth sign-in or email confirmation: account, trial and signup country.
      await afterSignIn(data.user.id, request.headers)
      return NextResponse.redirect(`${origin}${next}`)
    }
    console.error('[auth/callback] code exchange failed', {
      code: error.code,
      status: error.status,
      message: error.message,
    })
    errorCode = error.code ?? 'exchange_failed'
  } else {
    console.error('[auth/callback] called without code')
  }

  if (next.startsWith('/auth/reset')) {
    return NextResponse.redirect(`${origin}/forgot-password?error=link`)
  }

  const login = new URL('/login', origin)
  login.searchParams.set(
    'error',
    fromEmail ? loginErrorFor(classifyLinkError(errorCode)) : 'callback',
  )
  login.searchParams.set('next', next)
  return NextResponse.redirect(login)
}
