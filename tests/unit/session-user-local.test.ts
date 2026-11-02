import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))

const auth = {
  getClaims: vi.fn(),
  getUser: vi.fn(),
}
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth }) }))

const { getSessionUser } = await import('@/lib/supabase/server')

beforeEach(() => {
  vi.clearAllMocks()
  auth.getUser.mockResolvedValue({ data: { user: { id: 'u-full', email: 'a@example.com' } } })
})

describe('getSessionUser({ local: true }) - JWT verified without a round trip', () => {
  it('reads id and email from the verified claims; Supabase Auth is not called', async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: { sub: 'u-1', email: 'a@example.com' } } })
    expect(await getSessionUser({ local: true })).toEqual({ id: 'u-1', email: 'a@example.com' })
    expect(auth.getClaims).toHaveBeenCalledTimes(1)
    expect(auth.getUser).not.toHaveBeenCalled() // before: 1 network call per utterance, after: 0
  })

  it('no session or an invalid token: null', async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: new Error('invalid') })
    expect(await getSessionUser({ local: true })).toBeNull()
    auth.getClaims.mockResolvedValue({ data: { claims: {} } })
    expect(await getSessionUser({ local: true })).toBeNull()
  })

  it('the default form still asks the Auth server (revocation-safe) for the full user', async () => {
    expect(await getSessionUser()).toMatchObject({ id: 'u-full' })
    expect(auth.getUser).toHaveBeenCalledTimes(1)
    expect(auth.getClaims).not.toHaveBeenCalled()
  })
})
