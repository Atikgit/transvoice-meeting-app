'use client'

import { useEffect } from 'react'

/** Billing heartbeat period; the server stops billing a tab 45 s after its last heartbeat. */
export const HEARTBEAT_MS = 20_000

/**
 * Tells the server this tab is still in the room (POST /api/heartbeat) while `active` (the
 * LiveKit connection is up): at once, every 20 s, and again when the tab becomes visible or the
 * network comes back, so a throttled background tab catches up quickly. Failures are ignored;
 * the next beat retries.
 */
export function useHeartbeat(sessionId: string, active: boolean) {
  useEffect(() => {
    if (!active) return
    const beat = () => {
      void fetch('/api/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
        keepalive: true,
      }).catch(() => {})
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') beat()
    }
    beat()
    const timer = setInterval(beat, HEARTBEAT_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', beat)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', beat)
    }
  }, [sessionId, active])
}
