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

const RANK = { ready: 0, live: 1, ended: 2 } as const

/** The more advanced of two states of the SAME session (ready → live → ended never go back). */
export function mostAdvanced(a: RoomState, b: RoomState | null | undefined): RoomState {
  return b && RANK[b.status] > RANK[a.status] ? b : a
}

/**
 * Should ensureRoom overwrite a room's existing metadata with `desired`? Only to move the
 * session forward (or when the room has none yet): a page render that read "ready" a moment
 * before the host pressed Start must not turn a live room back into "ready".
 */
export function shouldWriteMetadata(existing: string | undefined, desired: RoomState): boolean {
  if (!existing) return true
  const current = parseRoomState(existing, { ...desired, status: 'ready' })
  const unparsable = !isRoomStateJson(existing)
  return unparsable || RANK[desired.status] > RANK[current.status]
}

function isRoomStateJson(metadata: string): boolean {
  try {
    const status = (JSON.parse(metadata) as { status?: unknown }).status
    return status === 'ready' || status === 'live' || status === 'ended'
  } catch {
    return false
  }
}
