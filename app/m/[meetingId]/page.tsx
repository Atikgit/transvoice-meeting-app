import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MeetingRoom } from '@/components/meeting/meeting-room'
import type { SessionState } from '@/features/meeting/types'
import { currentBalance } from '@/lib/auth/account'
import { availableMinutes, minutesLabel } from '@/lib/billing/balance'
import { loadMeetingContext } from '@/lib/meetings/load'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = { title: 'Meeting' }

/** The meeting's live session, if any (guests cannot read call_sessions before they join). */
async function liveSession(meetingId: string): Promise<SessionState> {
  const { data } = await createAdminClient()
    .from('call_sessions')
    .select('id, started_at')
    .eq('meeting_id', meetingId)
    .eq('status', 'live')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.started_at
    ? { status: 'live', sessionId: data.id, startedAt: data.started_at }
    : { status: 'ready' }
}

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
  const [session, balance] = await Promise.all([
    liveSession(context.meeting.id),
    context.role === 'host' ? currentBalance(context.userId) : null,
  ])

  return (
    <MeetingRoom
      meetingId={context.meeting.id}
      userId={context.userId}
      role={context.role}
      roomName={context.meeting.roomName}
      displayName={context.profile.fullName}
      listenLang={context.profile.listenLang}
      initialSession={session}
      balance={balance ? availableMinutes(balance) : 0}
      minutesLabel={balance ? minutesLabel(balance) : undefined}
      initialCamera={query.camera !== 'off'}
      initialMic={query.mic !== 'off'}
    />
  )
}
