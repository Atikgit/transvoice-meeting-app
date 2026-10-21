import type { ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'danger'

const styles: Record<ButtonVariant, string> = {
  primary: 'bg-cyan-300 text-slate-950 hover:bg-cyan-200',
  ghost: 'bg-white/[.06] text-slate-200 hover:bg-white/[.1]',
  outline: 'border border-white/10 bg-white/[.04] text-slate-200 hover:bg-white/[.09]',
  danger: 'bg-rose-500 text-white hover:bg-rose-400',
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  className = '',
  disabled = false,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: ButtonVariant
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  )
}
