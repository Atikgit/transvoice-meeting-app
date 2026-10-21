import 'server-only'
import type { BillingStore } from '@/lib/billing/lemonsqueezy'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/database.types'

/** BillingStore backed by the SECURITY DEFINER SQL functions (service role). */
export function supabaseBillingStore(): BillingStore {
  const db = createAdminClient()
  return {
    async linkSubscription(input) {
      const { error } = await db.rpc('link_subscription', {
        p_user: input.userId,
        p_subscription_id: input.subscriptionId,
        p_customer_id: input.customerId,
        p_variant_id: input.variantId,
        p_status: input.status,
        p_period_end: input.periodEnd,
      })
      if (error) throw new Error(`link_subscription failed: ${error.message}`)
    },
    async creditMinutes(input) {
      const { data, error } = await db.rpc('credit_minutes', {
        p_user: input.userId,
        p_minutes: input.minutes,
        p_event_id: input.eventId,
        p_event_name: input.eventName,
        p_variant_id: input.variantId,
        p_plan: input.plan,
        p_payload: input.payload as Json,
      })
      if (error) throw new Error(`credit_minutes failed: ${error.message}`)
      return data === true
    },
    async findAccountBySubscription(subscriptionId) {
      const { data, error } = await db
        .from('billing_accounts')
        .select('user_id, ls_variant_id')
        .eq('ls_subscription_id', subscriptionId)
        .maybeSingle()
      if (error) throw new Error(`billing account lookup failed: ${error.message}`)
      return data ? { userId: data.user_id, variantId: data.ls_variant_id } : null
    },
  }
}
