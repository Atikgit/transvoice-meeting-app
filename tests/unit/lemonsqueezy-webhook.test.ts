import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  handleWebhook,
  parseWebhook,
  verifySignature,
  type BillingStore,
} from '@/lib/billing/lemonsqueezy'
import { LEMON_SQUEEZY_PLANS, planByVariantId } from '@/lib/billing/plans'

const USER = '6f1c3c2e-8a4b-4c55-9a3b-2f6d1e7a9b10'
const SECRET = 'test-ls-webhook-secret'

/** In-memory store with the same idempotency semantics as the SQL functions. */
function fakeStore() {
  const accounts = new Map<
    string,
    { subscriptionId?: string; variantId: number | null; prepaid: number }
  >()
  const events = new Set<string>()
  const store: BillingStore = {
    async linkSubscription({ userId, subscriptionId, variantId }) {
      accounts.set(userId, {
        ...(accounts.get(userId) ?? { prepaid: 0 }),
        subscriptionId,
        variantId,
      })
    },
    async creditMinutes({ userId, minutes, eventId }) {
      if (events.has(eventId)) return false
      events.add(eventId)
      const account = accounts.get(userId) ?? { variantId: null, prepaid: 0 }
      accounts.set(userId, { ...account, prepaid: minutes })
      return true
    },
    async findAccountBySubscription(subscriptionId) {
      for (const [userId, account] of accounts) {
        if (account.subscriptionId === subscriptionId)
          return { userId, variantId: account.variantId }
      }
      return null
    },
  }
  return { store, accounts }
}

function subscriptionEvent(name: string, variantId: number, status = 'active') {
  return parseWebhook(
    JSON.stringify({
      meta: { event_name: name, custom_data: { user_id: USER } },
      data: {
        id: '555',
        type: 'subscriptions',
        attributes: {
          variant_id: variantId,
          customer_id: 77,
          status,
          renews_at: '2026-11-22T00:00:00Z',
        },
      },
    }),
  )
}

function paymentEvent(invoiceId: string, billingReason: string, subscriptionId = 555) {
  return parseWebhook(
    JSON.stringify({
      meta: { event_name: 'subscription_payment_success', custom_data: { user_id: USER } },
      data: {
        id: invoiceId,
        type: 'subscription-invoices',
        attributes: {
          subscription_id: subscriptionId,
          billing_reason: billingReason,
          status: 'paid',
        },
      },
    }),
  )
}

describe('plans', () => {
  it('maps the three checkout plans by numeric variant id', () => {
    expect(LEMON_SQUEEZY_PLANS.map((p) => [p.name, p.variantId, p.minutesPerPeriod])).toEqual([
      ['Bronze Starter', 2229952, 120],
      ['Diamond Pro', 2229957, 300],
      ['Business Standard', 2229969, 600],
    ])
    expect(planByVariantId(2229957)?.id).toBe('diamond')
    expect(planByVariantId(1425520)).toBeUndefined() // older "Diamond Pro" product
  })
})

describe('verifySignature', () => {
  const body = '{"meta":{}}'
  const good = createHmac('sha256', SECRET).update(body).digest('hex')

  it('accepts the correct HMAC', () => {
    expect(verifySignature(body, good, SECRET)).toBe(true)
  })

  it('rejects a wrong, truncated or missing signature', () => {
    const tampered = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0')
    expect(verifySignature(body, tampered, SECRET)).toBe(false)
    expect(verifySignature(body, good.slice(0, 10), SECRET)).toBe(false)
    expect(verifySignature(body, null, SECRET)).toBe(false)
    expect(verifySignature(`${body} `, good, SECRET)).toBe(false)
  })
})

describe('handleWebhook', () => {
  it('credits the first period on subscription_created, once', async () => {
    const { store, accounts } = fakeStore()
    const event = subscriptionEvent('subscription_created', 2229969)
    expect(await handleWebhook(event, store)).toEqual({
      status: 'credited',
      userId: USER,
      minutes: 600,
    })
    expect(await handleWebhook(event, store)).toEqual({ status: 'duplicate' })
    expect(accounts.get(USER)).toMatchObject({
      prepaid: 600,
      subscriptionId: '555',
      variantId: 2229969,
    })
  })

  it('ignores the initial payment_success (already credited) and credits renewals', async () => {
    const { store, accounts } = fakeStore()
    await handleWebhook(subscriptionEvent('subscription_created', 2229952), store)
    expect(await handleWebhook(paymentEvent('inv-1', 'initial'), store)).toMatchObject({
      status: 'ignored',
    })
    expect(await handleWebhook(paymentEvent('inv-2', 'renewal'), store)).toEqual({
      status: 'credited',
      userId: USER,
      minutes: 120,
    })
    expect(await handleWebhook(paymentEvent('inv-2', 'renewal'), store)).toEqual({
      status: 'duplicate',
    })
    expect(accounts.get(USER)?.prepaid).toBe(120)
  })

  it('asks Lemon Squeezy to retry a renewal for a subscription it has not linked yet', async () => {
    const { store } = fakeStore()
    expect(await handleWebhook(paymentEvent('inv-9', 'renewal', 999), store)).toMatchObject({
      status: 'retry',
    })
  })

  it('links but does not credit subscription_updated or inactive subscriptions', async () => {
    const { store, accounts } = fakeStore()
    expect(await handleWebhook(subscriptionEvent('subscription_updated', 2229957), store)).toEqual({
      status: 'linked',
      userId: USER,
    })
    expect(
      await handleWebhook(subscriptionEvent('subscription_created', 2229957, 'past_due'), store),
    ).toEqual({
      status: 'linked',
      userId: USER,
    })
    expect(accounts.get(USER)?.prepaid).toBe(0)
  })

  it('ignores unknown variants and unrelated events', async () => {
    const { store } = fakeStore()
    expect(
      await handleWebhook(subscriptionEvent('subscription_created', 1425507), store),
    ).toMatchObject({
      status: 'ignored',
    })
    const order = parseWebhook(
      JSON.stringify({ meta: { event_name: 'order_created' }, data: { id: '1', attributes: {} } }),
    )
    expect(await handleWebhook(order, store)).toMatchObject({ status: 'ignored' })
  })

  it('rejects a non-uuid user id in custom data', () => {
    expect(() =>
      parseWebhook(
        JSON.stringify({
          meta: { event_name: 'subscription_created', custom_data: { user_id: "1' or 1=1" } },
          data: { id: '1', attributes: {} },
        }),
      ),
    ).toThrow()
  })
})
