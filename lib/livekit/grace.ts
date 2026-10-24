import 'server-only'
import { serverEnv } from '@/lib/env'
import { publishRoomState } from '@/lib/livekit/rooms'
import { roomNameFor, roomService } from '@/lib/livekit/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
      } catch {
        return [] // the room no longer exists
      }
    },
    endSession: async (id, reason) => {
      const { data, error } = await admin.rpc('end_call_session', {
        p_session: id,
        p_user: null,
        p_reason: reason,
      })
      if (error) throw new Error(error.message)
      return data === true
    },
    publishEnded: (id, hostId, reason) =>
      publishRoomState(id, { status: 'ended', startedAt: null, hostId, endReason: reason }),
  }
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

const timers = new Map<string, ReturnType<typeof setTimeout>>()

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
