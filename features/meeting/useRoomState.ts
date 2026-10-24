'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRoomInfo } from '@livekit/components-react'
import { parseRoomState, type RoomState } from '@/lib/meetings/room-state'

export interface CallProblem {
  code?: string
  error: string
}

async function post(
  path: string,
): Promise<{ ok: true; state: RoomState } | ({ ok: false } & CallProblem)> {
  try {
    const res = await fetch(path, { method: 'POST' })
    const body = (await res.json().catch(() => ({}))) as Partial<RoomState> & CallProblem
    if (!res.ok) return { ok: false, code: body.code, error: body.error ?? 'Please try again.' }
    return { ok: true, state: body as RoomState }
  } catch {
    return { ok: false, error: 'Network error. Please try again.' }
  }
}

/**
 * The session state from LiveKit room metadata (set only by the server; updates arrive as
 * RoomMetadataChanged), plus the host's Start / End calls.
 */
export function useRoomState(sessionId: string, initial: RoomState) {
  const { metadata } = useRoomInfo()
  const remote = parseRoomState(metadata, initial)
  // The host's own Start/End answer arrives before the metadata event: use it until the
  // metadata changes (whatever the server publishes next wins).
  const [optimistic, setOptimistic] = useState<{ state: RoomState; basis?: string } | null>(null)
  const [problem, setProblem] = useState<CallProblem | null>(null)
  const [pending, startTransition] = useTransition()

  const run = (action: 'start' | 'end') =>
    startTransition(async () => {
      setProblem(null)
      const result = await post(`/api/calls/${sessionId}/${action}`)
      if (result.ok) setOptimistic({ state: result.state, basis: metadata })
      else setProblem({ code: result.code, error: result.error })
    })

  return {
    state: optimistic && optimistic.basis === metadata ? optimistic.state : remote,
    pending,
    problem,
    start: () => run('start'),
    end: () => run('end'),
  }
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
