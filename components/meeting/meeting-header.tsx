import Image from 'next/image'
import { LockKeyhole } from 'lucide-react'
import { BrandWordmark } from '@/components/brand/brand-wordmark'

export type RoomStatus = 'waiting' | 'ready' | 'live'

const PILL: Record<RoomStatus, { pill: string; dot: string }> = {
  waiting: { pill: 'bg-amber-400/15 text-amber-300', dot: 'animate-ping bg-amber-400' },
  ready: { pill: 'bg-emerald-400/15 text-emerald-300', dot: 'bg-emerald-400' },
  live: { pill: 'bg-rose-500/15 text-rose-200', dot: 'animate-pulse bg-rose-400' },
}

/** Room header: brand, meeting name and "Encrypted session" left; status pill right. */
export function MeetingHeader({
  title,
  status,
  statusLabel,
  minutesLabel,
}: {
  title: string
  status: RoomStatus
  /** "Ready" / "Live 00:00" / "Waiting for partner…" */
  statusLabel: string
  /** Host's remaining minutes, when known (wide screens only). */
  minutesLabel?: string
}) {
  const { pill, dot } = PILL[status]

  return (
    <header
      data-testid="meeting-header"
      className="flex h-14 items-center justify-between gap-3 border-b border-white/[.08] px-4 md:h-[70px] lg:px-6"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Image
          src="/brand/logo-192.png"
          alt=""
          width={32}
          height={32}
          loading="eager"
          className="size-8 shrink-0 rounded-lg"
        />
        <BrandWordmark className="hidden shrink-0 text-[11px] sm:inline" />
        <span aria-hidden className="hidden h-5 w-px shrink-0 bg-white/10 sm:block" />
        <span className="min-w-0 truncate text-sm font-medium text-slate-200">{title}</span>
        <span
          title="Encrypted session"
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[11px] text-emerald-200"
        >
          <LockKeyhole size={12} aria-hidden />
          <span className="sr-only md:not-sr-only">Encrypted session</span>
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {minutesLabel && (
          <span className="hidden text-xs font-semibold text-cyan-300 lg:block">
            {minutesLabel}
          </span>
        )}
        <span
          role="status"
          data-testid="room-status"
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${pill}`}
        >
          <span aria-hidden className={`size-2 rounded-full ${dot}`} />
          <span className="tabular-nums">{statusLabel}</span>
        </span>
      </div>
    </header>
  )
}
