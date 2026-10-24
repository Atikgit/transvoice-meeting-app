import 'server-only'
import { roomNameFor, roomService } from '@/lib/livekit/server'

const TTL_MS = 2000
const cache = new Map<string, { at: number; identities: Promise<Set<string>> }>()

/**
 * Identities connected to the session's LiveKit room right now. Cached for 2 s per session so
 * a burst of utterances costs one LiveKit API call.
 */
export function connectedIdentities(sessionId: string, now = Date.now()): Promise<Set<string>> {
  const hit = cache.get(sessionId)
  if (hit && now - hit.at < TTL_MS) return hit.identities
  const identities = roomService()
    .listParticipants(roomNameFor(sessionId))
    .then((list) => new Set(list.map((p) => p.identity)))
    .catch(() => new Set<string>())
  cache.set(sessionId, { at: now, identities })
  if (cache.size > 1000) {
    for (const [key, value] of cache) if (now - value.at >= TTL_MS) cache.delete(key)
  }
  return identities
}
