import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/env'

let adminClient: SupabaseClient | undefined

/**
 * Service-role Supabase client. Bypasses RLS — use only in trusted server code
 * (webhooks, cron, SECURITY DEFINER RPC calls), never with client-supplied identity.
 */
export function createAdminClient(): SupabaseClient {
  if (!adminClient) {
    const env = serverEnv()
    adminClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return adminClient
}
