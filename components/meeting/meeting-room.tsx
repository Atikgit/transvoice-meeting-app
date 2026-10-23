'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PricingModal } from '@/components/billing/pricing-modal'
import { InviteModal } from '@/components/invite/invite-modal'
import { CaptionBar } from '@/components/meeting/caption-bar'
import { ChatPanel } from '@/components/meeting/chat-panel'
import { ControlBar } from '@/components/meeting/control-bar'
import { MeetingHeader } from '@/components/meeting/meeting-header'
import { VideoGrid } from '@/components/meeting/video-grid'
import { VideoTile } from '@/components/meeting/video-tile'
import type { SessionState, TranslationCaption } from '@/features/meeting/types'
import { useLegacyRoomChannel } from '@/features/meeting/useLegacyRoomChannel'
import { useLocalMedia } from '@/features/meeting/useLocalMedia'
import {
  formatElapsed,
  useElapsedSeconds,
  useMeetingSession,
} from '@/features/meeting/useMeetingSession'
import { playTtsAudio } from '@/features/translation/playTtsAudio'
import { useLegacyChunkTranslator } from '@/features/translation/useLegacyChunkTranslator'
import { BRAND } from '@/lib/brand'
import type { MeetingRole } from '@/lib/meetings/load'

export interface MeetingRoomProps {
  meetingId: string
  userId: string
  role: MeetingRole
  /** Realtime channel name (meetings.room_name). */
  roomName: string
  displayName: string
  /** Language this participant hears (profiles.listen_lang). */
  listenLang: string
  /** Session state when the page loaded. */
  initialSession: SessionState
  /** Host's balance (minutes) and label. */
  balance?: number
  minutesLabel?: string
  /** Camera / mic choice from the lobby. */
  initialCamera: boolean
  initialMic: boolean
}

/**
 * /m/[meetingId]: opens "ready" (camera preview, mic not sent to translation, timer stopped).
 * The host's Start makes it live; guests wait for it.
 */
export function MeetingRoom({
  meetingId,
  userId,
  role,
  roomName,
  displayName,
  listenLang,
  initialSession,
  balance = 0,
  minutesLabel,
  initialCamera,
  initialMic,
}: MeetingRoomProps) {
  const router = useRouter()
  const [mic, setMic] = useState(initialMic)
  const [camera, setCamera] = useState(initialCamera)
  const [chat, setChat] = useState(false)
  const [modal, setModal] = useState<'invite' | 'pricing' | null>(null)
  const [translating, setTranslating] = useState(false)
  const [originalText, setOriginalText] = useState('')
  const [translatedText, setTranslatedText] = useState('')

  const myDisplayName = displayName || 'You'
  const localStream = useLocalMedia({ camera, mic })
  const session = useMeetingSession({ meetingId, role, initial: initialSession })
  const live = session.state.status === 'live'
  const elapsed = useElapsedSeconds(
    live && 'startedAt' in session.state ? session.state.startedAt : null,
  )

  const showCaption = (caption: TranslationCaption) => {
    setOriginalText(caption.original)
    setTranslatedText(caption.translated)
    if (caption.audio) playTtsAudio(caption.audio)
  }

  const channel = useLegacyRoomChannel({
    roomId: roomName,
    myDisplayName,
    onTranslation: showCaption,
    onSessionState: session.applyRemote,
    // Late joiners: the host repeats the current state.
    onPeerJoined: () => {
      if (role === 'host') channel.broadcastSessionState(session.state)
    },
  })

  // Translation runs only while the session is live (and the mic is on).
  useLegacyChunkTranslator({
    enabled: live && mic,
    stream: localStream,
    tgtLang: listenLang,
    onTranslatingChange: setTranslating,
    onResult: (caption) => {
      setOriginalText(caption.original)
      setTranslatedText(caption.translated)
      channel.broadcastTranslation(caption)
      if (caption.audio) playTtsAudio(caption.audio)
    },
  })

  const start = async () => {
    const next = await session.start()
    if (next) channel.broadcastSessionState(next)
  }
  const end = async () => {
    const next = await session.end()
    if (next) channel.broadcastSessionState(next)
  }

  const statusLabel = live
    ? `Live ${formatElapsed(elapsed)}`
    : channel.partnerConnected
      ? 'Ready'
      : 'Waiting for partner…'

  return (
    <main className="grid h-dvh grid-rows-[auto_1fr_auto_auto] overflow-hidden bg-[#0b0e16] text-slate-100">
      <h1 className="sr-only">{BRAND.name} meeting</h1>
      <MeetingHeader
        roomId={roomName}
        partnerConnected={channel.partnerConnected}
        partnerName={channel.partnerName}
        minutesLabel={minutesLabel}
        statusLabel={statusLabel}
        live={live}
      />

      <section aria-label="Participants" className="relative min-h-0 px-4 pt-4 lg:px-6">
        {(session.problem || session.notice) && (
          <p
            role={session.problem ? 'alert' : 'status'}
            className={`absolute inset-x-4 top-4 z-20 mx-auto max-w-xl rounded-lg border p-3 text-center text-sm shadow-lg lg:inset-x-6 ${session.problem ? 'border-rose-500/30 bg-[#2a1520] text-rose-200' : 'border-cyan-300/30 bg-[#12222c] text-cyan-100'}`}
          >
            {session.problem?.error ?? session.notice}
            {session.problem?.code === 'NO_MINUTES' && (
              <button onClick={() => setModal('pricing')} className="ml-1 font-semibold underline">
                Get minutes
              </button>
            )}
          </p>
        )}

        <VideoGrid>
          {[
            <VideoTile
              key="partner"
              name={channel.partnerConnected ? channel.partnerName : 'Waiting for partner...'}
              initials={channel.partnerName.slice(0, 2).toUpperCase()}
              color="bg-teal-900/60"
              active={channel.partnerConnected}
              cameraOn={channel.partnerConnected}
              isWaiting={!channel.partnerConnected}
            />,
            <VideoTile
              key="self"
              name={`${myDisplayName} (You)`}
              initials="You"
              color="bg-indigo-900/60"
              active={mic}
              cameraOn={camera}
              isLocal={true}
              stream={localStream}
            />,
          ]}
        </VideoGrid>

        {chat && (
          <div className="absolute inset-0 z-30 md:inset-y-0 md:right-4 md:left-auto md:w-[340px] lg:right-6">
            <ChatPanel
              messages={channel.messages}
              myDisplayName={myDisplayName}
              partnerConnected={channel.partnerConnected}
              onSend={channel.sendChat}
              onClose={() => setChat(false)}
            />
          </div>
        )}
      </section>

      <CaptionBar
        translating={translating}
        originalText={
          originalText || (live ? 'Listening…' : 'Translation starts when the meeting starts.')
        }
        translatedText={translatedText}
      />

      <ControlBar
        mic={mic}
        camera={camera}
        unreadCount={channel.messages.length - 1}
        role={role}
        live={live}
        busy={session.pending}
        onToggleMic={() => setMic(!mic)}
        onToggleCamera={() => setCamera(!camera)}
        onInvite={() => setModal('invite')}
        onToggleChat={() => setChat(!chat)}
        onStart={start}
        onEnd={end}
        onLeave={() => router.push('/dashboard')}
      />
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
    </main>
  )
}
