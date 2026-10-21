import Link from 'next/link'
import { LogOut } from 'lucide-react'
import { signOut } from '@/app/(auth)/actions'
import { Logo } from '@/components/common/logo'
import { NavLinks } from '@/components/dashboard/nav-links'

/** Header for the signed-in /dashboard area. */
export function AppHeader({ minutesLabel }: { minutesLabel: string }) {
  return (
    <header className="flex min-h-[74px] flex-wrap items-center justify-between gap-3 border-b border-white/[.08] px-5 py-3 lg:px-10">
      <div className="flex items-center gap-6">
        <Link href="/dashboard" aria-label="TransVoice dashboard">
          <Logo />
        </Link>
        <NavLinks />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-400">
          <span className="font-semibold text-cyan-300">{minutesLabel}</span>
        </span>
        <form action={signOut}>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/[.09]"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </form>
      </div>
    </header>
  )
}
