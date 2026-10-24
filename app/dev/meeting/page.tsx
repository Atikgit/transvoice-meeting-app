import { notFound } from 'next/navigation'
import { MeetingRoom } from '@/components/meeting/meeting-room'

/**
 * Development-only: the real LiveKit meeting room with fake identity props, for the two-browser
 * Playwright test (tests/e2e/livekit-two-party.spec.ts). The test intercepts /api/livekit/token
 * and /api/calls/* in the browser. 404 in production builds.
 *
 *   /dev/meeting?role=host|guest&session=<uuid>&user=<uuid>&name=<display name>
 */
export default async function DevMeeting({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const q = await searchParams
  const str = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback)
  const role = q.role === 'guest' ? 'guest' : 'host'
  const hostId = '00000000-0000-4000-8000-00000000000a'

  return (
    <MeetingRoom
      meetingId="00000000-0000-4000-8000-000000000001"
      sessionId={str(q.session, '00000000-0000-4000-8000-000000000002')}
      userId={str(q.user, role === 'host' ? hostId : '00000000-0000-4000-8000-00000000000b')}
      role={role}
      roomName="dev-meeting"
      title="Translated meeting"
      displayName={str(q.name, role === 'host' ? 'Host' : 'Guest')}
      initialState={{ status: 'ready', startedAt: null, hostId }}
      initialCamera
      initialMic
    />
  )
}
