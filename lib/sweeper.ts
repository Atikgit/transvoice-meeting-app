import 'server-only'
import { serverEnv } from '@/lib/env'
import { checkAfterGrace, defaultGraceDeps, type GraceDeps } from '@/lib/livekit/grace'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Periodic sweeper. The reconnect grace timers (lib/livekit/grace.ts) live in memory, so a
 * container restart or a missed webhook can leave a session "ready"/"live" with nobody in it,
 * an open participant segment, or a ringing call nobody ended. Each run:
 *   1. closes segments of sessions that are no longer open and marks unanswered calls missed;
 *   2. re-runs the grace check for open sessions older than the grace period.
 * Everything is idempotent, so a second instance or an overlapping run does no harm.
 */
export interface SweepDeps {
  graceMs: number
  sweepOrphans: () => Promise<{ segmentsClosed: number; ringingExpired: number }>
  staleSessions: (olderThanMs: number) => Promise<string[]>
  grace: GraceDeps
}

export interface SweepResult {
  segmentsClosed: number
  ringingExpired: number
  sessionsChecked: number
  sessionsEnded: number
  failed: number
}

export function defaultSweepDeps(): SweepDeps {
  const admin = createAdminClient()
  const grace = defaultGraceDeps()
  return {
    graceMs: grace.graceMs,
    grace,
    sweepOrphans: async () => {
      const { data, error } = await admin.rpc('sweep_orphans')
      if (error) throw new Error(error.message)
      return {
        segmentsClosed: data?.[0]?.segments_closed ?? 0,
        ringingExpired: data?.[0]?.ringing_expired ?? 0,
      }
    },
    staleSessions: async (ms) => {
      const { data, error } = await admin.rpc('stale_open_sessions', {
        p_older_than: `${Math.ceil(ms / 1000)} seconds`,
      })
      if (error) throw new Error(error.message)
      return (data ?? []).map((row) => row.session_id)
    },
  }
}

export async function sweepOnce(deps: SweepDeps = defaultSweepDeps()): Promise<SweepResult> {
  const result: SweepResult = {
    segmentsClosed: 0,
    ringingExpired: 0,
    sessionsChecked: 0,
    sessionsEnded: 0,
    failed: 0,
  }
  // Order matters little, but closing segments of already-ended sessions first keeps the
  // billing input consistent even if LiveKit is unreachable below.
  try {
    Object.assign(result, await deps.sweepOrphans())
  } catch {
    result.failed++
  }
  let sessions: string[] = []
  try {
    sessions = await deps.staleSessions(deps.graceMs)
  } catch {
    result.failed++
  }
  for (const id of sessions) {
    result.sessionsChecked++
    try {
      if ((await checkAfterGrace(id, deps.grace)) === 'ended') result.sessionsEnded++
    } catch {
      result.failed++ // LiveKit unreachable: leave the session, the next run retries
    }
  }
  if (
    result.failed > 0 ||
    result.sessionsEnded + result.segmentsClosed + result.ringingExpired > 0
  ) {
    console.log(JSON.stringify({ event: 'sweep', ...result }))
  }
  return result
}

let timer: ReturnType<typeof setInterval> | undefined
let running: Promise<unknown> | undefined

/** Runs one sweep immediately (recovers from a restart), then every SWEEP_INTERVAL_SEC. */
export function startSweeper(deps?: SweepDeps, intervalMs = serverEnv().SWEEP_INTERVAL_SEC * 1000) {
  if (timer) return
  const run = () => {
    if (running) return // never overlap with a slow run
    running = sweepOnce(deps)
      .catch(() => {})
      .finally(() => {
        running = undefined
      })
  }
  run()
  timer = setInterval(run, intervalMs)
  timer.unref()
}

/** Stops scheduling and waits for the run in progress, at most `waitMs`. */
export async function stopSweeper(waitMs = 5000) {
  clearInterval(timer)
  timer = undefined
  if (running) {
    await Promise.race([running, new Promise((resolve) => setTimeout(resolve, waitMs))])
  }
}

export function sweeperRunning(): boolean {
  return timer !== undefined
}
