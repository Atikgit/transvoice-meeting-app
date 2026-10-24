'use client'

import { useEffect, useState } from 'react'

export type TokenState =
  | { status: 'loading' }
  | { status: 'ready'; token: string; url: string }
  | { status: 'error'; code?: string; error: string; httpStatus: number }

/** Fetches a LiveKit join token for the session (GET /api/livekit/token). */
export function useLiveKitToken(sessionId: string, attempt = 0): TokenState {
  const [state, setState] = useState<TokenState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    fetch(`/api/livekit/token?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          token?: string
          url?: string
          error?: string
          code?: string
        }
        if (cancelled) return
        if (res.ok && body.token && body.url)
          setState({ status: 'ready', token: body.token, url: body.url })
        else
          setState({
            status: 'error',
            code: body.code,
            error: body.error ?? 'Could not join the meeting.',
            httpStatus: res.status,
          })
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            status: 'error',
            error: 'Network error. Check your connection.',
            httpStatus: 0,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, attempt])

  return state
}
