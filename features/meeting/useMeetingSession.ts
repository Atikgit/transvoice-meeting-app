'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import {
  endMeetingSession,
  joinMeetingSession,
  startMeetingSession,
  type SessionActionResult,
} from '@/app/m/actions'
import type { MeetingRole } from '@/lib/meetings/load'
import type { SessionState } from './types'

export type SessionProblem = Extract<SessionActionResult, { ok: false }>

/**
 * Room lifecycle: "ready" (camera preview, no translation, timer stopped) until the host presses
 * Start; then "live" until the host ends it. Guests follow the host's broadcasts and join the
 * live session (which records who pays for them).
 */
export function useMeetingSession({
  meetingId,
  role,
  initial,
}: {
  meetingId: string
  role: MeetingRole
  initial: SessionState
}) {
  const [state, setState] = useState<SessionState>(initial)
  const [problem, setProblem] = useState<SessionProblem | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const joined = useRef<string | null>(null)

  // Guests (and a host who reloaded the page) enter the live session once per session.
  useEffect(() => {
    if (state.status !== 'live' || role === 'host' || joined.current === state.sessionId) return
    joined.current = state.sessionId
    void joinMeetingSession(state.sessionId, state.startedAt).then((result) => {
      if (!result.ok) setProblem(result)
    })
  }, [state, role])

  /** Host: Start. Resolves to the new state so the caller can broadcast it. */
  const start = () =>
    new Promise<SessionState | null>((resolve) =>
      startTransition(async () => {
        setProblem(null)
        setNotice(null)
        const result = await startMeetingSession(meetingId)
        if (!result.ok) {
          setProblem(result)
          return resolve(null)
        }
        const live: SessionState = {
          status: 'live',
          sessionId: result.sessionId,
          startedAt: result.startedAt,
        }
        setState(live)
        resolve(live)
      }),
    )

  /** Host: End meeting. Resolves to the new state so the caller can broadcast it. */
  const end = () =>
    new Promise<SessionState | null>((resolve) =>
      startTransition(async () => {
        if (state.status !== 'live') return resolve(null)
        await endMeetingSession(state.sessionId)
        const ready: SessionState = { status: 'ready' }
        setState(ready)
        setNotice('Meeting ended. Press Start to begin a new session.')
        resolve(ready)
      }),
    )

  /** A state broadcast by the host. */
  const applyRemote = (next: SessionState) => {
    if (role === 'host') return
    if (state.status === 'live' && next.status === 'ready') {
      setNotice('The host ended the meeting.')
    }
    if (next.status === 'live') setNotice(null)
    setState(next)
  }

  return { state, pending, problem, notice, start, end, applyRemote }
}

/** Seconds since `startedAt`, updated every second; 0 when not live. */
export function useElapsedSeconds(startedAt: string | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!startedAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  return startedAt ? Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000)) : 0
}

/** 75 → "01:15", 3725 → "1:02:05". */
export function formatElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return hours ? `${hours}:${mmss}` : mmss
}
