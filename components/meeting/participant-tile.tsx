'use client'

import {
  isTrackReference,
  useConnectionQualityIndicator,
  useIsSpeaking,
  useTrackMutedIndicator,
  VideoTrack,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import { VideoTile, type TileQuality } from '@/components/meeting/video-tile'

const COLORS = ['bg-teal-900/60', 'bg-indigo-900/60', 'bg-sky-900/60', 'bg-violet-900/60']

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (
    (parts.length > 1 ? parts[0]![0]! + parts.at(-1)![0]! : name.slice(0, 2)).toUpperCase() || '?'
  )
}

/** A LiveKit participant's camera or screen share, with speaking, mic and quality indicators. */
export function ParticipantTile({
  trackRef,
  pipOnMobile = false,
  colorIndex = 0,
}: {
  trackRef: TrackReferenceOrPlaceholder
  pipOnMobile?: boolean
  colorIndex?: number
}) {
  const participant = trackRef.participant
  const speaking = useIsSpeaking(participant)
  const { quality } = useConnectionQualityIndicator({ participant })
  const mic = useTrackMutedIndicator({ participant, source: Track.Source.Microphone })

  const screenShare = trackRef.source === Track.Source.ScreenShare
  const hasVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted
  const baseName = participant.name || 'Participant'
  const name = participant.isLocal ? `${baseName} (You)` : baseName

  return (
    <VideoTile
      name={screenShare ? `${baseName}'s screen` : name}
      initials={participant.isLocal ? 'You' : initialsOf(baseName)}
      color={COLORS[colorIndex % COLORS.length]!}
      video={
        hasVideo ? (
          <VideoTrack
            trackRef={trackRef}
            // Mirror only your own camera, as in a mirror (never a screen share).
            className={participant.isLocal && !screenShare ? '-scale-x-100' : undefined}
          />
        ) : undefined
      }
      speaking={speaking && !screenShare}
      micMuted={!screenShare && mic.isMuted}
      quality={participant.isLocal || screenShare ? undefined : (quality as TileQuality)}
      pipOnMobile={pipOnMobile}
      label={screenShare ? 'Screen share' : hasVideo ? undefined : 'Camera off'}
    />
  )
}
