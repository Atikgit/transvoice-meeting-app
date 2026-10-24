/** Session state shared through LiveKit room metadata (written only by the server). */
export interface RoomState {
  status: 'ready' | 'live' | 'ended'
  startedAt: string | null
  hostId: string
  /** Why an ended session ended (host_ended, reconnect_timeout, room_finished). */
  endReason?: string
}

/** Parses room metadata; anything unexpected reads as "ready" so the room never breaks. */
export function parseRoomState(metadata: string | undefined, fallback: RoomState): RoomState {
  if (!metadata) return fallback
  try {
    const value = JSON.parse(metadata) as Partial<RoomState>
    if (value.status !== 'ready' && value.status !== 'live' && value.status !== 'ended') {
      return fallback
    }
    return {
      status: value.status,
      startedAt: typeof value.startedAt === 'string' ? value.startedAt : null,
      hostId: typeof value.hostId === 'string' ? value.hostId : fallback.hostId,
      endReason: typeof value.endReason === 'string' ? value.endReason : undefined,
    }
  } catch {
    return fallback
  }
}
