import { beforeEach, describe, expect, it, vi } from 'vitest'

const listParticipants = vi.fn()
vi.mock('@/lib/livekit/server', () => ({
  roomNameFor: (id: string) => `tv-${id}`,
  roomService: () => ({ listParticipants }),
}))
const { connectedIdentities, invalidateConnected } = await import('@/lib/livekit/connected')

beforeEach(() => vi.clearAllMocks())

describe('who is connected (2 s cache)', () => {
  it('is asked once per burst, and forgets on a join/leave webhook so a guest who just connected is seen at once', async () => {
    listParticipants.mockResolvedValueOnce([{ identity: 'host' }])
    expect([...(await connectedIdentities('s-1'))]).toEqual(['host'])

    listParticipants.mockResolvedValueOnce([{ identity: 'host' }, { identity: 'guest' }])
    // Within 2 s: still the cached answer (one LiveKit call for a burst of utterances).
    expect([...(await connectedIdentities('s-1'))]).toEqual(['host'])
    expect(listParticipants).toHaveBeenCalledTimes(1)

    invalidateConnected('s-1') // LiveKit sent participant_joined
    expect([...(await connectedIdentities('s-1'))]).toEqual(['host', 'guest'])
    expect(listParticipants).toHaveBeenCalledTimes(2)
  })

  it('other sessions are not affected', async () => {
    listParticipants.mockResolvedValue([{ identity: 'a' }])
    await connectedIdentities('s-a')
    await connectedIdentities('s-b')
    invalidateConnected('s-a')
    await connectedIdentities('s-b')
    expect(listParticipants).toHaveBeenCalledTimes(2) // s-b still cached
  })
})
