import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/** Events on the private Realtime channel user:<id> (RLS: each user receives only their own). */
export type UserEvent =
  | {
      event: 'incoming_call'
      payload: {
        sessionId: string
        meetingId: string
        callerName: string
        expiresAt: string
        /** The host is calling their guest (else a guest is calling their sponsor). */
        fromHost: boolean
      }
    }
  | { event: 'call_cancelled'; payload: { sessionId: string } }
  | {
      event: 'call_answered'
      payload: { sessionId: string; meetingId: string; outcome: 'accepted' | 'declined' }
    }

export const userChannel = (userId: string) => `user:${userId}`

/** Pushes an event to one user over REST (no socket). Failures are logged, never thrown. */
export async function notifyUser(userId: string, { event, payload }: UserEvent): Promise<boolean> {
  try {
    const channel = createAdminClient().channel(userChannel(userId), { config: { private: true } })
    await channel.httpSend(event, payload)
    // One line per publish: "was the ring sent?" is answerable from `docker logs` (no ids of people).
    console.info(JSON.stringify({ event: 'notify', type: event, ok: true }))
    return true
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'notify',
        type: event,
        ok: false,
        detail: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
      }),
    )
    return false
  }
}
