export type PlanId = 'bronze' | 'diamond' | 'business'

export interface Plan {
  id: PlanId
  name: string
  /** Lemon Squeezy variant id, as sent in webhook payloads. */
  variantId: number
  /** Minutes the prepaid bucket is reset to at the start of every billing period (no rollover). */
  minutesPerPeriod: number
  price: string
  minutes: string
  desc: string
  checkoutUrl: string
}

/**
 * Prepaid subscriptions. Variant ids were matched to the checkout links via the Lemon Squeezy API
 * (product buy_now_url → variant) on 2026-10-22.
 */
export const LEMON_SQUEEZY_PLANS: Plan[] = [
  {
    id: 'bronze',
    name: 'Bronze Starter',
    variantId: 2229952,
    minutesPerPeriod: 120,
    price: '$4.44/mo',
    minutes: '120 translation mins',
    desc: '2 hours of live talk voice translation',
    checkoutUrl:
      'https://transvoice-ai.lemonsqueezy.com/checkout/buy/b5d2ad29-f28a-4720-8fe8-b4c793dabbc7',
  },
  {
    id: 'diamond',
    name: 'Diamond Pro',
    variantId: 2229957,
    minutesPerPeriod: 300,
    price: '$8.88/mo',
    minutes: '300 translation mins',
    desc: '5 hours of live talk voice translation',
    checkoutUrl:
      'https://transvoice-ai.lemonsqueezy.com/checkout/buy/012d90b8-34df-4427-a644-10fe30af1068',
  },
  {
    id: 'business',
    name: 'Business Standard',
    variantId: 2229969,
    minutesPerPeriod: 600,
    price: '$17.77/mo',
    minutes: '600 translation mins',
    desc: '10 hours of live talk voice translation',
    checkoutUrl:
      'https://transvoice-ai.lemonsqueezy.com/checkout/buy/20bf599a-9c7e-419b-82ad-0d7e710adb86',
  },
]

export function planByVariantId(variantId: number): Plan | undefined {
  return LEMON_SQUEEZY_PLANS.find((plan) => plan.variantId === variantId)
}
