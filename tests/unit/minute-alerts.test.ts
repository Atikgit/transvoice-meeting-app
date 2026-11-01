// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { alertText, nextAlert, NO_ALERTS, type AlertState } from '@/features/billing/minute-alerts'
import { useMinuteAlerts } from '@/features/billing/useMinuteAlerts'
import { meterLabel, minutesLeft, toBalanceView } from '@/lib/billing/balance-view'

/** Feeds a series of balances through nextAlert and returns what fired for each. */
function run(series: (number | null)[]) {
  let state: AlertState = NO_ALERTS
  return series.map((left) => {
    const result = nextAlert(left, state)
    state = result.state
    return result.alert
  })
}

describe('nextAlert', () => {
  it('fires once at 5, once at 1 and then the zero message: 12, 6, 5, 4, 3, 1, 0.5, 0', () => {
    expect(run([12, 6, 5, 4, 3, 1, 0.5, 0])).toEqual([
      null,
      null,
      'five',
      null,
      null,
      'one',
      null,
      'zero',
    ])
  })

  it('a top-up above the thresholds re-arms them: 4 → 20 → 5 fires again', () => {
    expect(run([4, 20, 5])).toEqual(['five', null, 'five'])
  })

  it('jumping straight below 1 shows only the 1-minute warning, not both', () => {
    expect(run([10, 0.8])).toEqual([null, 'one'])
  })

  it('no countdown (postpaid) never alerts', () => {
    expect(run([null, null])).toEqual([null, null])
  })

  it('texts: 5 minutes, 1 minute, out of minutes', () => {
    expect(alertText('five', 4.2)).toBe('5 minutes left.')
    expect(alertText('one', 0.7)).toBe('1 minute left.')
    expect(alertText('zero', 0)).toMatch(/out of minutes.*call and chat continue/)
  })
})

describe('meter label', () => {
  const view = (trial: number, prepaid = 0) =>
    toBalanceView({
      billing_type: prepaid > 0 ? 'prepaid' : 'free',
      plan: 'x',
      trial_minutes_remaining: trial,
      prepaid_minutes_remaining: prepaid,
      postpaid_minutes_accrued: 0,
      postpaid_credit_limit_minutes: null,
    })

  it('"12 min left" from trial + subscription, rounded down; "<1" while some remain; "0" when empty', () => {
    expect(meterLabel(view(10, 2.9))).toBe('12 min left')
    expect(meterLabel(view(0.4))).toBe('<1 min left')
    expect(meterLabel(view(0))).toBe('0 min left')
    expect(minutesLeft(view(10, 2))).toBe(12)
  })
})

describe('useMinuteAlerts', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows the 5-minute toast, dismisses it after 10 s, and shows the standing message at 0', () => {
    const { result, rerender } = renderHook(({ left }) => useMinuteAlerts(left), {
      initialProps: { left: 8 as number | null | undefined },
    })
    expect(result.current).toEqual({ toast: null, empty: false })
    rerender({ left: 5 })
    expect(result.current.toast).toBe('five')
    act(() => void vi.advanceTimersByTime(10_000))
    expect(result.current.toast).toBeNull()
    rerender({ left: 0 })
    expect(result.current.empty).toBe(true)
    rerender({ left: 30 })
    expect(result.current).toEqual({ toast: null, empty: false })
  })

  it('a non-payer (undefined) never gets a toast or the empty message', () => {
    const { result, rerender } = renderHook(({ left }) => useMinuteAlerts(left), {
      initialProps: { left: undefined as number | null | undefined },
    })
    rerender({ left: undefined })
    expect(result.current).toEqual({ toast: null, empty: false })
  })
})
