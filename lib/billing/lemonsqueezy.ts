import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { planByVariantId } from '@/lib/billing/plans'

/** Constant-time check of the X-Signature header (hex HMAC-SHA256 of the raw body). */
export function verifySignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'), 'utf8')
  const received = Buffer.from(signature, 'utf8')
  return expected.length === received.length && timingSafeEqual(expected, received)
}

const webhookSchema = z.object({
  meta: z.object({
    event_name: z.string(),
    custom_data: z.object({ user_id: z.uuid().optional() }).nullish(),
  }),
  data: z.object({
    id: z.string(),
    attributes: z.record(z.string(), z.unknown()),
  }),
})

const subscriptionSchema = z.object({
  variant_id: z.number().int(),
  customer_id: z.number().int(),
  status: z.string(),
  renews_at: z.string().nullish(),
})

const invoiceSchema = z.object({
  subscription_id: z.number().int(),
  billing_reason: z.string(),
  status: z.string(),
})

const SUBSCRIPTION_STATUSES = new Set([
  'active',
  'on_trial',
  'past_due',
  'paused',
  'unpaid',
  'cancelled',
  'expired',
])

export type LemonSqueezyWebhook = z.infer<typeof webhookSchema>

export function parseWebhook(rawBody: string): LemonSqueezyWebhook {
  return webhookSchema.parse(JSON.parse(rawBody))
}

/** Database operations the handler needs (implemented with the service-role client). */
export interface BillingStore {
  linkSubscription(input: {
    userId: string
    subscriptionId: string
    customerId: string
    variantId: number
    status: string
    periodEnd: string | null
  }): Promise<void>
  /** Resets the prepaid bucket to the plan's minutes. Returns false for a duplicate event. */
  creditMinutes(input: {
    userId: string
    minutes: number
    eventId: string
    eventName: string
    variantId: number
    plan: string
    payload: unknown
  }): Promise<boolean>
  findAccountBySubscription(
    subscriptionId: string,
  ): Promise<{ userId: string; variantId: number | null } | null>
}

export type WebhookOutcome =
  | { status: 'credited'; userId: string; minutes: number }
  | { status: 'duplicate' }
  | { status: 'linked'; userId: string }
  | { status: 'ignored'; reason: string }
  /** Temporary condition; the route answers 5xx so Lemon Squeezy retries. */
  | { status: 'retry'; reason: string }

/**
 * Prepaid subscriptions (docs/PROMPT.md §13): each paid period resets the prepaid bucket to the
 * plan's minutes. The first period is credited on `subscription_created`; renewals and plan
 * changes on `subscription_payment_success` (billing_reason != 'initial').
 */
export async function handleWebhook(
  event: LemonSqueezyWebhook,
  store: BillingStore,
): Promise<WebhookOutcome> {
  const name = event.meta.event_name

  switch (name) {
    case 'subscription_created':
    case 'subscription_updated': {
      const attrs = subscriptionSchema.safeParse(event.data.attributes)
      if (!attrs.success) return { status: 'ignored', reason: 'malformed subscription' }
      const { variant_id: variantId, customer_id, status, renews_at } = attrs.data

      const userId =
        event.meta.custom_data?.user_id ??
        (await store.findAccountBySubscription(event.data.id))?.userId
      if (!userId) return { status: 'ignored', reason: 'no user for subscription' }

      const plan = planByVariantId(variantId)
      if (!plan) return { status: 'ignored', reason: `unknown variant ${variantId}` }

      await store.linkSubscription({
        userId,
        subscriptionId: event.data.id,
        customerId: String(customer_id),
        variantId,
        status: SUBSCRIPTION_STATUSES.has(status) ? status : 'active',
        periodEnd: renews_at ?? null,
      })

      if (name === 'subscription_updated' || status !== 'active') {
        return { status: 'linked', userId }
      }
      return credit(store, event, userId, plan.minutesPerPeriod, variantId, plan.id)
    }

    case 'subscription_payment_success': {
      const attrs = invoiceSchema.safeParse(event.data.attributes)
      if (!attrs.success) return { status: 'ignored', reason: 'malformed invoice' }
      if (attrs.data.billing_reason === 'initial') {
        return { status: 'ignored', reason: 'initial period is credited on subscription_created' }
      }
      if (attrs.data.status !== 'paid') return { status: 'ignored', reason: 'invoice not paid' }

      const account = await store.findAccountBySubscription(String(attrs.data.subscription_id))
      if (!account?.variantId) return { status: 'retry', reason: 'subscription not linked yet' }

      const plan = planByVariantId(account.variantId)
      if (!plan) return { status: 'ignored', reason: `unknown variant ${account.variantId}` }

      return credit(store, event, account.userId, plan.minutesPerPeriod, plan.variantId, plan.id)
    }

    default:
      return { status: 'ignored', reason: `unhandled event ${name}` }
  }
}

async function credit(
  store: BillingStore,
  event: LemonSqueezyWebhook,
  userId: string,
  minutes: number,
  variantId: number,
  plan: string,
): Promise<WebhookOutcome> {
  const credited = await store.creditMinutes({
    userId,
    minutes,
    eventId: `${event.meta.event_name}:${event.data.id}`,
    eventName: event.meta.event_name,
    variantId,
    plan,
    payload: event,
  })
  return credited ? { status: 'credited', userId, minutes } : { status: 'duplicate' }
}
