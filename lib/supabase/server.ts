import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { serverEnv } from '@/lib/env'
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
export async function getSessionUser() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  return data.user
}
