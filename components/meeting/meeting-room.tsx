'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useLocalParticipant,
  useRoomContext,
  usePersistentUserChoices,
  useRemoteParticipants,
  useTracks,
} from '@livekit/components-react'
import {
  ConnectionState,
  DisconnectReason,
  Track,
  VideoPresets,
  type RoomOptions,
} from 'livekit-client'
import { MonitorOff, MonitorUp } from 'lucide-react'
import { PricingModal } from '@/components/billing/pricing-modal'
import { InviteModal } from '@/components/invite/invite-modal'
import { ChatPanel } from '@/components/meeting/chat-panel'
import { MeetingHeader } from '@/components/meeting/meeting-header'
import { CallAgain } from '@/components/meeting/call-again'
import { Control } from '@/components/meeting/control-bar'
import { DeviceMenu } from '@/components/meeting/device-menu'
import { LanguageMenu } from '@/components/meeting/language-menu'
import { DebugOverlay } from '@/components/meeting/debug-overlay'
import { LatencyBadge } from '@/components/meeting/latency-badge'
import { MeetingLayout } from '@/components/meeting/meeting-layout'
import { ParticipantTile } from '@/components/meeting/participant-tile'
import { RoomNotice } from '@/components/meeting/room-notice'
import { VideoTile } from '@/components/meeting/video-tile'
import { routeToLoudspeaker } from '@/features/meeting/audio-output'
import { useAudioPlayback } from '@/features/meeting/useAudioPlayback'
import { useLiveKitToken } from '@/features/meeting/useLiveKitToken'
import { useWakeLock } from '@/features/meeting/useWakeLock'
import {
  deviceFromKind,
  describeMediaProblem,
  type MediaProblem,
} from '@/lib/meetings/media-errors'
import { sharedAudioContext, unlockAudio } from '@/features/translation/web-audio'
import { useMeetingChat } from '@/features/meeting/useMeetingChat'
import { captionText } from '@/features/translation/captions'
import type { OriginalAudioMode } from '@/features/translation/playback'
import { BETA_MESSAGE } from '@/lib/translation/gate'
import { useLiveTranslation } from '@/features/translation/useLiveTranslation'
import { saveLanguages } from '@/features/translation/language-api'
import { useTranslatedAudio } from '@/features/translation/useTranslatedAudio'
import { useTranslationStatus } from '@/features/translation/useTranslationStatus'
import { TranslationStatusLine } from '@/components/meeting/translation-status-line'
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
  /** How the speaker's original voice is treated while their translation plays (Settings). */
  originalAudioMode: OriginalAudioMode
  /** False while live translation is in private beta for this meeting's host. */
  translationEnabled: boolean
  /** Languages for this session (profile defaults; the room's menu changes them). */
  spokenLang: string
  listenLang: string
  /** Session state when the page loaded (LiveKit room metadata takes over once connected). */
  initialState: RoomState
  /** Host's balance (minutes) and label. */
  balance?: number
  minutesLabel?: string
  /** VAD_END_SILENCE_MS from the server environment (300–700, default 400). */
  vadEndSilenceMs?: number
  /** ?debug=1: show the translation overlay (any signed-in participant). */
  debug?: boolean
  /** Camera / mic choice from the lobby. */
  initialCamera: boolean
  initialMic: boolean
}

/** Media settings for every room (§8): simulcast + dynacast + adaptive stream, clean audio. */
export const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  publishDefaults: { simulcast: true },
  audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
}

/** Disconnects that are not a lost connection. */
const EXPECTED_DISCONNECTS = new Set<DisconnectReason>([
  DisconnectReason.CLIENT_INITIATED,
  DisconnectReason.ROOM_DELETED,
  DisconnectReason.PARTICIPANT_REMOVED,
  DisconnectReason.DUPLICATE_IDENTITY,
])

/** Screen capture exists on desktop browsers only. */
function canShareScreen(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia)
}

/**
 * /m/[meetingId]: joins the session's LiveKit room. Tracks publish on join, but the session is
 * "ready" until the host presses Start (state lives in room metadata, set by the server).
 */
