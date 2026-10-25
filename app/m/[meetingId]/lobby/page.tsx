import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { IncomingCallListener } from '@/components/calls/incoming-call'
import { Lobby } from '@/components/meeting/lobby'
import { loadMeetingContext } from '@/lib/meetings/load'

export const metadata: Metadata = { title: 'Lobby' }

export default async function LobbyPage({ params }: { params: Promise<{ meetingId: string }> }) {
  const { meetingId } = await params
  const context = await loadMeetingContext(meetingId)
  if (!context) notFound()

  return (
    <>
      <Lobby
        meetingId={context.meeting.id}
        role={context.role}
        defaultName={context.profile.fullName}
        spokenLang={context.profile.spokenLang}
        listenLang={context.profile.listenLang}
      />
      <IncomingCallListener userId={context.userId} currentMeetingId={context.meeting.id} />
    </>
  )
}
