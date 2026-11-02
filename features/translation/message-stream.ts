/**
 * DELIVERY=sse client: GET /api/stream once the room is connected; every event carries a topic and
 * the same bytes a LiveKit data message would. While it is not open the server sends over LiveKit
 * (it knows who has a stream), so a failed or dropped stream costs nothing but the faster path.
 */
export const STREAM_RETRY_MS = 5000

export interface RoomLink {
  isConnected: () => boolean
  /** Calls back when the room (re)connects; returns the unsubscribe. */
  onConnected: (callback: () => void) => () => void
}

export function openMessageStream(
  sessionId: string,
  room: RoomLink,
  onMessage: (topic: string, bytes: Uint8Array) => void,
  create: (url: string) => EventSource = (url) => new EventSource(url),
): () => void {
  let source: EventSource | null = null
  let retry: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const open = () => {
    if (stopped || source || !room.isConnected()) return
    source = create(`/api/stream?sessionId=${encodeURIComponent(sessionId)}`)
    source.addEventListener('m', (event) => {
      try {
        const { t, b } = JSON.parse((event as MessageEvent<string>).data) as {
          t: string
          b: string
        }
        const binary = atob(b)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        onMessage(t, bytes)
      } catch {
        // a malformed event is ignored
      }
    })
    source.onerror = () => {
      // The browser reconnects by itself after a network drop; a refusal (not admitted yet) closes
      // it, then we try again a little later.
      if (source?.readyState === 2 /* CLOSED */) {
        source = null
        if (!stopped) retry = setTimeout(open, STREAM_RETRY_MS)
      }
    }
  }
  const offConnected = room.onConnected(open)
  open()
  return () => {
    stopped = true
    clearTimeout(retry)
    offConnected()
    source?.close()
    source = null
  }
}
