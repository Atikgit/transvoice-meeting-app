import type { ReactNode } from 'react'
import { Logo } from '@/components/common/logo'

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0b0e16] px-4 py-10">
      <div className="w-full max-w-md">
        <Logo />
        <div className="mt-8 rounded-3xl border border-white/10 bg-[#151b29] p-6 shadow-2xl sm:p-8">
          <h1 className="text-xl font-semibold text-white">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-slate-400">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-5 text-center text-sm text-slate-400">{footer}</div>}
      </div>
    </main>
  )
}

export const inputClass =
  'w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-300'

export function FormMessage({ tone, children }: { tone: 'error' | 'notice'; children: ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={
        tone === 'error'
          ? 'mb-4 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300'
          : 'mb-4 rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-3 text-sm text-cyan-200'
      }
    >
      {children}
    </p>
  )
}
