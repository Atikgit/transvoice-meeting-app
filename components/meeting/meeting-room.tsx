'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Users } from 'lucide-react'
import { PricingModal } from '@/components/billing/pricing-modal'
import { InviteModal } from '@/components/invite/invite-modal'
import { CaptionBar } from '@/components/meeting/caption-bar'
import { ChatPanel } from '@/components/meeting/chat-panel'
import { ControlBar } from '@/components/meeting/control-bar'
import { MeetingHeader } from '@/components/meeting/meeting-header'
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
    <main className="flex min-h-screen flex-col bg-[#0b0e16] text-slate-100">
      <MeetingHeader
        roomId={roomName}
        partnerConnected={channel.partnerConnected}
        partnerName={channel.partnerName}
        minutesLabel={minutesLabel}
        statusLabel={statusLabel}
        live={live}
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="flex min-w-0 flex-1 flex-col p-4 lg:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[.2em] text-slate-600">
                {live ? 'LIVE SESSION' : 'READY'}
              </p>
              <h1 className="mt-1 text-lg font-semibold text-white">{BRAND.name} meeting</h1>
            </div>
            <span className="flex items-center gap-2 text-xs text-slate-400">
              <Users size={14} /> {channel.partnerConnected ? '2 People' : '1 Person'}
            </span>
          </div>

          {(session.problem || session.notice) && (
            <p
              role={session.problem ? 'alert' : 'status'}
              className={`mb-3 rounded-lg border p-3 text-sm ${session.problem ? 'border-rose-500/20 bg-rose-500/10 text-rose-300' : 'border-cyan-300/20 bg-cyan-300/10 text-cyan-200'}`}
            >
              {session.problem?.error ?? session.notice}
              {session.problem?.code === 'NO_MINUTES' && (
                <button
                  onClick={() => setModal('pricing')}
                  className="ml-1 font-semibold underline"
                >
                  Get minutes
                </button>
              )}
            </p>
          )}

          <div className="grid flex-1 gap-4 md:grid-cols-2">
            <VideoTile
              name={channel.partnerConnected ? channel.partnerName : 'Waiting for partner...'}
              initials={channel.partnerName.slice(0, 2).toUpperCase()}
              color="bg-teal-900/60"
              active={channel.partnerConnected}
              cameraOn={channel.partnerConnected}
              isWaiting={!channel.partnerConnected}
            />
            <VideoTile
              name={`${myDisplayName} (You)`}
              initials="You"
              color="bg-indigo-900/60"
              active={mic}
              cameraOn={camera}
              isLocal={true}
              stream={localStream}
            />
          </div>

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
        </section>

        {chat && (
          <ChatPanel
            messages={channel.messages}
            myDisplayName={myDisplayName}
            partnerConnected={channel.partnerConnected}
            onSend={channel.sendChat}
            onClose={() => setChat(false)}
          />
        )}
      </div>
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
