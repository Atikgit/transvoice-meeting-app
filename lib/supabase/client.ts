import { createBrowserClient } from '@supabase/ssr'
import { clientEnv } from '@/lib/env.client'

/** Browser Supabase client (anon key, user session from cookies). Singleton in the browser. */
export function createClient() {
  const env = clientEnv()
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}
