import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const getSessionUser = vi.fn()
const updateRoomMetadata = vi.fn()
const createRoom = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }))
vi.mock('@/lib/supabase/server', () => ({ getSessionUser }))
vi.mock('livekit-server-sdk', async (original) => ({
  ...(await original<typeof import('livekit-server-sdk')>()),
  RoomServiceClient: class {
    updateRoomMetadata = updateRoomMetadata
    createRoom = createRoom
  },
}))

const { POST: start } = await import('@/app/api/calls/[id]/start/route')
const { POST: end } = await import('@/app/api/calls/[id]/end/route')

const SESSION = '22222222-2222-4222-8222-222222222222'
const params = (id = SESSION) => ({ params: Promise.resolve({ id }) })
const req = () => new Request('https://meet.transvoice.ai/api/calls/x', { method: 'POST' })

beforeEach(() => {
  vi.clearAllMocks()
  getSessionUser.mockResolvedValue({ id: 'host-1' })
  updateRoomMetadata.mockResolvedValue({})
  createRoom.mockResolvedValue({})
})

describe('POST /api/calls/[id]/start', () => {
  it('starts the session, then publishes live room metadata', async () => {
    rpc.mockResolvedValue({
      data: [{ session_id: SESSION, started_at: '2026-10-24T10:00:00Z' }],
      error: null,
    })
    const res = await start(req(), params())
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('start_call_session', { p_session: SESSION, p_user: 'host-1' })
    expect(updateRoomMetadata).toHaveBeenCalledWith(
      `tv-${SESSION}`,
      JSON.stringify({ status: 'live', startedAt: '2026-10-24T10:00:00Z', hostId: 'host-1' }),
    )
    expect(await res.json()).toMatchObject({ status: 'live', published: true })
  })

  it.each([
    ['NOT_HOST', 403],
    ['NO_MINUTES', 402],
    ['SESSION_CLOSED', 409],
  ])('%s → %i and no metadata change', async (code, status) => {
    rpc.mockResolvedValue({ data: null, error: { message: code } })
    const res = await start(req(), params())
    expect(res.status).toBe(status)
    expect(updateRoomMetadata).not.toHaveBeenCalled()
  })

  it('creates the room if it does not exist yet', async () => {
    rpc.mockResolvedValue({ data: [{ session_id: SESSION, started_at: 'x' }], error: null })
    updateRoomMetadata.mockRejectedValueOnce(new Error('room not found'))
    await start(req(), params())
    expect(createRoom).toHaveBeenCalledWith(
      expect.objectContaining({ name: `tv-${SESSION}`, maxParticipants: 8 }),
    )
  })

  it('still answers when LiveKit is down (database is the truth)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValue({ data: [{ session_id: SESSION, started_at: 'x' }], error: null })
    updateRoomMetadata.mockRejectedValue(new Error('unreachable'))
    createRoom.mockRejectedValue(new Error('unreachable'))
    const res = await start(req(), params())
    expect(await res.json()).toMatchObject({ status: 'live', published: false })
  })

  it('401 signed out, 400 bad id', async () => {
    getSessionUser.mockResolvedValueOnce(null)
    expect((await start(req(), params())).status).toBe(401)
    expect((await start(req(), params('nope'))).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('POST /api/calls/[id]/end', () => {
  it('ends as the host and publishes ended', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    const res = await end(req(), params())
    expect(rpc).toHaveBeenCalledWith('end_call_session', {
      p_session: SESSION,
      p_user: 'host-1',
      p_reason: 'host_ended',
    })
    expect(JSON.parse(updateRoomMetadata.mock.calls[0]![1])).toMatchObject({
      status: 'ended',
      endReason: 'host_ended',
    })
    expect(res.status).toBe(200)
  })

  it('guests cannot end', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'NOT_HOST' } })
    expect((await end(req(), params())).status).toBe(403)
    expect(updateRoomMetadata).not.toHaveBeenCalled()
  })
})
