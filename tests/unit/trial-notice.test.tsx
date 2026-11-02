// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
}))
vi.mock('@/app/m/actions', () => ({ createMeeting: vi.fn() }))

const { trialNotice, TRIAL_NOTICES } = await import('@/lib/auth/account')
const { DashboardHome } = await import('@/components/dashboard/dashboard-home')

const answers = (...statuses: string[]) => {
  const queue = [...statuses]
  rpc.mockImplementation(async (fn: string) =>
    fn === 'trial_status'
      ? { data: queue.shift() ?? statuses.at(-1), error: null }
      : { data: true, error: null },
  )
}

beforeEach(() => {
  rpc.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(cleanup)

describe('why an account has no free minutes', () => {
  it('unconfirmed email -> "Confirm your email to get 15 free minutes."', async () => {
    answers('unconfirmed')
    expect(await trialNotice('u')).toBe('Confirm your email to get 15 free minutes.')
  })

  it('the address already had its trial -> "A free trial was already used for this address."', async () => {
    answers('already_used')
    expect(await trialNotice('u')).toBe('A free trial was already used for this address.')
  })

  it('an account that has the trial gets no notice', async () => {
    answers('granted')
    expect(await trialNotice('u')).toBeNull()
  })

  it('verified but never granted: ensure_user_account (the designed path) runs once, then it asks again', async () => {
    answers('pending', 'granted')
    expect(await trialNotice('u')).toBeNull()
    const fns = rpc.mock.calls.map((c) => c[0])
    expect(fns).toEqual(['trial_status', 'ensure_user_account', 'trial_status'])
  })

  it('never grants minutes itself: only trial_status and ensure_user_account are called', async () => {
    answers('already_used')
    await trialNotice('u')
    expect(
      rpc.mock.calls.every((c) => ['trial_status', 'ensure_user_account'].includes(c[0])),
    ).toBe(true)
  })

  it('the database function is not deployed yet (or fails): no notice, no crash', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'function not found' } })
    expect(await trialNotice('u')).toBeNull()
    rpc.mockRejectedValue(new Error('network'))
    expect(await trialNotice('u')).toBeNull()
  })

  it('shows the sentence on the dashboard', () => {
    render(
      <DashboardHome
        userId="u"
        greeting="Hi"
        balance={0}
        canSpend={false}
        trialNotice={TRIAL_NOTICES.unconfirmed}
      />,
    )
    expect(screen.getByTestId('trial-notice')).toHaveTextContent(
      'Confirm your email to get 15 free minutes.',
    )
  })

  it('shows nothing when there is no notice', () => {
    render(<DashboardHome userId="u" greeting="Hi" balance={15} canSpend />)
    expect(screen.queryByTestId('trial-notice')).toBeNull()
  })
})