export function MeetingRoom(props: MeetingRoomProps) {
  const [attempt, setAttempt] = useState(0)
  const token = useLiveKitToken(props.sessionId, attempt)
  const [lost, setLost] = useState(false)
  // The first connection never completed (server unreachable, or no answer within 15 s).
  const [connectFailed, setConnectFailed] = useState(false)
  const connectedOnce = useRef(false)
  const [mediaProblem, setMediaProblem] = useState<MediaProblem | null>(null)
  const retryConnection = () => {
    connectedOnce.current = false
    setConnectFailed(false)
    setAttempt((n) => n + 1)
  }
  // Devices chosen in the lobby (LiveKit persistent choices); on/off comes from the lobby form.
  const { userChoices } = usePersistentUserChoices({ preventSave: true })
  const device = (id: string) => (id && id !== 'default' ? { deviceId: id } : {})

  if (connectFailed) {
    return (
      <RoomShell {...props} statusLabel="Not connected">
        <RoomNotice tone="error" action={{ label: 'Retry', onClick: retryConnection }}>
          Can&apos;t reach the meeting server. Check your connection and try again.
        </RoomNotice>
      </RoomShell>
    )
  }

  // LiveKit gave up reconnecting after it had been connected (not a deliberate leave).
  if (lost) {
    return (
      <RoomShell {...props}>
        <div className="space-y-4">
          <RoomNotice tone="error" action={{ label: 'Back to dashboard', href: '/dashboard' }}>
            Connection lost. The meeting could not reconnect.
          </RoomNotice>
          <CallAgain meetingId={props.meetingId} userId={props.userId} />
        </div>
      </RoomShell>
    )
  }

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
      options={ROOM_OPTIONS}
      onDisconnected={(reason) => {
        if (reason === undefined || EXPECTED_DISCONNECTS.has(reason)) return
        if (connectedOnce.current) setLost(true)
        else setConnectFailed(true)
      }}
      onError={() => {
        if (!connectedOnce.current) setConnectFailed(true)
      }}
      onMediaDeviceFailure={(failure, kind) =>
        setMediaProblem(describeMediaProblem(failure, deviceFromKind(kind)))
      }
      audio={
        props.initialMic
          ? { ...ROOM_OPTIONS.audioCaptureDefaults, ...device(userChoices.audioDeviceId) }
          : false
      }
      video={
        props.initialCamera
          ? { ...ROOM_OPTIONS.videoCaptureDefaults, ...device(userChoices.videoDeviceId) }
          : false
      }
      className="contents"
    >
      <FirstConnectionWatch connectedRef={connectedOnce} onTimeout={() => setConnectFailed(true)} />
      <RoomView
        {...props}
        mediaProblem={mediaProblem}
        onMediaProblemHandled={() => setMediaProblem(null)}
      />
      <RoomAudioRenderer />
    </LiveKitRoom>
  )
}

/** How long the first connection may take before we say the server cannot be reached. */
export const FIRST_CONNECT_TIMEOUT_MS = 15_000

