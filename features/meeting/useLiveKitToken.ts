'use client'

import { useEffect, useState } from 'react'

export type TokenState =
  | { status: 'loading' }
  | { status: 'ready'; token: string; url: string }
  | { status: 'error'; code?: string; error: string; httpStatus: number }

/** A token request that takes longer than this is treated as "cannot reach the server". */
export const TOKEN_TIMEOUT_MS = 15_000

/** Fetches a LiveKit join token for the session (GET /api/livekit/token). */
export function useLiveKitToken(sessionId: string, attempt = 0): TokenState {
  // The result is stored with the request it answers: a new attempt (Retry) is "loading" again
  // instead of reusing the previous token.
  const key = `${sessionId}:${attempt}`
  const [result, setResult] = useState<{ key: string; state: TokenState } | null>(null)

  useEffect(() => {
    let cancelled = false
    const done = (state: TokenState) => {
      if (!cancelled) setResult({ key, state })
    }
    fetch(`/api/livekit/token?sessionId=${encodeURIComponent(sessionId)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          token?: string
          url?: string
          error?: string
          code?: string
        }
        if (res.ok && body.token && body.url)
          done({ status: 'ready', token: body.token, url: body.url })
        else
          done({
            status: 'error',
            code: body.code,
            error: body.error ?? 'Could not join the meeting.',
            httpStatus: res.status,
          })
      })
      .catch(() =>
        done({ status: 'error', error: 'Network error. Check your connection.', httpStatus: 0 }),
      )
    return () => {
      cancelled = true
    }
  }, [sessionId, key])

  return result?.key === key ? result.state : { status: 'loading' }
}
