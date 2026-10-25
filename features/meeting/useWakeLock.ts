'use client'

import { useEffect } from 'react'

/**
 * Keeps the screen on while `active` (a live session). The browser drops the lock whenever the
 * tab is hidden, so it is requested again when the tab becomes visible. Unsupported browsers
 * (older iOS, Firefox) simply do nothing.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    let sentinel: WakeLockSentinel | null = null
    let cancelled = false

    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible') return
      if (sentinel && !sentinel.released) return
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (cancelled) return void lock.release().catch(() => {})
        sentinel = lock
      } catch {
        // Denied (battery saver, permissions policy): not worth interrupting the call.
      }
    }
    const onVisibility = () => void acquire()

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      void sentinel?.release().catch(() => {})
      sentinel = null
    }
  }, [active])
}
