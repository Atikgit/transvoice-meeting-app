import type { ReactNode } from 'react'
import {
  Camera,
  CameraOff,
  Hourglass,
  MessageCircle,
  Mic,
  MicOff,
  PhoneOff,
  Play,
  Square,
  UserPlus,
} from 'lucide-react'
import type { MeetingRole } from '@/lib/meetings/load'

type Tone = 'neutral' | 'on' | 'off' | 'primary' | 'danger'

const TONES: Record<Tone, string> = {
  neutral: 'border-white/10 bg-white/[.04] text-slate-200 hover:bg-white/[.09]',
  on: 'border-cyan-300/40 bg-cyan-300/15 text-cyan-200 hover:bg-cyan-300/25',
  off: 'border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25',
  primary: 'border-cyan-300 bg-cyan-300 text-slate-950 hover:bg-cyan-200',
  danger: 'border-rose-500 bg-rose-500 text-white hover:bg-rose-400',
}

/** One control: same height everywhere; the text label is hidden below 768px (icon only). */
export function Control({
  label,
  text,
  icon,
  tone = 'neutral',
  onClick,
  pressed,
  disabled,
  badge,
  iconOnly = false,
}: {
  /** Accessible name (also the tooltip). */
  label: string
  /** Visible text on desktop (defaults to the label). */
  text?: string
  icon: ReactNode
  tone?: Tone
  onClick: () => void
  pressed?: boolean
  disabled?: boolean
  badge?: number
  iconOnly?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={`relative inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-50 ${iconOnly ? '' : 'md:px-4'} ${TONES[tone]}`}
    >
      {icon}
      {!iconOnly && (
        <span aria-hidden className="hidden md:inline">
          {text ?? label}
        </span>
      )}
      {badge ? (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-cyan-400 text-[10px] font-bold text-slate-950"
        >
          {badge}
        </span>
      ) : null}
    </button>
  )
}

/**
 * Centered meeting controls: mic, camera, Invite Partner, Chat, Start / End meeting (host) or
 * "Waiting for host to start…" (guests), Leave.
 */
export function ControlBar({
  mic,
  camera,
  unreadCount,
  role,
  live,
  ended = false,
  busy = false,
  onToggleMic,
  onToggleCamera,
  onInvite,
  onToggleChat,
  onStart,
  onEnd,
  onLeave,
  extra,
}: {
  mic: boolean
  camera: boolean
  unreadCount: number
  role: MeetingRole
  /** The host started the session. */
  live: boolean
  /** The session is over: no Start / End / waiting. */
  ended?: boolean
  /** Start / End in progress. */
  busy?: boolean
  onToggleMic: () => void
  onToggleCamera: () => void
  onInvite: () => void
  onToggleChat: () => void
  onStart: () => void
  onEnd: () => void
  onLeave: () => void
  /** Extra controls after the camera (screen share, devices). */
  extra?: ReactNode
}) {
  return (
    <nav
      aria-label="Meeting controls"
      data-testid="control-bar"
      className="mt-3 border-t border-white/[.08] bg-[#0b0e16] px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto flex max-w-full items-center justify-center gap-2 overflow-x-auto">
        <Control
          label={mic ? 'Mute microphone' : 'Unmute microphone'}
          icon={mic ? <Mic size={18} aria-hidden /> : <MicOff size={18} aria-hidden />}
          tone={mic ? 'on' : 'off'}
          pressed={mic}
          onClick={onToggleMic}
          iconOnly
        />
        <Control
          label={camera ? 'Turn off camera' : 'Turn on camera'}
          icon={camera ? <Camera size={18} aria-hidden /> : <CameraOff size={18} aria-hidden />}
          tone={camera ? 'on' : 'off'}
          pressed={camera}
          onClick={onToggleCamera}
          iconOnly
        />
        {extra}
        <Control
          label="Invite Partner"
          icon={<UserPlus size={17} aria-hidden />}
          onClick={onInvite}
        />
        <Control
          label={unreadCount > 0 ? `Chat, ${unreadCount} messages` : 'Chat'}
          text="Chat"
          icon={<MessageCircle size={17} aria-hidden />}
          onClick={onToggleChat}
          badge={unreadCount}
        />

        {ended ? null : role === 'host' ? (
          live ? (
            <Control
              label="End meeting"
              icon={<Square size={16} aria-hidden />}
              tone="danger"
              onClick={onEnd}
              disabled={busy}
            />
          ) : (
            <Control
              label="Start"
              text={busy ? 'Starting…' : 'Start'}
              icon={<Play size={17} aria-hidden />}
              tone="primary"
              onClick={onStart}
              disabled={busy}
            />
          )
        ) : (
          !live && (
            <span
              role="status"
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 text-sm text-amber-200"
            >
              <Hourglass size={16} aria-hidden />
              <span className="md:hidden">Waiting for host…</span>
              <span className="hidden md:inline">Waiting for host to start…</span>
            </span>
          )
        )}

        <Control label="Leave" icon={<PhoneOff size={17} aria-hidden />} onClick={onLeave} />
      </div>
    </nav>
  )
}
