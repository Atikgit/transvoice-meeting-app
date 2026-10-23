import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const verifyOtp = vi.fn()
const getUser = vi.fn()
const exchangeCodeForSession = vi.fn()
const afterSignIn = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { verifyOtp, getUser, exchangeCodeForSession } }),
}))
vi.mock('@/lib/auth/account', () => ({ afterSignIn }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'meet.transvoice.ai', 'x-forwarded-proto': 'https' }),
}))

const { GET } = await import('@/app/auth/confirm/route')
const { GET: callback } = await import('@/app/auth/callback/route')
const { classifyLinkError } = await import('@/lib/auth/link-errors')

function confirm(query: string, cookie?: string) {
  return GET(
    new NextRequest(`https://meet.transvoice.ai/auth/confirm?${query}`, {
      headers: cookie ? { cookie } : {},
    }),
  )
}

const location = (res: Response) => res.headers.get('location')

const authError = (code: string) => ({
  data: { user: null, session: null },
  error: { code, status: 403, message: `Supabase says ${code}` },
})

let logged: unknown[][] = []
beforeEach(() => {
  vi.clearAllMocks()
  verifyOtp.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  getUser.mockResolvedValue({ data: { user: null } })
  logged = []
  vi.spyOn(console, 'error').mockImplementation((...args) => void logged.push(args))
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

describe('/auth/confirm failures', () => {
  it('expired link: logs the real error (not the token) and offers a resend', async () => {
    verifyOtp.mockResolvedValue(authError('otp_expired'))
    const res = await confirm('token_hash=secret-token&type=email')
    expect(location(res)).toBe('https://meet.transvoice.ai/login?error=link_expired')
    expect(JSON.stringify(logged)).toContain('otp_expired')
    expect(JSON.stringify(logged)).not.toContain('secret-token')
    expect(afterSignIn).not.toHaveBeenCalled()
  })

  it('link opened again in a signed-in, confirmed browser: continues to next', async () => {
    verifyOtp.mockResolvedValue(authError('otp_expired'))
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email_confirmed_at: '2026-10-22' } } })
    const res = await confirm('token_hash=t&type=email&next=/dashboard/settings')
    expect(location(res)).toBe('https://meet.transvoice.ai/dashboard/settings')
  })

  it('expired reset link: back to /forgot-password', async () => {
    verifyOtp.mockResolvedValue(authError('otp_expired'))
    const res = await confirm('token_hash=t&type=recovery')
    expect(location(res)).toBe('https://meet.transvoice.ai/forgot-password?error=link')
  })

  it('other errors: generic confirm message', async () => {
    verifyOtp.mockResolvedValue(authError('unexpected_failure'))
    const res = await confirm('token_hash=t&type=email')
    expect(location(res)).toBe('https://meet.transvoice.ai/login?error=confirm')
  })
})

describe('/auth/callback failures', () => {
  const call = (query: string) =>
    callback(new NextRequest(`https://meet.transvoice.ai/auth/callback?${query}`))

  it('email link already used → "already confirmed, sign in"', async () => {
    exchangeCodeForSession.mockResolvedValue(authError('flow_state_not_found'))
    const res = await call('code=c&next=/dashboard&flow=email')
    expect(location(res)).toMatch(/\/login\?error=already_confirmed&next=%2Fdashboard$/)
    expect(JSON.stringify(logged)).toContain('flow_state_not_found')
  })

  it('expired email link reported by Supabase in the query → resend', async () => {
    const res = await call(
      'error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid&flow=email',
    )
    expect(location(res)).toMatch(/error=link_expired/)
    expect(exchangeCodeForSession).not.toHaveBeenCalled()
    expect(JSON.stringify(logged)).toContain('Email link is invalid')
  })

  it('OAuth failures keep the generic message', async () => {
    exchangeCodeForSession.mockResolvedValue(authError('flow_state_not_found'))
    const res = await call('code=c&next=/dashboard')
    expect(location(res)).toMatch(/error=callback/)
  })

  it('success runs afterSignIn and follows next', async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'u2' } }, error: null })
    const res = await call('code=c&next=/dashboard/settings')
    expect(afterSignIn).toHaveBeenCalledWith('u2', expect.any(Headers))
    expect(location(res)).toBe('https://meet.transvoice.ai/dashboard/settings')
  })
})

describe('classifyLinkError', () => {
  it.each([
    ['otp_expired', 'expired'],
    ['flow_state_expired', 'expired'],
    ['flow_state_not_found', 'used'],
    ['bad_code_verifier', 'invalid'],
    [null, 'invalid'],
  ])('%s → %s', (code, failure) => expect(classifyLinkError(code)).toBe(failure))
})
