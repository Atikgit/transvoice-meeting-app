import 'server-only'
import { serverEnv } from '@/lib/env'
import { publishRoomState } from '@/lib/livekit/rooms'
import { roomNameFor, roomService } from '@/lib/livekit/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { nullableArg } from '@/lib/supabase/database.types'

/**
 * Rule 5 reconnect grace. LiveKit's client reconnects by itself and keeps a participant's slot
 * for departureTimeout (= RECONNECT_GRACE_SEC). When someone leaves a live session, the server
 * checks again after the grace period; if the host is still gone (or nobody is left), the
 * session is ended with end_reason 'reconnect_timeout' and everyone sees "Call again".
 *
 * Timers live in this process: correct for the single Hetzner container. A multi-instance
 * deployment needs a shared scheduler (e.g. pg_cron reading participant_segments).
 */
export interface GraceDeps {
  graceMs: number
  loadSession: (sessionId: string) => Promise<{ status: string; hostId: string } | null>
  connectedIdentities: (sessionId: string) => Promise<string[]>
  endSession: (sessionId: string, reason: string) => Promise<boolean>
  publishEnded: (sessionId: string, hostId: string, reason: string) => Promise<void>
}

export function defaultGraceDeps(): GraceDeps {
  const admin = createAdminClient()
  return {
    graceMs: serverEnv().RECONNECT_GRACE_SEC * 1000,
    loadSession: async (id) => {
      const { data } = await admin
        .from('call_sessions')
        .select('status, host_id')
        .eq('id', id)
        .maybeSingle()
      return data ? { status: data.status, hostId: data.host_id } : null
    },
    connectedIdentities: async (id) => {
      try {
        return (await roomService().listParticipants(roomNameFor(id))).map((p) => p.identity)
      } catch (error) {
        // Only "no such room" means nobody is there. Any other failure (LiveKit unreachable,
        // timeout, bad credentials) is unknown: throw, so a live session is never ended on a guess.
        if (isRoomNotFound(error)) return []
        throw error
      }
    },
    endSession: async (id, reason) => {
      const { data, error } = await admin.rpc('end_call_session', {
        p_session: id,
        p_user: nullableArg<string>(null), // null: the server itself ends it
        p_reason: reason,
      })
      if (error) throw new Error(error.message)
      return data === true
    },
    publishEnded: (id, hostId, reason) =>
      publishRoomState(id, { status: 'ended', startedAt: null, hostId, endReason: reason }),
  }
}

function isRoomNotFound(error: unknown): boolean {
  const e = error as { status?: number; code?: string } | null
  return e?.status === 404 || e?.code === 'not_found'
}

/** Ends the session if it is still lost after the grace period. */
export async function checkAfterGrace(
  sessionId: string,
  deps: GraceDeps,
): Promise<'ended' | 'recovered' | 'closed'> {
  const session = await deps.loadSession(sessionId)
  if (!session || (session.status !== 'live' && session.status !== 'ready')) return 'closed'
  const present = await deps.connectedIdentities(sessionId)
  const lost =
    present.length === 0 || (session.status === 'live' && !present.includes(session.hostId))
  if (!lost) return 'recovered'
  const reason = session.status === 'live' ? 'reconnect_timeout' : 'abandoned'
  if (await deps.endSession(sessionId, reason)) {
    await deps.publishEnded(sessionId, session.hostId, reason).catch(() => {})
  }
  return 'ended'
}

// On globalThis: the shutdown hook (instrumentation) and the webhook route can be separate
// module instances in Next.js.
const timersHolder = globalThis as unknown as {
  __tvGraceTimers?: Map<string, ReturnType<typeof setTimeout>>
}
const timers = (timersHolder.__tvGraceTimers ??= new Map())

/** (Re)starts the grace timer for a session after a participant left. */
export function scheduleGraceCheck(sessionId: string, deps: GraceDeps = defaultGraceDeps()) {
  clearTimeout(timers.get(sessionId))
  timers.set(
    sessionId,
    setTimeout(() => {
      timers.delete(sessionId)
      checkAfterGrace(sessionId, deps).catch((error: unknown) =>
        console.error(
          'Reconnect grace check failed:',
          error instanceof Error ? error.message : error,
        ),
      )
    }, deps.graceMs),
  )
}

export function pendingGraceChecks(): number {
  return timers.size
}

/** Graceful shutdown: drops pending timers. The sweeper re-checks open sessions after a restart. */
export function clearGraceChecks() {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
}
