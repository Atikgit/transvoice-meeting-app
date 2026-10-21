import type { User } from '@supabase/supabase-js'
import { Link2, LogOut, Plus, Video, Zap } from 'lucide-react'
import { Button } from '@/components/common/button'
import { Logo } from '@/components/common/logo'
import { getDisplayName } from '@/lib/user'

export function Dashboard({
  user,
  balance,
  onMeeting,
  onAuth,
  onPricing,
  onJoin,
  onSignOut,
}: {
  user: User | null
  balance: number
  onMeeting: () => void
  onAuth: () => void
  onPricing: () => void
  onJoin: () => void
  onSignOut: () => void
}) {
  return (
    <main className="min-h-screen bg-[#0b0e16] text-slate-100">
      <header className="flex h-[74px] items-center justify-between border-b border-white/[.08] px-5 lg:px-10">
        <Logo />
        <div className="flex items-center gap-3">
          <button onClick={onPricing} className="text-xs text-slate-400 hover:text-white">
            <span className="font-semibold text-cyan-300">{balance.toFixed(0)} min</span> remaining
          </button>
          {user ? (
            <Button variant="outline" onClick={onSignOut}>
              <LogOut size={14} />
              Sign out
            </Button>
          ) : (
            <Button variant="outline" onClick={onAuth}>
              Sign in
            </Button>
          )}
          <Button onClick={onMeeting}>
            <Plus size={16} />
            New meeting
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-10 lg:px-10">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <p className="font-mono text-xs uppercase tracking-[.2em] text-cyan-300">
              Your workspace
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
              {user
                ? `Welcome back, ${getDisplayName(user) || user.email?.split('@')[0]}`
                : 'Good morning, Guest'}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Start a translated conversation across 70+ languages.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onJoin}>
              <Link2 size={15} />
              Join with link
            </Button>
            <Button onClick={onMeeting}>
              <Video size={15} />
              Start meeting
            </Button>
          </div>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
            <p className="text-xs text-slate-500">Translation minutes</p>
            <div className="mt-3 flex items-end justify-between">
              <p className="text-3xl font-semibold text-white">
                {balance.toFixed(0)}
                <span className="text-sm font-normal text-slate-500"> mins</span>
              </p>
              <Zap className="text-cyan-300" size={20} />
            </div>
            <div className="mt-4 h-1.5 rounded-full bg-slate-800">
              <div
                className="h-full bg-cyan-300"
                style={{ width: `${Math.min(100, (balance / 100) * 100)}%` }}
              />
            </div>
            <button onClick={onPricing} className="mt-3 text-xs font-medium text-cyan-300">
              View plans →
            </button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
            <p className="text-xs text-slate-500">Inference Latency</p>
            <p className="mt-3 text-3xl font-semibold text-white">~650ms</p>
            <p className="mt-3 text-xs text-emerald-300">Triton Azure T4 GPU Active</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
            <p className="text-xs text-slate-500">Supported Languages</p>
            <p className="mt-3 text-3xl font-semibold text-white">70+</p>
            <p className="mt-3 text-xs text-slate-500">Neural Voice Dubbing enabled</p>
          </div>
        </div>
      </div>
    </main>
  )
}
