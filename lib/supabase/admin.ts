import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/env'
import type { Database } from './database.types'

let adminClient: SupabaseClient<Database> | undefined

/**
 * Service-role Supabase client. Bypasses RLS — use only in trusted server code
 * (webhooks, cron, SECURITY DEFINER RPC calls), never with client-supplied identity.
 */
export function createAdminClient(): SupabaseClient<Database> {
  if (!adminClient) {
    const env = serverEnv()
    adminClient = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    )
  }
  return adminClient
}
