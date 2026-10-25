import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mostAdvanced, shouldWriteMetadata, type RoomState } from '@/lib/meetings/room-state'

const READY: RoomState = { status: 'ready', startedAt: null, hostId: 'h' }
const LIVE: RoomState = { status: 'live', startedAt: '2026-10-25T10:00:00Z', hostId: 'h' }
const ENDED: RoomState = { ...LIVE, status: 'ended', endReason: 'host_ended' }

describe('room state only moves forward', () => {
  it('mostAdvanced prefers live over ready and ended over live', () => {
    expect(mostAdvanced(READY, LIVE)).toBe(LIVE)
    expect(mostAdvanced(LIVE, READY)).toBe(LIVE)
    expect(mostAdvanced(LIVE, ENDED)).toBe(ENDED)
    expect(mostAdvanced(READY, null)).toBe(READY)
    expect(mostAdvanced(LIVE, { ...LIVE })).toBe(LIVE)
  })

  it('ensureRoom never turns a live room back into ready', () => {
    expect(shouldWriteMetadata(JSON.stringify(LIVE), READY)).toBe(false)
    expect(shouldWriteMetadata(JSON.stringify(LIVE), LIVE)).toBe(false)
    expect(shouldWriteMetadata(JSON.stringify(ENDED), LIVE)).toBe(false)
  })

  it('but writes for a new room, a ready room that went live, or unreadable metadata', () => {
    expect(shouldWriteMetadata(undefined, READY)).toBe(true)
    expect(shouldWriteMetadata('', READY)).toBe(true)
    expect(shouldWriteMetadata(JSON.stringify(READY), LIVE)).toBe(true)
    expect(shouldWriteMetadata('not json', READY)).toBe(true)
    expect(shouldWriteMetadata('{"status":"hacked"}', READY)).toBe(true)
  })
})

const createRoom = vi.fn()
const updateRoomMetadata = vi.fn(async () => {})
vi.mock('@/lib/livekit/server', () => ({
  roomNameFor: (id: string) => `tv-${id}`,
  roomService: () => ({ createRoom, updateRoomMetadata }),
}))

describe('ensureRoom', () => {
  beforeEach(() => vi.clearAllMocks())

  it('leaves the metadata of a room that is already live alone when a stale page asks for ready', async () => {
    const { ensureRoom } = await import('@/lib/livekit/rooms')
    createRoom.mockResolvedValue({ metadata: JSON.stringify(LIVE) })
    await ensureRoom('s1', READY)
    expect(updateRoomMetadata).not.toHaveBeenCalled()
  })

  it('writes the state into a new room, and moves a ready room forward', async () => {
    const { ensureRoom } = await import('@/lib/livekit/rooms')
    createRoom.mockResolvedValue({ metadata: '' })
    await ensureRoom('s1', READY)
    expect(updateRoomMetadata).toHaveBeenCalledWith('tv-s1', JSON.stringify(READY))
    createRoom.mockResolvedValue({ metadata: JSON.stringify(READY) })
    await ensureRoom('s1', LIVE)
    expect(updateRoomMetadata).toHaveBeenLastCalledWith('tv-s1', JSON.stringify(LIVE))
  })
})
