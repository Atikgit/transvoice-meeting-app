import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MeetingRoom } from '@/components/meeting/meeting-room'
import { RoomNotice } from '@/components/meeting/room-notice'
import { currentBalance } from '@/lib/auth/account'
import { availableMinutes, minutesLabel } from '@/lib/billing/balance'
import { ensureRoom } from '@/lib/livekit/rooms'
import { serverEnv } from '@/lib/env'
import { loadMeetingContext } from '@/lib/meetings/load'
import { logRoom } from '@/lib/meetings/log'
import { betaAllows, isAllowlistedUser } from '@/lib/translation/gate'
import type { RoomState } from '@/lib/meetings/room-state'
import { createAdminClient } from '@/lib/supabase/admin'

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

  // The meeting's open session (created "ready" if needed); rights are checked in SQL.
  const { data, error } = await createAdminClient().rpc('open_call_session', {
    p_meeting: context.meeting.id,
    p_user: context.userId,
  })
  const session = data?.[0]
  if (error || !session) {
    if (!error?.message.includes('NOT_ALLOWED'))
      console.error('open_call_session failed:', error?.message)
    return (
      <main className="flex h-dvh items-center justify-center bg-[#0b0e16] p-6">
        <RoomNotice tone="error" action={{ label: 'Back to dashboard', href: '/dashboard' }}>
          You can no longer join calls in this meeting.
        </RoomNotice>
      </main>
    )
  }

  logRoom(session.created ? 'session_created' : 'session_reused', {
    meetingId: context.meeting.id,
    sessionId: session.session_id,
    role: context.role,
    status: session.status,
  })
  const initialState: RoomState = {
    status: session.status === 'live' ? 'live' : 'ready',
    startedAt: session.started_at,
    hostId: session.host_id,
  }
  // Room metadata is the clients' source of the session state. If LiveKit is unreachable the
  // client shows the connection error when it tries to join.
  await ensureRoom(session.session_id, initialState).catch((e: unknown) =>
    console.error('LiveKit ensureRoom failed:', e instanceof Error ? e.message : e),
  )
  // Private beta: translation only for meetings hosted by allow-listed emails.
  const { data: hostUser } = await createAdminClient().auth.admin.getUserById(session.host_id)
  const translationEnabled = betaAllows(
    hostUser.user?.email,
    serverEnv().TRANSLATION_BETA_ALLOWLIST,
  )
  const balance = context.role === 'host' ? await currentBalance(context.userId) : null

  return (
    <MeetingRoom
      meetingId={context.meeting.id}
      sessionId={session.session_id}
      userId={context.userId}
      role={context.role}
      roomName={context.meeting.roomName}
      title={context.meeting.title ?? 'Translated meeting'}
      displayName={context.profile.fullName}
      originalAudioMode={context.profile.originalAudioMode}
      translationEnabled={translationEnabled}
      spokenLang={context.profile.spokenLang}
      listenLang={context.profile.listenLang}
      initialState={initialState}
      balance={balance ? availableMinutes(balance) : 0}
      minutesLabel={balance ? minutesLabel(balance) : undefined}
      debug={
        query.debug === '1' &&
        (process.env.NODE_ENV !== 'production' ||
          isAllowlistedUser(context.email, serverEnv().TRANSLATION_BETA_ALLOWLIST))
      }
      initialCamera={query.camera !== 'off'}
      initialMic={query.mic !== 'off'}
    />
  )
}
