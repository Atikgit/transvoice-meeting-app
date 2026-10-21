import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from './database.types'

/**
 * Refreshes the Supabase auth session cookies and returns the signed-in user id (or null).
 * Used by proxy.ts. getClaims() verifies the JWT (locally when the project uses asymmetric
 * signing keys), so this is an optimistic check; pages still call getUser() for authorization.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Do not run code between createServerClient and getClaims(): it can cause random logouts.
  const { data } = await supabase.auth.getClaims()
  const userId = typeof data?.claims.sub === 'string' ? data.claims.sub : null

  return { response, userId }
}
