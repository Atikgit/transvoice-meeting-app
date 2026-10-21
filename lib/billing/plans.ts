export interface Plan {
  name: string
  price: string
  minutes: string
  desc: string
  checkoutUrl: string
}

/**
 * Lemon Squeezy checkout links. Phase 5 adds the variant_id → minutes map used by the webhook
 * (replacing the current product-name substring matching).
 */
export const LEMON_SQUEEZY_PLANS: Plan[] = [
  {
    name: 'Bronze Starter',
    price: '$4.44/mo',
    minutes: '120 translation mins',
    desc: '2 hours of live talk voice translation',
    checkoutUrl:
      'https://transvoice-ai.lemonsqueezy.com/checkout/buy/b5d2ad29-f28a-4720-8fe8-b4c793dabbc7',
  },
  {
    name: 'Diamond Pro',
    price: '$8.88/mo',
    minutes: '300 translation mins',
    desc: '5 hours of live talk voice translation',
    checkoutUrl:
      'https://transvoice-ai.lemonsqueezy.com/checkout/buy/012d90b8-34df-4427-a644-10fe30af1068',
  },
  {
    name: 'Business Standard',
    price: '$17.77/mo',
    minutes: '600 translation mins',
    desc: '10 hours of live talk voice translation',
    checkoutUrl:
      'https://transvoice-ai.lemonsqueezy.com/checkout/buy/20bf599a-9c7e-419b-82ad-0d7e710adb86',
  },
]
