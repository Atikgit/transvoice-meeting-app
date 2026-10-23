import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { afterSignIn } from '@/lib/auth/account'
import { classifyLinkError, loginErrorFor } from '@/lib/auth/link-errors'
import { PENDING_NEXT_COOKIE, resolveNext } from '@/lib/auth/pending-next'
import { requestOrigin } from '@/lib/http/request'
import { createClient } from '@/lib/supabase/server'

const EMAIL_OTP_TYPES: EmailOtpType[] = ['signup', 'email', 'recovery', 'email_change', 'invite']

/** Link types whose user still has to choose a password. */
const SET_PASSWORD_TYPES: EmailOtpType[] = ['recovery', 'invite']

/**
 * Email links via token hash (see docs/supabase-setup.md for the templates). Unlike the PKCE
 * ?code flow in /auth/callback (kept for OAuth), it works when the link is opened on another
 * device or browser than the one that asked for it.
 *
 *   signup / email → account + trial → `next` (or the destination remembered at signup) → /dashboard
 *   recovery / invite → /auth/reset to set a password
 *   email_change → `next`
 *
 * Failures are logged server-side (never the token) and explained on /login or /forgot-password.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const origin = await requestOrigin()
  const tokenHash = params.get('token_hash')
  const type = params.get('type') as EmailOtpType | null
  const next = resolveNext(params.get('next'), request.cookies.get(PENDING_NEXT_COOKIE)?.value)
  const redirect = (path: string) => {
    const response = NextResponse.redirect(`${origin}${path}`)
    response.cookies.delete(PENDING_NEXT_COOKIE)
    return response
  }

  if (!tokenHash || !type || !EMAIL_OTP_TYPES.includes(type)) {
    console.error('[auth/confirm] malformed link', { type, hasTokenHash: Boolean(tokenHash) })
    return NextResponse.redirect(`${origin}/login?error=confirm`)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
  if (!error) {
    if (data.user) await afterSignIn(data.user.id, request.headers)
    return redirect(SET_PASSWORD_TYPES.includes(type) ? '/auth/reset' : next)
  }

  console.error('[auth/confirm] verifyOtp failed', {
    type,
    code: error.code,
    status: error.status,
    message: error.message,
  })
  const failure = classifyLinkError(error.code)

  if (type === 'recovery') return NextResponse.redirect(`${origin}/forgot-password?error=link`)

  // Opened twice in a browser that is already signed in: the email is confirmed, carry on.
  if (failure !== 'invalid') {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user?.email_confirmed_at) return redirect(next)
  }

  return NextResponse.redirect(`${origin}/login?error=${loginErrorFor(failure)}`)
}
