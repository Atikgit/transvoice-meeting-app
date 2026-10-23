import type { SupabaseClient } from '@supabase/supabase-js'
import type { BillingAccount, Database } from '@/lib/supabase/database.types'

/** billing_accounts columns the UI shows. The owner may select them under RLS. */
export const BALANCE_COLUMNS =
  'billing_type, trial_minutes_remaining, prepaid_minutes_remaining, postpaid_minutes_accrued'

export type Balance = Pick<
  BillingAccount,
  | 'billing_type'
  | 'trial_minutes_remaining'
  | 'prepaid_minutes_remaining'
  | 'postpaid_minutes_accrued'
>

/** Minutes the user can spend now: trial bucket + subscription (prepaid) bucket. */
export function availableMinutes(
  account: Pick<BillingAccount, 'trial_minutes_remaining' | 'prepaid_minutes_remaining'>,
): number {
  return Number(account.trial_minutes_remaining) + Number(account.prepaid_minutes_remaining)
}

/** Header text: remaining minutes, or usage for postpaid accounts. */
export function minutesLabel(account: Balance | null): string {
  if (!account) return '—'
  if (account.billing_type === 'postpaid') {
    return `${Number(account.postpaid_minutes_accrued).toFixed(0)} min used this period`
  }
  return `${availableMinutes(account).toFixed(0)} min remaining`
}

/** The signed-in user's own balance, read through RLS (works with server or browser clients). */
export async function fetchBalance(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<Balance | null> {
  const { data, error } = await supabase
    .from('billing_accounts')
    .select(BALANCE_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) console.error('billing_accounts select failed:', error.message)
  return data
}
