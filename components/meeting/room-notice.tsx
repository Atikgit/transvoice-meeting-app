import type { ReactNode } from 'react'
import Link from 'next/link'

export type NoticeAction = { label: string; onClick: () => void } | { label: string; href: string }

/** Status or error message in the room, with an optional recovery action. */
export function RoomNotice({
  tone,
  children,
  action,
  floating = false,
}: {
  tone: 'info' | 'error'
  children: ReactNode
  action?: NoticeAction
  /** Overlay at the top of the video area instead of inline. */
  floating?: boolean
}) {
  const color =
    tone === 'error'
      ? 'border-rose-500/30 bg-[#2a1520] text-rose-200'
      : 'border-cyan-300/30 bg-[#12222c] text-cyan-100'
  const actionClass = 'ml-2 font-semibold underline underline-offset-2'
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`${floating ? 'absolute inset-x-4 top-4 z-20 mx-auto lg:inset-x-6' : ''} max-w-xl rounded-lg border p-3 text-center text-sm shadow-lg ${color}`}
    >
      {children}
      {action &&
        ('href' in action ? (
          <Link href={action.href} className={actionClass}>
            {action.label}
          </Link>
        ) : (
          <button type="button" onClick={action.onClick} className={actionClass}>
            {action.label}
          </button>
        ))}
    </p>
  )
}
