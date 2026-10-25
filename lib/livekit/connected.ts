import 'server-only'
import { roomNameFor, roomService } from '@/lib/livekit/server'

const TTL_MS = 2000
const cache = new Map<string, { at: number; identities: Promise<Set<string>> }>()

/**
 * Identities connected to the session's LiveKit room right now. Cached for 2 s per session so
 * a burst of utterances costs one LiveKit API call. Rejects when LiveKit cannot be asked (an
 * unknown room is just an empty set); failures are not cached.
 */
export function connectedIdentities(sessionId: string, now = Date.now()): Promise<Set<string>> {
  const hit = cache.get(sessionId)
  if (hit && now - hit.at < TTL_MS) return hit.identities
  const identities = roomService()
    .listParticipants(roomNameFor(sessionId))
    .then((list) => new Set(list.map((p) => p.identity)))
    .catch((error: unknown) => {
      // Not "nobody is here": the answer is unknown. Never cache it, let the caller say so.
      cache.delete(sessionId)
      throw error
    })
  cache.set(sessionId, { at: now, identities })
  if (cache.size > 1000) {
    for (const [key, value] of cache) if (now - value.at >= TTL_MS) cache.delete(key)
  }
  return identities
}
