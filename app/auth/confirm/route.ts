import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { afterSignIn } from '@/lib/auth/account'
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
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const origin = await requestOrigin()
  const tokenHash = params.get('token_hash')
  const type = params.get('type') as EmailOtpType | null

  if (tokenHash && type && EMAIL_OTP_TYPES.includes(type)) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) {
      if (data.user) await afterSignIn(data.user.id, request.headers)
      const target = SET_PASSWORD_TYPES.includes(type)
        ? '/auth/reset'
        : resolveNext(params.get('next'), request.cookies.get(PENDING_NEXT_COOKIE)?.value)
      const response = NextResponse.redirect(`${origin}${target}`)
      response.cookies.delete(PENDING_NEXT_COOKIE)
      return response
    }
  }

  if (type === 'recovery') return NextResponse.redirect(`${origin}/forgot-password?error=link`)

  const login = new URL('/login', origin)
  login.searchParams.set('error', 'confirm')
  return NextResponse.redirect(login)
}
