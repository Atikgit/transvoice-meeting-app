import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSessionUser = vi.fn()
const checkRateLimit = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ getSessionUser }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit }))

let participants: { user_id: string }[] = []
let account: Record<string, unknown> | null = null
const tables: string[] = []
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      tables.push(table)
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        limit: async () => ({ data: participants, error: null }),
        maybeSingle: async () => ({ data: account, error: null }),
      }
      return chain
    },
  }),
}))
const { GET } = await import('@/app/api/billing/balance/route')

const SESSION = '55555555-5555-4555-8555-555555555555'
const get = (query = '') =>
  GET(new NextRequest(`https://meet.transvoice.ai/api/billing/balance${query}`))

const free = (trial: number, prepaid = 0) => ({
  billing_type: prepaid > 0 ? 'prepaid' : 'free',
  plan: prepaid > 0 ? 'bronze' : 'trial',
  trial_minutes_remaining: trial,
  prepaid_minutes_remaining: prepaid,
  postpaid_minutes_accrued: 0,
  postpaid_credit_limit_minutes: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  tables.length = 0
  getSessionUser.mockResolvedValue({ id: 'user-1', email: 'secret@example.com' })
  checkRateLimit.mockResolvedValue(true)
  participants = [{ user_id: 'someone' }]
  account = free(15)
})

describe('GET /api/billing/balance', () => {
  it("without a session: the caller's own numbers (15 trial, 0 subscription, not low)", async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({
      trialMinutes: 15,
      subscriptionMinutes: 0,
      plan: 'trial',
      billingType: 'free',
      low: false,
    })
    expect(tables).toEqual(['billing_accounts']) // no session lookup needed
  })

  it('low is true at 5 minutes and below, false at 6', async () => {
    account = free(3, 2)
    expect(await (await get()).json()).toMatchObject({
      trialMinutes: 3,
      subscriptionMinutes: 2,
      low: true,
    })
    account = free(6)
    expect(await (await get()).json()).toMatchObject({ low: false })
  })

  it('postpaid: reports accrued minutes, low relative to the credit limit', async () => {
    account = {
      ...free(0),
      billing_type: 'postpaid',
      plan: 'usage',
      postpaid_minutes_accrued: 97,
      postpaid_credit_limit_minutes: 100,
    }
    expect(await (await get()).json()).toMatchObject({
      billingType: 'postpaid',
      postpaidAccrued: 97,
      low: true,
    })
  })

  it('in a session where the caller pays for someone: numbers and payer: true', async () => {
    const body = await (await get(`?sessionId=${SESSION}`)).json()
    expect(body).toMatchObject({ payer: true, trialMinutes: 15 })
  })

  it('in a session where the caller pays for nobody (a sponsored guest): { payer: false } and no balance', async () => {
    participants = []
    const res = await get(`?sessionId=${SESSION}`)
    expect(await res.json()).toEqual({ payer: false })
    expect(tables).toEqual(['meeting_participants']) // the account was never even read
  })

  it('401 without a session, 400 for a bad session id, 429 when rate limited, 404 without an account', async () => {
    getSessionUser.mockResolvedValueOnce(null)
    expect((await get()).status).toBe(401)
    expect((await get('?sessionId=nope')).status).toBe(400)
    checkRateLimit.mockResolvedValueOnce(false)
    expect((await get()).status).toBe(429)
    account = null
    expect((await get()).status).toBe(404)
  })
})
