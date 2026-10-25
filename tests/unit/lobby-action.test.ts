import { beforeEach, describe, expect, it, vi } from 'vitest'

const MEETING = '11111111-1111-4111-8111-111111111111'
const SESSION = '22222222-2222-4222-8222-222222222222'

const profileUpdate = vi.fn(async () => ({ error: null }))
const rpc = vi.fn()
let openSession: { id: string } | null = { id: SESSION }
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`)
  },
}))
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: async () => ({ id: 'u1' }),
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({ update: () => ({ eq: profileUpdate }) }),
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ in: () => ({ maybeSingle: async () => ({ data: openSession }) }) }),
      }),
    }),
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => true }))

const { joinFromLobby } = await import('@/app/m/actions')

const form = () => {
  const data = new FormData()
  for (const [k, v] of Object.entries({
    meetingId: MEETING,
    full_name: 'Atik',
    spoken_lang: 'bn-BD',
    listen_lang: 'en-US',
    camera: 'on',
    mic: 'on',
  }))
    data.set(k, v)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  openSession = { id: SESSION }
  rpc.mockResolvedValue({ data: [], error: null })
})

describe('joinFromLobby', () => {
  it('copies the chosen languages into the user’s row of the open session, then enters the room', async () => {
    await expect(joinFromLobby({}, form())).rejects.toThrow(`NEXT_REDIRECT /m/${MEETING}?`)
    expect(rpc).toHaveBeenCalledWith('set_participant_langs', {
      p_session: SESSION,
      p_user: 'u1',
      p_spoken: 'bn-BD',
      p_listen: 'en-US',
    })
  })

  it('a first visit (no row yet) is fine; the token creates the row from the profile', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'NOT_A_PARTICIPANT' } })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(joinFromLobby({}, form())).rejects.toThrow('NEXT_REDIRECT')
    expect(error).not.toHaveBeenCalled()
  })

  it('without an open session there is nothing to sync', async () => {
    openSession = null
    await expect(joinFromLobby({}, form())).rejects.toThrow('NEXT_REDIRECT')
    expect(rpc).not.toHaveBeenCalled()
  })
})
