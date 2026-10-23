import { LockKeyhole } from 'lucide-react'
import { Logo } from '@/components/common/logo'

export function MeetingHeader({
  roomId,
  partnerConnected,
  partnerName,
  minutesLabel,
  statusLabel,
  live,
}: {
  roomId: string
  partnerConnected: boolean
  partnerName: string
  minutesLabel?: string
  /** "Ready" / "Live 00:00" / "Waiting for partner…" */
  statusLabel: string
  live: boolean
}) {
  return (
    <header className="flex h-[70px] items-center justify-between border-b border-white/[.08] px-5 lg:px-8">
      <div className="flex items-center gap-4">
        <Logo />
        <span className="hidden h-5 w-px bg-white/10 sm:block" />
        <span className="hidden text-sm font-medium text-slate-200 sm:block">Room: {roomId}</span>
        <span className="flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[11px] text-emerald-200">
          <LockKeyhole size={12} /> Encrypted Session
        </span>
      </div>
      <div className="flex items-center gap-3">
        {minutesLabel && (
          <span className="hidden text-xs font-semibold text-cyan-300 sm:block">
            {minutesLabel}
          </span>
        )}
        <span
          title={partnerConnected ? `Connected with ${partnerName}` : undefined}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${live || partnerConnected ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-300'}`}
        >
          <span
            className={`size-2 rounded-full ${live ? 'animate-pulse bg-rose-400' : partnerConnected ? 'bg-emerald-400' : 'animate-ping bg-amber-400'}`}
          />
          <span className="tabular-nums">{statusLabel}</span>
        </span>
      </div>
    </header>
  )
}
