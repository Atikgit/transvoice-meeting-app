import { notFound } from 'next/navigation'
import { MeetingRoom } from '@/components/meeting/meeting-room'
import type { SessionState } from '@/features/meeting/types'

/**
 * Development-only preview of the meeting room with fake data, used by the Playwright layout
 * checks (tests/e2e/meeting-layout.spec.ts). 404 in production builds.
 *
 *   /dev/room?role=host|guest&state=ready|live
 */
/** A start time in the past, so the live timer shows a realistic value. */
function secondsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString()
}

export default async function RoomPreview({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { role, state } = await searchParams
  const session: SessionState =
    state === 'live'
      ? {
          status: 'live',
          sessionId: '00000000-0000-4000-8000-000000000002',
          startedAt: secondsAgo(83),
        }
      : { status: 'ready' }

  return (
    <MeetingRoom
      meetingId="00000000-0000-4000-8000-000000000001"
      userId="00000000-0000-4000-8000-000000000003"
      role={role === 'guest' ? 'guest' : 'host'}
      roomName="dev-preview"
      title="Translated meeting"
      displayName="Preview User"
      listenLang="en-US"
      initialSession={session}
      balance={15}
      minutesLabel="15 min remaining"
      initialCamera
      initialMic
    />
  )
}
