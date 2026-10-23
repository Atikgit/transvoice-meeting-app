import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = {
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  resend: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
}
let ip = '203.0.113.1'

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth }) }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': ip, host: 'meet.transvoice.ai' }),
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`)
  },
}))

const { requestPasswordReset, resendConfirmation, signIn, updatePassword } =
  await import('@/app/(auth)/actions')
const { MemoryRateLimiter } = await import('@/lib/rate-limit')

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

let counter = 0
/** Fresh IP and address per test: the limiter state is module-wide. */
function fresh() {
  counter += 1
  ip = `203.0.113.${counter}`
  return `user${counter}@example.com`
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.APP_URL = 'https://meet.transvoice.ai'
})

describe('requestPasswordReset', () => {
  it('sends the reset email with the production redirect URL', async () => {
    const email = fresh()
    auth.resetPasswordForEmail.mockResolvedValue({ error: null })
    await requestPasswordReset({}, form({ email }))
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(email, {
      redirectTo: 'https://meet.transvoice.ai/auth/reset',
    })
  })

  it('answers the same whether or not the account exists', async () => {
    auth.resetPasswordForEmail.mockResolvedValueOnce({ error: null })
    const known = await requestPasswordReset({}, form({ email: fresh() }))
    auth.resetPasswordForEmail.mockResolvedValueOnce({
      error: { code: 'user_not_found', message: 'User not found' },
    })
    const unknown = await requestPasswordReset({}, form({ email: fresh() }))
    expect(unknown).toEqual(known)
    expect(known.notice).toMatch(/If an account exists/)
  })

  it('allows 5 requests per hour per IP', async () => {
    fresh()
    auth.resetPasswordForEmail.mockResolvedValue({ error: null })
    for (let i = 0; i < 5; i++) {
      const state = await requestPasswordReset({}, form({ email: `ip-limit-${i}@example.com` }))
      expect(state.notice).toBeDefined()
    }
    const blocked = await requestPasswordReset({}, form({ email: 'ip-limit-5@example.com' }))
    expect(blocked.error).toMatch(/Too many attempts/)
    expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(5)
  })

  it('allows 5 requests per hour per email, from any IP', async () => {
    const email = fresh()
    auth.resetPasswordForEmail.mockResolvedValue({ error: null })
    for (let i = 0; i < 5; i++) {
      ip = `198.51.100.${counter * 10 + i}`
      await requestPasswordReset({}, form({ email }))
    }
    ip = '198.51.100.250'
    const blocked = await requestPasswordReset({}, form({ email: email.toUpperCase() }))
    expect(blocked.error).toMatch(/Too many attempts/)
  })

  it('rejects an invalid email without calling Supabase', async () => {
    fresh()
    const state = await requestPasswordReset({}, form({ email: 'nope' }))
    expect(state.error).toBe('Enter a valid email address.')
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })
})

describe('updatePassword', () => {
  beforeEach(() => auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } }))

  it('requires at least 8 characters', async () => {
    const state = await updatePassword({}, form({ password: 'short', confirm: 'short' }))
    expect(state.error).toBe('Password must be at least 8 characters.')
  })

  it('requires both fields to match', async () => {
    const state = await updatePassword({}, form({ password: 'longenough1', confirm: 'other123' }))
    expect(state.error).toBe('The passwords do not match.')
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('updates the password and redirects to /dashboard', async () => {
    auth.updateUser.mockResolvedValue({ error: null })
    await expect(
      updatePassword({}, form({ password: 'longenough1', confirm: 'longenough1' })),
    ).rejects.toThrow('NEXT_REDIRECT /dashboard')
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'longenough1' })
  })

  it('fails without a recovery session', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } })
    const state = await updatePassword(
      {},
      form({ password: 'longenough1', confirm: 'longenough1' }),
    )
    expect(state.error).toMatch(/expired/)
  })
})

describe('signIn errors', () => {
  it('distinguishes an unconfirmed email from wrong credentials', async () => {
    const email = fresh()
    auth.signInWithPassword.mockResolvedValueOnce({
      error: { code: 'email_not_confirmed', message: 'Email not confirmed' },
    })
    const unconfirmed = await signIn({}, form({ email, password: 'x' }))
    expect(unconfirmed).toMatchObject({ unconfirmed: true, email })
    expect(unconfirmed.error).toMatch(/not confirmed/)

    auth.signInWithPassword.mockResolvedValueOnce({
      error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    })
    const wrong = await signIn({}, form({ email, password: 'x' }))
    expect(wrong).toEqual({ error: 'Email or password is incorrect.', email })
  })
})

describe('resendConfirmation', () => {
  it('resends the signup email with a neutral answer', async () => {
    const email = fresh()
    auth.resend.mockResolvedValue({ error: null })
    const state = await resendConfirmation({}, form({ email, next: '/dashboard' }))
    expect(auth.resend).toHaveBeenCalledWith({
      type: 'signup',
      email,
      options: { emailRedirectTo: 'https://meet.transvoice.ai/auth/callback?next=%2Fdashboard' },
    })
    expect(state.notice).toMatch(/If that email is waiting/)
  })
})

describe('MemoryRateLimiter', () => {
  it('uses a sliding window', async () => {
    let now = 0
    const limiter = new MemoryRateLimiter(2, 1000, () => now)
    expect((await limiter.limit('k')).success).toBe(true)
    expect((await limiter.limit('k')).success).toBe(true)
    expect((await limiter.limit('k')).success).toBe(false)
    expect((await limiter.limit('other')).success).toBe(true)
    now = 1000
    expect((await limiter.limit('k')).success).toBe(true)
  })
})
