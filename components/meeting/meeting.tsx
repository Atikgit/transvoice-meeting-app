'use client'

import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { Users } from 'lucide-react'
import { CaptionBar } from '@/components/meeting/caption-bar'
import { ChatPanel } from '@/components/meeting/chat-panel'
import { ControlBar } from '@/components/meeting/control-bar'
import { MeetingHeader } from '@/components/meeting/meeting-header'
import { VideoTile } from '@/components/meeting/video-tile'
import type { TranslationCaption } from '@/features/meeting/types'
import { useLegacyRoomChannel } from '@/features/meeting/useLegacyRoomChannel'
import { useLocalMedia } from '@/features/meeting/useLocalMedia'
import { playTtsAudio } from '@/features/translation/playTtsAudio'
import { useLegacyChunkTranslator } from '@/features/translation/useLegacyChunkTranslator'
import { getDisplayName } from '@/lib/user'
import { BRAND } from '@/lib/brand'

export function Meeting({
  user,
  minutesLabel,
  roomId,
  tgtLang,
  guestName,
  onInvite,
  onLeave,
}: {
  user: User | null
  /** Payer's remaining minutes (signed-in users only). */
  minutesLabel?: string
  roomId: string
  tgtLang: string
  guestName: string
  onInvite: () => void
  onLeave: () => void
}) {
  const [mic, setMic] = useState(true)
  const [camera, setCamera] = useState(true)
  const [chat, setChat] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [originalText, setOriginalText] = useState('Listening to your speech...')
  const [translatedText, setTranslatedText] = useState(
    'আপনার কথা অনুবাদ করার জন্য অপেক্ষা করা হচ্ছে...',
  )

  const myDisplayName = getDisplayName(user) || guestName || 'You'
  const localStream = useLocalMedia({ camera, mic })

  const showCaption = (caption: TranslationCaption) => {
    setOriginalText(caption.original)
    setTranslatedText(caption.translated)
    if (caption.audio) playTtsAudio(caption.audio)
  }

  const { partnerConnected, partnerName, messages, sendChat, broadcastTranslation } =
    useLegacyRoomChannel({ roomId, myDisplayName, onTranslation: showCaption })

  useLegacyChunkTranslator({
    enabled: mic,
    stream: localStream,
    tgtLang,
    onTranslatingChange: setTranslating,
    onResult: (caption) => {
      setOriginalText(caption.original)
      setTranslatedText(caption.translated)
      broadcastTranslation(caption)
      if (caption.audio) playTtsAudio(caption.audio)
    },
  })

  return (
    <main className="flex min-h-screen flex-col bg-[#0b0e16] text-slate-100">
      <MeetingHeader
        roomId={roomId}
        partnerConnected={partnerConnected}
        partnerName={partnerName}
        minutesLabel={minutesLabel}
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="flex min-w-0 flex-1 flex-col p-4 lg:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[.2em] text-slate-600">
                LIVE SESSION
              </p>
              <h1 className="mt-1 text-lg font-semibold text-white">{BRAND.name} meeting</h1>
            </div>
            <span className="flex items-center gap-2 text-xs text-slate-400">
              <Users size={14} /> {partnerConnected ? '2 People' : '1 Person'}
            </span>
          </div>

          <div className="grid flex-1 gap-4 md:grid-cols-2">
            <VideoTile
              name={partnerConnected ? partnerName : 'Waiting for partner...'}
              initials={partnerName.slice(0, 2).toUpperCase()}
              color="bg-teal-900/60"
              active={partnerConnected}
              cameraOn={partnerConnected}
              isWaiting={!partnerConnected}
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
            originalText={originalText}
            translatedText={translatedText}
          />

          <ControlBar
            mic={mic}
            camera={camera}
            unreadCount={messages.length - 1}
            onToggleMic={() => setMic(!mic)}
            onToggleCamera={() => setCamera(!camera)}
            onInvite={onInvite}
            onToggleChat={() => setChat(!chat)}
            onLeave={onLeave}
          />
        </section>

        {chat && (
          <ChatPanel
            messages={messages}
            myDisplayName={myDisplayName}
            partnerConnected={partnerConnected}
            onSend={sendChat}
            onClose={() => setChat(false)}
          />
        )}
      </div>
    </main>
  )
}
