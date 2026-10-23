import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MeetingRoom } from '@/components/meeting/meeting-room'
import { currentBalance } from '@/lib/auth/account'
import { minutesLabel } from '@/lib/billing/balance'
import { loadMeetingContext } from '@/lib/meetings/load'

export const metadata: Metadata = { title: 'Meeting' }

export default async function MeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ meetingId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ meetingId }, query] = await Promise.all([params, searchParams])
  const context = await loadMeetingContext(meetingId)
  if (!context) notFound()
  const balance = context.role === 'host' ? await currentBalance(context.userId) : null

  return (
    <MeetingRoom
      meetingId={context.meeting.id}
      roomName={context.meeting.roomName}
      displayName={context.profile.fullName}
      listenLang={context.profile.listenLang}
      minutesLabel={balance ? minutesLabel(balance) : undefined}
      initialCamera={query.camera !== 'off'}
      initialMic={query.mic !== 'off'}
    />
  )
}
