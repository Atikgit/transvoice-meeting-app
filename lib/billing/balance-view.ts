/** What GET /api/billing/balance answers and the room / dashboard show. */
export interface BalanceView {
  /** Free trial minutes (never expire). */
  trialMinutes: number
  /** Subscription minutes (reset at renewal). */
  subscriptionMinutes: number
  plan: string
  billingType: 'free' | 'prepaid' | 'postpaid'
  /** At most 5 minutes left (or 5 below the postpaid credit limit). */
  low: boolean
  /** Postpaid only: minutes accrued this period. */
  postpaidAccrued?: number
  /** With a sessionId: the caller pays for someone in that session. Absent without one. */
  payer?: boolean
}

/** A non-payer in a session gets this and nothing else: guests never see balance numbers. */
export interface NotPayerView {
  payer: false
}

export const LOW_MINUTES = 5

export function toBalanceView(account: {
  billing_type: string
  plan: string
  trial_minutes_remaining: number | string
  prepaid_minutes_remaining: number | string
  postpaid_minutes_accrued: number | string
  postpaid_credit_limit_minutes: number | string | null
}): BalanceView {
  const trial = Number(account.trial_minutes_remaining)
  const subscription = Number(account.prepaid_minutes_remaining)
  const postpaid = account.billing_type === 'postpaid'
  const accrued = Number(account.postpaid_minutes_accrued)
  const limit =
    account.postpaid_credit_limit_minutes === null
      ? null
      : Number(account.postpaid_credit_limit_minutes)
  const left = postpaid ? (limit === null ? Infinity : limit - accrued) : trial + subscription
  return {
    trialMinutes: trial,
    subscriptionMinutes: subscription,
    plan: account.plan,
    billingType: account.billing_type as BalanceView['billingType'],
    low: left <= LOW_MINUTES,
    ...(postpaid ? { postpaidAccrued: accrued } : {}),
  }
}

/** Minutes the payer can still use; null for postpaid (no countdown, usage is shown instead). */
export function minutesLeft(view: BalanceView): number | null {
  return view.billingType === 'postpaid' ? null : view.trialMinutes + view.subscriptionMinutes
}

/** "12 min left" for the in-room meter; postpaid shows usage instead. */
export function meterLabel(view: BalanceView): string {
  const left = minutesLeft(view)
  if (left === null) return `${Math.round(view.postpaidAccrued ?? 0)} min used`
  // Whole minutes, rounded down; "<1" while some time remains so 0 only ever means empty.
  return `${left > 0 && left < 1 ? '<1' : Math.floor(left)} min left`
}
