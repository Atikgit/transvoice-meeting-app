import 'server-only'

/**
 * One JSON line per room/session decision, for `docker logs … | grep '"event":"room"'`.
 * Ids only (meeting, session, room name, role): no names, emails, user ids or media.
 */
export function logRoom(
  action: 'session_created' | 'session_reused' | 'token_issued',
  fields: {
    meetingId: string
    sessionId: string
    room?: string
    role?: 'host' | 'guest'
    status?: string
  },
) {
  console.log(JSON.stringify({ event: 'room', action, ...fields }))
}
