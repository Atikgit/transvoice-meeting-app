import { NextResponse, type NextRequest } from 'next/server'
import { afterSignIn } from '@/lib/auth/account'
import { safeNextPath } from '@/lib/auth/redirect'
import { requestOrigin } from '@/lib/http/request'
import { createClient } from '@/lib/supabase/server'

/** OAuth and PKCE email-link callback: exchanges ?code for a session cookie. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const next = safeNextPath(params.get('next'))
  const origin = await requestOrigin()
  const code = params.get('code')

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // OAuth sign-in or email confirmation: account, trial and signup country.
      await afterSignIn(data.user.id, request.headers)
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  if (next.startsWith('/auth/reset')) {
    return NextResponse.redirect(`${origin}/forgot-password?error=link`)
  }

  const login = new URL('/login', origin)
  login.searchParams.set('error', 'callback')
  login.searchParams.set('next', next)
  return NextResponse.redirect(login)
}
