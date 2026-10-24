import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/** Events on the private Realtime channel user:<id> (RLS: each user receives only their own). */
export type UserEvent =
  | {
      event: 'incoming_call'
      payload: { sessionId: string; meetingId: string; callerName: string; expiresAt: string }
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
    return true
  } catch (error) {
    console.error(
      `Realtime ${event} to user failed:`,
      error instanceof Error ? error.message : error,
    )
    return false
  }
}
