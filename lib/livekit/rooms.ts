import 'server-only'
import { serverEnv } from '@/lib/env'
import { roomNameFor, roomService } from '@/lib/livekit/server'
import { shouldWriteMetadata, type RoomState } from '@/lib/meetings/room-state'

/** MVP room size (Rule 7). */
const MAX_PARTICIPANTS = 8
/** An empty room closes after 5 minutes (LiveKit then sends room_finished). */
const EMPTY_TIMEOUT_SEC = 300

/**
 * Creates the session's LiveKit room if needed and makes sure its metadata is at least `state`.
 * createRoom returns an existing room unchanged (with its metadata), and the metadata is only
 * rewritten to move the session forward: opening the room page must never turn a live room
 * back into "ready" (a render that read the database just before Start would do that).
 */
export async function ensureRoom(sessionId: string, state: RoomState): Promise<void> {
  const name = roomNameFor(sessionId)
  const metadata = JSON.stringify(state)
  const room = await roomService().createRoom({
    name,
    emptyTimeout: EMPTY_TIMEOUT_SEC,
    departureTimeout: serverEnv().RECONNECT_GRACE_SEC,
    maxParticipants: MAX_PARTICIPANTS,
    metadata,
  })
  if (shouldWriteMetadata(room.metadata, state)) {
    await roomService().updateRoomMetadata(name, metadata)
  }
}

/** Publishes a new state; clients get RoomMetadataChanged. */
export async function publishRoomState(sessionId: string, state: RoomState): Promise<void> {
  try {
    await roomService().updateRoomMetadata(roomNameFor(sessionId), JSON.stringify(state))
  } catch {
    // The room may not exist yet (nobody connected, or it closed): create it with the state.
    await ensureRoom(sessionId, state)
  }
}
