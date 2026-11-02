import 'server-only'

/**
 * In-memory fan-out for DELIVERY=sse: the open GET /api/stream connections of this container, by
 * session and user. deliver.ts pushes a message to a listener's open stream; a listener without
 * one (not connected, dropped, another container) gets it over LiveKit data instead.
 * One container is enough today; more than one would need a shared bus.
 */
export interface SseSubscriber {
  /** Writes one SSE frame; returns false when the connection is gone. */
  write: (frame: string) => boolean
}

const MAX_PER_USER = 3
const holder = globalThis as unknown as { __tvSse?: Map<string, Set<SseSubscriber>> }
const hub = () => (holder.__tvSse ??= new Map())
const key = (sessionId: string, userId: string) => `${sessionId}:${userId}`

/** Registers a connection; the returned function removes it. The oldest one goes past the cap. */
export function subscribeSse(sessionId: string, userId: string, sub: SseSubscriber): () => void {
  const set = hub().get(key(sessionId, userId)) ?? new Set<SseSubscriber>()
  hub().set(key(sessionId, userId), set)
  set.add(sub)
  while (set.size > MAX_PER_USER) set.delete(set.values().next().value!)
  return () => {
    set.delete(sub)
    if (set.size === 0) hub().delete(key(sessionId, userId))
  }
}

export function hasSseSubscriber(sessionId: string, userId: string): boolean {
  return (hub().get(key(sessionId, userId))?.size ?? 0) > 0
}

/** One data message as an SSE frame: the topic and the exact bytes LiveKit would have carried. */
export function sseFrame(topic: string, data: Uint8Array): string {
  return `event: m\ndata: ${JSON.stringify({ t: topic, b: Buffer.from(data).toString('base64') })}\n\n`
}

/** Pushes to the user's open streams. Returns true when at least one accepted it. */
export function pushSse(sessionId: string, userId: string, frame: string): boolean {
  const set = hub().get(key(sessionId, userId))
  if (!set) return false
  let delivered = false
  for (const sub of [...set]) {
    if (sub.write(frame)) delivered = true
    else set.delete(sub)
  }
  if (set.size === 0) hub().delete(key(sessionId, userId))
  return delivered
}

export const SSE_HEARTBEAT_MS = 15_000
