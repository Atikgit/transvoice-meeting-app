import type { ReactNode } from 'react'
import { MicOff, Signal, SignalLow, SignalMedium, Users } from 'lucide-react'

export type TileQuality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown'

const QUALITY: Record<TileQuality, { icon: typeof Signal; className: string; label: string }> = {
  excellent: { icon: Signal, className: 'text-emerald-300', label: 'Excellent connection' },
  good: { icon: SignalMedium, className: 'text-amber-300', label: 'Good connection' },
  poor: { icon: SignalLow, className: 'text-rose-300', label: 'Poor connection' },
  lost: { icon: SignalLow, className: 'text-rose-500', label: 'Connection lost' },
  unknown: { icon: Signal, className: 'text-slate-500', label: 'Connection quality unknown' },
}

/**
 * One participant: video (or an avatar when the camera is off), name, mic state, connection
 * quality, and a cyan ring while speaking.
 */
export function VideoTile({
  name,
  initials,
  color,
  video,
  speaking = false,
  micMuted = false,
  quality,
  isWaiting = false,
  pipOnMobile = false,
  label,
}: {
  name: string
  initials: string
  color: string
  /** The video element, or nothing for the avatar placeholder. */
  video?: ReactNode
  /** Active-speaker highlight. */
  speaking?: boolean
  micMuted?: boolean
  quality?: TileQuality
  isWaiting?: boolean
  /** Shown as the small mobile picture-in-picture: no footer, smaller avatar. */
  pipOnMobile?: boolean
  /** Secondary line under the name ("Camera off", "Screen share"). */
  label?: string
}) {
  const q = quality ? QUALITY[quality] : null

  return (
    <div
      data-testid="video-tile"
      data-speaking={speaking || undefined}
      className={`relative h-full w-full overflow-hidden rounded-2xl border transition-shadow ${speaking ? 'border-cyan-300 shadow-[0_0_0_2px_rgba(103,232,249,.6),0_0_24px_rgba(103,232,249,.25)]' : 'border-white/10'} ${color}`}
    >
      {video ? (
        <div className="absolute inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-cover">
          {video}
        </div>
      ) : isWaiting ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-400">
          <div className="flex size-14 animate-pulse items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 text-cyan-300">
            <Users size={24} aria-hidden />
          </div>
          <p className="text-sm font-medium text-slate-200">Waiting for partner to join...</p>
          <p className="text-xs text-slate-500">
            Click &apos;Invite Partner&apos; below to share link
          </p>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center">
          <div
            aria-hidden
            className={`flex size-24 items-center justify-center rounded-full border-4 border-white/15 bg-cyan-700 text-2xl font-semibold text-white ${pipOnMobile ? 'max-md:size-12 max-md:border-2 max-md:text-sm' : ''}`}
          >
            {initials}
          </div>
        </div>
      )}

      <div
        className={`absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-slate-950/90 to-transparent p-4 pt-12 ${pipOnMobile ? 'max-md:hidden' : ''}`}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{name}</p>
          {label && <p className="text-[11px] text-slate-400">{label}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {q && (
            <span title={q.label} className={`rounded-lg bg-slate-950/60 p-2 ${q.className}`}>
              <q.icon size={14} aria-label={q.label} />
            </span>
          )}
          {micMuted && (
            <span title="Microphone muted" className="rounded-lg bg-slate-950/60 p-2 text-rose-400">
              <MicOff size={14} aria-label="Microphone muted" />
            </span>
          )}
        </div>
      </div>
      {micMuted && pipOnMobile && (
        <span className="absolute top-1.5 right-1.5 rounded-md bg-slate-950/70 p-1 text-rose-400 md:hidden">
          <MicOff size={12} aria-label="Microphone muted" />
        </span>
      )}
    </div>
  )
}
