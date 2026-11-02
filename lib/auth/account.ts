import 'server-only'
import { cache } from 'react'
import { type Balance, fetchBalance } from '@/lib/billing/balance'
import { serverEnv } from '@/lib/env'
import { resolveSignupGeo } from '@/lib/geo/signup-geo'
import { createAdminClient } from '@/lib/supabase/admin'
import { nullableArg } from '@/lib/supabase/database.types'
import { createClient } from '@/lib/supabase/server'

/**
 * Creates a missing profile/billing account and grants the free trial to verified users
 * (confirmed email or a provider-verified Google/LinkedIn identity). Idempotent. Never throws:
 * signing in must not fail because of it.
 */
export async function ensureUserAccount(userId: string): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc('ensure_user_account', { p_user: userId })
    if (error) console.error('ensure_user_account failed:', error.message)
  } catch (error) {
    console.error('ensure_user_account failed:', error)
  }
}

/** Stores the signup country and IP hash once (while profiles.country_code is null). Never throws. */
export async function recordSignupGeo(userId: string, headers: Headers): Promise<void> {
  try {
    const env = serverEnv()
    const geo = await resolveSignupGeo(headers, {
      salt: env.IP_HASH_SALT,
      dbPath: env.GEOIP_DB_PATH,
    })
    const { error } = await createAdminClient().rpc('record_signup_geo', {
      p_user: userId,
      p_country_code: nullableArg(geo.countryCode),
      p_country_name: nullableArg(geo.countryName),
      p_ip_hash: nullableArg(geo.ipHash),
    })
    if (error) console.error('record_signup_geo failed:', error.message)
  } catch (error) {
    console.error('record_signup_geo failed:', error)
  }
}

/** Run by the auth callback routes after every email confirmation or OAuth sign-in. */
export async function afterSignIn(userId: string, headers: Headers): Promise<void> {
  await ensureUserAccount(userId) // creates the profile that recordSignupGeo updates
  await recordSignupGeo(userId, headers)
}

/**
 * The signed-in user's balance for this request (deduplicated between layout and page).
 * Self-heals an account the signup trigger did not create.
 */
export const currentBalance = cache(async (userId: string): Promise<Balance | null> => {
  const supabase = await createClient()
  const balance = await fetchBalance(supabase, userId)
  if (balance) return balance
  await ensureUserAccount(userId)
  return fetchBalance(supabase, userId)
})

export type TrialStatus = 'granted' | 'unconfirmed' | 'already_used' | 'pending'

/** What the dashboard says when an account has no free minutes. */
export const TRIAL_NOTICES: Record<Exclude<TrialStatus, 'granted'>, string> = {
  unconfirmed: 'Confirm your email to get 15 free minutes.',
  already_used: 'A free trial was already used for this address.',
  pending: 'Your free minutes are being set up. Reload in a moment.',
}

/**
 * Why the account has no free trial, or null when it has one (or the answer is unknown, e.g. the
 * database function is not deployed yet). A verified account that was never granted is run through
 * ensure_user_account once (the same call sign-in makes) and looked at again. Never grants minutes
 * itself and never throws.
 */
export async function trialNotice(userId: string): Promise<string | null> {
  const ask = async (): Promise<TrialStatus | null> => {
    const { data, error } = await createAdminClient().rpc('trial_status', { p_user: userId })
    if (error) {
      console.error('trial_status failed:', error.message)
      return null
    }
    return data as TrialStatus
  }
  try {
    let status = await ask()
    if (status === 'pending') {
      await ensureUserAccount(userId)
      status = await ask()
    }
    return status && status !== 'granted' ? TRIAL_NOTICES[status] : null
  } catch (error) {
    console.error('trial_status failed:', error)
    return null
  }
}
