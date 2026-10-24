import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MeetingChat } from '@/components/meeting/meeting-chat'
import { loadMeetingContext } from '@/lib/meetings/load'

export const metadata: Metadata = { title: 'Message' }

/**
 * Free chat with the people of a meeting (Rule 6), also when no call is possible (expired
 * sponsorship, 0 minutes). Works without LiveKit.
 */
export default async function MeetingChatPage({
  params,
}: {
  params: Promise<{ meetingId: string }>
}) {
  const { meetingId } = await params
  const context = await loadMeetingContext(meetingId)
  if (!context) notFound()
  return (
    <MeetingChat roomName={context.meeting.roomName} myName={context.profile.fullName || 'You'} />
  )
}
