// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NON_PAYER_POLL_MS, PAYER_POLL_MS, useBalance } from '@/features/billing/useBalance'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
}))
vi.mock('@/app/m/actions', () => ({ createMeeting: vi.fn() }))
// The connections card opens a realtime channel; not what this file is about.
vi.mock('@/features/calls/useUserChannel', () => ({
  useUserChannel: vi.fn(),
  secondsUntil: () => 0,
}))

const fetchMock = vi.fn()
const answer = (body: unknown) =>
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body)))
const view = (trial: number) => ({
  trialMinutes: trial,
  subscriptionMinutes: 0,
  plan: 'trial',
  billingType: 'free',
  low: trial <= 5,
})

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useBalance', () => {
  it('a payer is polled every 20 s: 1 + 3 requests in 60 s, numbers update', async () => {
    answer({ ...view(15), payer: true })
    const { result } = renderHook(() => useBalance({ sessionId: 's-1' }))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.payer).toBe(true)
    expect(result.current.view?.trialMinutes).toBe(15)
    answer({ ...view(14), payer: true })
    await act(() => vi.advanceTimersByTimeAsync(3 * PAYER_POLL_MS))
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(result.current.view?.trialMinutes).toBe(14)
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/billing/balance?sessionId=s-1')
  })

  it('a guest who pays for nobody holds no numbers and polls every 60 s, not 20 s', async () => {
    answer({ payer: false })
    const { result } = renderHook(() => useBalance({ sessionId: 's-1' }))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current).toMatchObject({ payer: false, view: null })
    await act(() => vi.advanceTimersByTimeAsync(NON_PAYER_POLL_MS - 1))
    expect(fetchMock).toHaveBeenCalledTimes(1) // nothing at 20 s or 40 s
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the last value when a poll fails, and does nothing while disabled', async () => {
    answer({ ...view(9), payer: true })
    const { result, rerender } = renderHook(
      ({ on }) => useBalance({ sessionId: 's', enabled: on }),
      {
        initialProps: { on: false },
      },
    )
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(fetchMock).not.toHaveBeenCalled()
    rerender({ on: true })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.view?.trialMinutes).toBe(9)
    fetchMock.mockRejectedValue(new Error('offline'))
    await act(() => vi.advanceTimersByTimeAsync(PAYER_POLL_MS))
    expect(result.current.view?.trialMinutes).toBe(9)
  })
})

describe('dashboard balance refresh', () => {
  it('shows the page-load number first (15), then the polled one (12) after the 30 s refresh', async () => {
    const { DashboardHome } = await import('@/components/dashboard/dashboard-home')
    answer(view(15))
    render(<DashboardHome userId="u" greeting="Hi" balance={15} canSpend />)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getAllByText('15').length).toBeGreaterThan(0)
    answer(view(12))
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(screen.getAllByText('12').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('15')).toHaveLength(0)
  })
})
