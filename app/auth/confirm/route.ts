import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { afterSignIn } from '@/lib/auth/account'
import { safeNextPath } from '@/lib/auth/redirect'
import { requestOrigin } from '@/lib/http/request'
import { createClient } from '@/lib/supabase/server'

const EMAIL_OTP_TYPES: EmailOtpType[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
]

/**
 * Email confirmation via token hash. Unlike the PKCE ?code flow, it works when the link is
 * opened in a different browser than the one used to sign up. Requires the Supabase
 * "Confirm signup" template to link to {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const next = safeNextPath(params.get('next'))
  const origin = await requestOrigin()
  const tokenHash = params.get('token_hash')
  const type = params.get('type') as EmailOtpType | null

  if (tokenHash && type && EMAIL_OTP_TYPES.includes(type)) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) {
      if (data.user) await afterSignIn(data.user.id, request.headers)
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  if (type === 'recovery') return NextResponse.redirect(`${origin}/forgot-password?error=link`)

  const login = new URL('/login', origin)
  login.searchParams.set('error', 'confirm')
  return NextResponse.redirect(login)
}
