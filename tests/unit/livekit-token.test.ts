import { NextRequest } from 'next/server'
import { TokenVerifier } from 'livekit-server-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_ENV } from '../mocks/env'

const rpc = vi.fn()
const getSessionUser = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }))
vi.mock('@/lib/supabase/server', () => ({ getSessionUser }))

const { GET } = await import('@/app/api/livekit/token/route')
const { sessionIdFromRoom } = await import('@/lib/livekit/server')

const SESSION = '22222222-2222-4222-8222-222222222222'
const call = (query = `sessionId=${SESSION}`) =>
  GET(new NextRequest(`https://meet.transvoice.ai/api/livekit/token?${query}`))

const admitted = (role: 'host' | 'guest') => ({
  data: [
    {
      meeting_id: 'm1',
      role,
      payer_id: 'host-1',
      spoken_lang: 'bn-BD',
      listen_lang: 'en-US',
      display_name: role === 'host' ? 'Host Person' : 'Guest Person',
      status: 'ready',
    },
  ],
  error: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  getSessionUser.mockResolvedValue({ id: 'user-1', email: 'u@example.com' })
})

describe('GET /api/livekit/token — allowed', () => {
  it.each(['host', 'guest'] as const)('%s gets a 2 h token for that room only', async (role) => {
    rpc.mockResolvedValue(admitted(role))
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body).toMatchObject({
      room: `tv-${SESSION}`,
      role,
      url: TEST_ENV.NEXT_PUBLIC_LIVEKIT_URL,
    })
    expect(rpc).toHaveBeenCalledWith('admit_participant', { p_session: SESSION, p_user: 'user-1' })

    const claims = await new TokenVerifier(
      TEST_ENV.LIVEKIT_API_KEY,
      TEST_ENV.LIVEKIT_API_SECRET,
    ).verify(body.token)
    expect(claims.sub).toBe('user-1')
    expect(claims.exp! - claims.nbf!).toBe(2 * 60 * 60)
    expect(claims.video).toMatchObject({
      room: `tv-${SESSION}`,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canUpdateOwnMetadata: false,
    })
    expect(claims.video?.roomAdmin).toBeFalsy()
    expect(claims.video?.canPublishSources).toEqual(
      expect.arrayContaining(['microphone', 'camera', 'screen_share'].map(String)),
    )
    expect(JSON.parse(claims.metadata!)).toEqual({
      name: role === 'host' ? 'Host Person' : 'Guest Person',
      spokenLang: 'bn-BD',
      listenLang: 'en-US',
      role,
    })
  })
})

describe('GET /api/livekit/token — denied', () => {
  it('401 when signed out (no database call)', async () => {
    getSessionUser.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('400 without a valid sessionId', async () => {
    expect((await call('sessionId=abc')).status).toBe(400)
    expect((await call('')).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['NOT_ALLOWED', 403], // not invited to this meeting
    ['NO_MINUTES', 402], // expired sponsorship and no own minutes
    ['SESSION_CLOSED', 409],
    ['NO_SESSION', 404],
  ])('%s → %i, no token', async (code, status) => {
    rpc.mockResolvedValue({ data: null, error: { message: code } })
    const res = await call()
    expect(res.status).toBe(status)
    const body = await res.json()
    expect(body.code).toBe(code)
    expect(body.token).toBeUndefined()
  })

  it('500 on unexpected database errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } })
    expect((await call()).status).toBe(500)
  })
})

describe('room names', () => {
  it('map to session ids and reject anything else', () => {
    expect(sessionIdFromRoom(`tv-${SESSION}`)).toBe(SESSION)
    expect(sessionIdFromRoom('quick-sync')).toBeNull()
    expect(sessionIdFromRoom(`tv-${SESSION}-x`)).toBeNull()
  })
})
