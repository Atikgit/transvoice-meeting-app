'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BalanceView, NotPayerView } from '@/lib/billing/balance-view'

export const PAYER_POLL_MS = 20_000
/** Someone who pays for nobody (yet) checks less often: a guest may sponsor a newcomer later. */
export const NON_PAYER_POLL_MS = 60_000

/**
 * Polls GET /api/billing/balance. With a sessionId it is the room's meter: `payer` is false for
 * anyone who pays for nobody in that session, and then no numbers are ever held. Without one it
 * is the dashboard's own balance. Failures keep the last value.
 */
export function useBalance({
  sessionId,
  enabled = true,
  intervalMs = PAYER_POLL_MS,
}: {
  sessionId?: string
  enabled?: boolean
  intervalMs?: number
}) {
  const [view, setView] = useState<BalanceView | null>(null)
  const [payer, setPayer] = useState<boolean | null>(sessionId ? null : true)
  // Whether the last answer said "pays for nobody": decides how often to ask next.
  const nonPayer = useRef(false)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const url = sessionId
        ? `/api/billing/balance?sessionId=${encodeURIComponent(sessionId)}`
        : '/api/billing/balance'
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok || !alive.current) return
      const body = (await res.json()) as BalanceView | NotPayerView
      if ('payer' in body && body.payer === false) {
        nonPayer.current = true
        setPayer(false)
        setView(null)
        return
      }
      nonPayer.current = false
      setPayer(true)
      setView(body as BalanceView)
    } catch {
      // Offline or the server restarting: the next poll tries again.
    }
  }, [sessionId])

  useEffect(() => {
    if (!enabled) return
    alive.current = true
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(
        () => {
          void refresh().finally(() => alive.current && schedule())
        },
        nonPayer.current ? Math.max(intervalMs, NON_PAYER_POLL_MS) : intervalMs,
      )
    }
    timer = setTimeout(() => {
      void refresh().finally(() => alive.current && schedule())
    }, 0)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive.current = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, intervalMs, refresh])

  return { view, payer, refresh }
}
