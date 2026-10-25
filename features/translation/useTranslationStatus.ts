'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** GET /api/translate/status: the server's view of this session's languages and translation. */
export interface TranslationStatus {
  sessionStatus: string
  me: { spokenLang: string; listenLang: string }
  others: {
    name: string
    role: string
    spokenLang: string
    listenLang: string
    connected: boolean
  }[]
  fanout: {
    reason: 'ok' | 'same_language' | 'no_listeners'
    targets: { lang: string; listeners: number }[]
  }
  incoming: { name: string; from: string; to: string; translated: boolean }[]
  swapped: boolean
  decision: { allowed: boolean; reason: string; message?: string }
  allowlist: 'everyone' | 'list'
  translationEnabled: boolean
  api: 'ok' | 'rejected' | 'unreachable'
}

/** Other people's changes reach the room within this long (no push channel needed). */
export const STATUS_POLL_MS = 3000

/**
 * The room's languages as the server stores them (meeting_participants), refreshed every 3 s and
 * on demand after a change. Everything the room says about languages comes from here, so the
 * Languages menu, the status line and the overlay cannot disagree with what /api/translate does.
 */
export function useTranslationStatus(sessionId: string) {
  const [status, setStatus] = useState<TranslationStatus | null>(null)
  const [failed, setFailed] = useState(false)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/translate/status?sessionId=${encodeURIComponent(sessionId)}`, {
        cache: 'no-store',
      })
      if (!alive.current) return
      if (res.ok) {
        setStatus((await res.json()) as TranslationStatus)
        setFailed(false)
      } else setFailed(true)
    } catch {
      if (alive.current) setFailed(true)
    }
  }, [sessionId])

  useEffect(() => {
    alive.current = true
    const first = setTimeout(() => void refresh(), 0)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, STATUS_POLL_MS)
    return () => {
      alive.current = false
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [refresh])

  return { status, failed, refresh }
}
