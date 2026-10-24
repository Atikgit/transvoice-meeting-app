'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useLocalParticipant,
  useRemoteParticipants,
} from '@livekit/components-react'
import { ConnectionState } from 'livekit-client'
import { PricingModal } from '@/components/billing/pricing-modal'
import { InviteModal } from '@/components/invite/invite-modal'
import { ChatPanel } from '@/components/meeting/chat-panel'
import { MeetingHeader } from '@/components/meeting/meeting-header'
import { MeetingLayout } from '@/components/meeting/meeting-layout'
import { RoomNotice } from '@/components/meeting/room-notice'
import { VideoTile } from '@/components/meeting/video-tile'
import { useLiveKitToken } from '@/features/meeting/useLiveKitToken'
import { useMeetingChat } from '@/features/meeting/useMeetingChat'
import { formatElapsed, useElapsedSeconds, useRoomState } from '@/features/meeting/useRoomState'
import type { MeetingRole } from '@/lib/meetings/load'
import type { RoomState } from '@/lib/meetings/room-state'

export interface MeetingRoomProps {
  meetingId: string
  /** The open call session (LiveKit room tv-<sessionId>). */
  sessionId: string
  userId: string
  role: MeetingRole
  /** Chat channel name (meetings.room_name). */
  roomName: string
  /** Shown in the header. */
  title: string
  displayName: string
  /** Session state when the page loaded (LiveKit room metadata takes over once connected). */
  initialState: RoomState
  /** Host's balance (minutes) and label. */
  balance?: number
  minutesLabel?: string
  /** Camera / mic choice from the lobby. */
  initialCamera: boolean
  initialMic: boolean
}

/**
 * /m/[meetingId]: joins the session's LiveKit room. Tracks publish on join, but the session is
 * "ready" until the host presses Start (state lives in room metadata, set by the server).
 */
export function MeetingRoom(props: MeetingRoomProps) {
  const [attempt, setAttempt] = useState(0)
  const token = useLiveKitToken(props.sessionId, attempt)

  if (token.status !== 'ready') {
    return (
      <RoomShell {...props}>
        {token.status === 'loading' ? (
          <RoomNotice tone="info">Connecting to the meeting…</RoomNotice>
        ) : (
          <RoomNotice
            tone="error"
            action={
              token.httpStatus >= 500 || token.httpStatus === 0
                ? { label: 'Try again', onClick: () => setAttempt((n) => n + 1) }
                : { label: 'Back to dashboard', href: '/dashboard' }
            }
          >
            {token.error}
          </RoomNotice>
        )}
      </RoomShell>
    )
  }

  return (
    <LiveKitRoom
      serverUrl={token.url}
      token={token.token}
      connect
      audio={props.initialMic}
      video={props.initialCamera}
      className="contents"
    >
      <RoomView {...props} />
      <RoomAudioRenderer />
    </LiveKitRoom>
  )
}

/** Layout without a LiveKit connection (connecting / error). */
function RoomShell({
  title,
  children,
}: Pick<MeetingRoomProps, 'title'> & { children: React.ReactNode }) {
  return (
    <main className="grid h-dvh grid-rows-[auto_1fr] overflow-hidden bg-[#0b0e16] text-slate-100">
      <MeetingHeader title={title} status="waiting" statusLabel="Connecting…" />
      <section className="flex items-center justify-center p-6">{children}</section>
    </main>
  )
}

function RoomView({
  meetingId,
  sessionId,
  userId,
  role,
  roomName,
  title,
  displayName,
  initialState,
  balance = 0,
  minutesLabel,
}: MeetingRoomProps) {
  const router = useRouter()
  const [chatOpen, setChatOpen] = useState(false)
  const [modal, setModal] = useState<'invite' | 'pricing' | null>(null)

  const connection = useConnectionState()
  const remotes = useRemoteParticipants()
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant()
  const session = useRoomState(sessionId, initialState)
  const chat = useMeetingChat({ roomName, myName: displayName || 'You' })

  const live = session.state.status === 'live'
  const ended = session.state.status === 'ended'
  const elapsed = useElapsedSeconds(live ? session.state.startedAt : null)
  const partner = remotes[0]
  const partnerConnected = Boolean(partner)

  const statusLabel =
    connection === ConnectionState.Reconnecting
      ? 'Reconnecting…'
      : live
        ? `Live ${formatElapsed(elapsed)}`
        : ended
          ? 'Ended'
          : partnerConnected
            ? 'Ready'
            : 'Waiting for partner…'

  return (
    <MeetingLayout
      header={{
        title,
        status: live ? 'live' : partnerConnected ? 'ready' : 'waiting',
        statusLabel,
        minutesLabel: minutesLabel && minutesLabel !== '—' ? minutesLabel : undefined,
      }}
      notices={
        <>
          {session.problem && (
            <RoomNotice
              tone="error"
              floating
              action={
                session.problem.code === 'NO_MINUTES'
                  ? { label: 'Get minutes', onClick: () => setModal('pricing') }
                  : undefined
              }
            >
              {session.problem.error}
            </RoomNotice>
          )}
          {ended && (
            <RoomNotice
              tone="info"
              floating
              action={
                role === 'host'
                  ? { label: 'Start a new session', onClick: () => router.refresh() }
                  : { label: 'Back to dashboard', href: '/dashboard' }
              }
            >
              {role === 'host' ? 'You ended the meeting.' : 'The host ended the meeting.'}
            </RoomNotice>
          )}
        </>
      }
      tiles={[
        <VideoTile
          key="partner"
          name={partner ? partner.name || 'Partner' : 'Waiting for partner...'}
          initials={(partner?.name || 'Partner').slice(0, 2).toUpperCase()}
          color="bg-teal-900/60"
          active={partnerConnected}
          cameraOn={false}
          isWaiting={!partnerConnected}
        />,
        <VideoTile
          key="self"
          name={`${displayName || 'You'} (You)`}
          initials="You"
          color="bg-indigo-900/60"
          active={isMicrophoneEnabled}
          cameraOn={false}
          isLocal
          pipOnMobile
        />,
      ]}
      chat={
        chatOpen && (
          <ChatPanel
            messages={chat.messages}
            myDisplayName={displayName || 'You'}
            partnerConnected={partnerConnected}
            onSend={chat.send}
            onClose={() => setChatOpen(false)}
          />
        )
      }
      caption={{
        translating: false,
        originalText: '',
        translatedText: '',
        placeholder: live
          ? 'Live translation arrives in the next update.'
          : 'Translation starts when the meeting starts.',
      }}
      controls={{
        mic: isMicrophoneEnabled,
        camera: isCameraEnabled,
        unreadCount: chat.messages.length,
        role,
        live,
        ended,
        busy: session.pending,
        onToggleMic: () => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled),
        onToggleCamera: () => void localParticipant.setCameraEnabled(!isCameraEnabled),
        onInvite: () => setModal('invite'),
        onToggleChat: () => setChatOpen(!chatOpen),
        onStart: session.start,
        onEnd: session.end,
        onLeave: () => router.push('/dashboard'),
      }}
    >
      {modal === 'invite' && (
        <InviteModal
          meetingId={meetingId}
          onClose={() => setModal(null)}
          onNoMinutes={() => setModal('pricing')}
        />
      )}
      {modal === 'pricing' && (
        <PricingModal userId={userId} balance={balance} onClose={() => setModal(null)} />
      )}
    </MeetingLayout>
  )
}
