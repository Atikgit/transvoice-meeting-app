import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { serverEnv } from '@/lib/env'
import type { User } from '@supabase/supabase-js'
import type { Database } from './database.types'

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Acts as the signed-in user (RLS applies). Use this to derive identity — never trust a client-sent userId.
 */
export async function createClient() {
  const env = serverEnv()
  const cookieStore = await cookies()

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The proxy (updateSession) refreshes the session instead.
          }
        },
      },
    },
  )
}

/** Returns the authenticated user (verified with Supabase Auth), or null. */
export async function getSessionUser(): Promise<User | null>
/**
 * `{ local: true }`: the hot path (every utterance). The JWT is verified with getClaims(): locally
 * against the project's cached signing keys (JWKS) when they are asymmetric, so there is no round
 * trip to Supabase Auth; with a symmetric secret getClaims() asks the Auth server like getUser().
 * Returns only what the translation routes use. The trade-off: a session revoked on the server
 * stays valid here until its access token expires (default 1 h), which is why pages that
 * authorize sensitive changes still call the default form.
 */
export async function getSessionUser(options: {
  local: true
}): Promise<{ id: string; email?: string } | null>
export async function getSessionUser(options?: { local?: boolean }) {
  const supabase = await createClient()
  if (options?.local) {
    const { data } = await supabase.auth.getClaims()
    const claims = data?.claims
    if (!claims || typeof claims.sub !== 'string') return null
    return { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : undefined }
  }
  const { data } = await supabase.auth.getUser()
  return data.user
}