/** Marks the first successful connection; fires onTimeout if it has not happened in time. */
function FirstConnectionWatch({
  connectedRef,
  onTimeout,
}: {
  connectedRef: { current: boolean }
  onTimeout: () => void
}) {
  const connection = useConnectionState()
  useEffect(() => {
    if (connection === ConnectionState.Connected) {
      connectedRef.current = true
      return
    }
    if (connectedRef.current) return // dropped later: LiveKit reconnects, the grace rules apply
    const timer = setTimeout(onTimeout, FIRST_CONNECT_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [connection, connectedRef, onTimeout])
  return null
}

/** Layout without a LiveKit connection (connecting / error). */
function RoomShell({
  title,
  statusLabel = 'Connecting…',
  children,
}: Pick<MeetingRoomProps, 'title'> & { statusLabel?: string; children: React.ReactNode }) {
  return (
    <main className="grid h-dvh grid-rows-[auto_1fr] overflow-hidden bg-[#0b0e16] text-slate-100">
      <MeetingHeader title={title} status="waiting" statusLabel={statusLabel} />
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
  originalAudioMode,
  translationEnabled,
  spokenLang,
  listenLang,
  initialState,
  balance = 0,
  minutesLabel,
  mediaProblem,
  onMediaProblemHandled,
  debug = false,
  vadEndSilenceMs,
}: MeetingRoomProps & {
  mediaProblem: MediaProblem | null
  onMediaProblemHandled: () => void
}) {
  const router = useRouter()
  const [chatOpen, setChatOpen] = useState(false)
  const [modal, setModal] = useState<'invite' | 'pricing' | null>(null)

  const room = useRoomContext()
  const connection = useConnectionState()
  const remotes = useRemoteParticipants()
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant()
  // Screen shares first, then remote cameras, your own camera last (mobile picture-in-picture).
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  )
  const ordered = [
    ...tracks.filter((t) => t.source === Track.Source.ScreenShare),
    ...tracks.filter((t) => t.source === Track.Source.Camera && !t.participant.isLocal),
    ...tracks.filter((t) => t.source === Track.Source.Camera && t.participant.isLocal),
  ]
  const session = useRoomState(sessionId, initialState)
  const chat = useMeetingChat({ roomName, myName: displayName || 'You' })

  const languages = useTranslationStatus(sessionId)
  const audio = useTranslatedAudio({ sessionId, originalAudioMode })
  const translation = useLiveTranslation({
    sessionId,
    status: session.state.status,
    enabled: translationEnabled,
    endSilenceMs: vadEndSilenceMs,
    playingTranslation: audio.playing, // echo safety: never listen while a clip plays
    onTranscript: audio.addOwnTranscript,
  })
  const captions = captionText(audio.captions)
  const live = session.state.status === 'live'
  const ended = session.state.status === 'ended'
  const elapsed = useElapsedSeconds(live ? session.state.startedAt : null)
  const playback = useAudioPlayback()
  useWakeLock(live)
  useEffect(() => {
    // Phones play call audio through the earpiece by default; use the loudspeaker where allowed.
    if (connection === ConnectionState.Connected)
      void routeToLoudspeaker(room, sharedAudioContext())
  }, [connection, room])
  const partner = remotes[0]
  const partnerConnected = Boolean(partner)

  // First connection says "Connecting…" (the room is not ready yet); "Reconnecting…" is only for
  // a connection that existed and dropped.
  const statusLabel =
    connection === ConnectionState.Connecting
      ? 'Connecting…'
      : connection === ConnectionState.Reconnecting
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
          {mediaProblem && (
            <RoomNotice
              tone="error"
              floating
              action={
                mediaProblem.recovery === 'reload'
                  ? { label: 'Reload', onClick: () => window.location.reload() }
                  : {
                      label: 'Try again',
                      onClick: () => {
                        onMediaProblemHandled()
                        void (
                          mediaProblem.device === 'camera'
                            ? localParticipant.setCameraEnabled(true)
                            : localParticipant.setMicrophoneEnabled(true)
                        ).catch(() => {}) // a new failure arrives through onMediaDeviceFailure
                      },
                    }
              }
            >
              {mediaProblem.message}
            </RoomNotice>
          )}
          {playback.blocked && connection === ConnectionState.Connected && (
            <RoomNotice
              tone="info"
              floating
              action={{ label: 'Tap to enable audio', onClick: () => void playback.enable() }}
            >
              Your browser is blocking sound.
            </RoomNotice>
          )}
          {translation.notice?.code === 'PAYER_NO_MINUTES' && (
            <RoomNotice
              tone="error"
              floating
              action={
                translation.notice.payerIsSpeaker
                  ? { label: 'Subscribe', onClick: () => setModal('pricing') }
                  : { label: 'Message host', onClick: () => setChatOpen(true) }
              }
              secondaryAction={
                translation.notice.payerIsSpeaker
                  ? undefined
                  : { label: 'Subscribe', onClick: () => setModal('pricing') }
              }
            >
              {translation.notice.text}
            </RoomNotice>
          )}
          {connection === ConnectionState.Reconnecting && (
            <RoomNotice tone="info" floating>
              Reconnecting… your call continues as soon as the connection is back.
            </RoomNotice>
          )}
          {ended && session.state.endReason === 'reconnect_timeout' && (
            <div className="absolute inset-x-4 top-4 z-20 mx-auto max-w-xl space-y-3 rounded-lg border border-rose-500/30 bg-[#2a1520] p-4 text-center text-sm text-rose-200 shadow-lg">
              <p role="alert">The connection was lost and the meeting ended.</p>
              <CallAgain meetingId={meetingId} userId={userId} />
            </div>
          )}
          {ended && session.state.endReason !== 'reconnect_timeout' && (
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
        ...(partnerConnected
          ? []
          : [
              <VideoTile
                key="waiting"
                name="Waiting for partner..."
                initials="?"
                color="bg-teal-900/60"
                isWaiting
                // The host's call to action while the room is empty; same modal as the control bar.
                onInvite={role === 'host' ? () => setModal('invite') : undefined}
              />,
            ]),
        ...ordered.map((trackRef, index) => (
          <ParticipantTile
            key={`${trackRef.participant.identity}-${trackRef.source}`}
            trackRef={trackRef}
            colorIndex={index}
            pipOnMobile={trackRef.participant.isLocal && index === ordered.length - 1}
          />
        )),
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
        actions: (
          <LanguageMenu
            sessionId={sessionId}
            // What the server stores; the profile values are only the first guess before it answers.
            spokenLang={languages.status?.me.spokenLang ?? spokenLang}
            listenLang={languages.status?.me.listenLang ?? listenLang}
            onConfirmed={() => void languages.refresh()}
          />
        ),
        statusLine: (
          <TranslationStatusLine
            status={languages.status}
            onFix={(listenLang) =>
              void saveLanguages(sessionId, { listenLang }).then(languages.refresh)
            }
          />
        ),
        translating: translation.translating,
        originalText: captions.original,
        translatedText: captions.translated,
        placeholder:
          (translationEnabled ? undefined : BETA_MESSAGE) ??
          translation.notice?.text ??
          (audio.unavailable
            ? 'Translation is temporarily unavailable. It resumes by itself.'
            : undefined) ??
          (live
            ? translation.speaking
              ? 'Listening…'
              : 'Speak naturally — your partner hears you in their language.'
            : 'Translation starts when the meeting starts.'),
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
        extra: (
          <>
            {canShareScreen() && (
              <Control
                label={isScreenShareEnabled ? 'Stop sharing screen' : 'Share screen'}
                icon={
                  isScreenShareEnabled ? (
                    <MonitorOff size={17} aria-hidden />
                  ) : (
                    <MonitorUp size={17} aria-hidden />
                  )
                }
                tone={isScreenShareEnabled ? 'on' : 'neutral'}
                pressed={isScreenShareEnabled}
                iconOnly
                onClick={() =>
                  void localParticipant
                    .setScreenShareEnabled(!isScreenShareEnabled, { audio: true })
                    .catch(() => {})
                }
              />
            )}
            <DeviceMenu />
          </>
        ),
        onInvite: () => setModal('invite'),
        onToggleChat: () => setChatOpen(!chatOpen),
        onStart: () => {
          // Inside the click: unlocks audio on iOS Safari / Android Chrome.
          void unlockAudio()
          void room.startAudio().catch(() => {})
          session.start()
        },
        onEnd: session.end,
        onLeave: () => router.push('/dashboard'),
      }}
    >
      {process.env.NODE_ENV !== 'production' && <LatencyBadge sample={audio.latency} />}
      {debug && (
        <DebugOverlay
          sessionId={sessionId}
          spokenLang={spokenLang}
          listenLang={listenLang}
          status={languages.status}
        />
      )}
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
