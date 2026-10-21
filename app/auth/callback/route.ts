import { NextResponse, type NextRequest } from 'next/server'
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
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}${next}`)
  }

  const login = new URL('/login', origin)
  login.searchParams.set('error', 'callback')
  login.searchParams.set('next', next)
  return NextResponse.redirect(login)
}
