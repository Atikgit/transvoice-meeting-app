import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const verifyOtp = vi.fn()
const afterSignIn = vi.fn()

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { verifyOtp } }) }))
vi.mock('@/lib/auth/account', () => ({ afterSignIn }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'meet.transvoice.ai', 'x-forwarded-proto': 'https' }),
}))

const { GET } = await import('@/app/auth/confirm/route')

function confirm(query: string, cookie?: string) {
  return GET(
    new NextRequest(`https://meet.transvoice.ai/auth/confirm?${query}`, {
      headers: cookie ? { cookie } : {},
    }),
  )
}

const location = (res: Response) => res.headers.get('location')

beforeEach(() => {
  vi.clearAllMocks()
  verifyOtp.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
})

describe('/auth/confirm', () => {
  it.each(['signup', 'email'])('%s: creates the account, then goes to next', async (type) => {
    const res = await confirm(`token_hash=t&type=${type}&next=/dashboard/settings`)
    expect(verifyOtp).toHaveBeenCalledWith({ type, token_hash: 't' })
    expect(afterSignIn).toHaveBeenCalledWith('u1', expect.any(Headers))
    expect(location(res)).toBe('https://meet.transvoice.ai/dashboard/settings')
  })

  it('defaults to /dashboard and never redirects off-site', async () => {
    expect(location(await confirm('token_hash=t&type=email'))).toBe(
      'https://meet.transvoice.ai/dashboard',
    )
    expect(location(await confirm('token_hash=t&type=email&next=//evil.example'))).toBe(
      'https://meet.transvoice.ai/dashboard',
    )
  })

  it('uses the destination remembered at signup (invite links) and clears it', async () => {
    const res = await confirm(
      'token_hash=t&type=email&next=/dashboard',
      'tv_pending_next=/invite/abc',
    )
    expect(location(res)).toBe('https://meet.transvoice.ai/invite/abc')
    expect(res.headers.get('set-cookie')).toMatch(/tv_pending_next=;/)
  })

  it.each(['recovery', 'invite'])('%s: goes to /auth/reset whatever next says', async (type) => {
    const res = await confirm(`token_hash=t&type=${type}&next=/dashboard`)
    expect(location(res)).toBe('https://meet.transvoice.ai/auth/reset')
  })

  it('email_change: follows next', async () => {
    const res = await confirm('token_hash=t&type=email_change&next=/dashboard/settings')
    expect(location(res)).toBe('https://meet.transvoice.ai/dashboard/settings')
  })

  it('rejects unknown types without calling Supabase', async () => {
    const res = await confirm('token_hash=t&type=magiclink')
    expect(verifyOtp).not.toHaveBeenCalled()
    expect(location(res)).toMatch(/\/login\?error=/)
  })
})
