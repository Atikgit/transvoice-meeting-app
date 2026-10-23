import type { User } from '@supabase/supabase-js'
import { LogOut, Plus } from 'lucide-react'
import { Button } from '@/components/common/button'
import { Logo } from '@/components/common/logo'
import { DashboardOverview } from '@/components/dashboard/dashboard-overview'
import { getDisplayName } from '@/lib/user'

/** Legacy single-page dashboard used by the `/` shell. The routed version is app/dashboard. */
export function Dashboard({
  user,
  balance,
  onMeeting,
  onAuth,
  onPricing,
  onJoin,
  onInvite,
  onSignOut,
}: {
  user: User | null
  balance: number
  onMeeting: () => void
  onAuth: () => void
  onPricing: () => void
  onJoin: () => void
  onInvite: () => void
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

      <DashboardOverview
        greeting={
          user
            ? `Welcome back, ${getDisplayName(user) || user.email?.split('@')[0]}`
            : 'Good morning, Guest'
        }
        balance={balance}
        onMeeting={onMeeting}
        onPricing={onPricing}
        onJoin={onJoin}
        canInvite={Boolean(user) && balance > 0}
        onInvite={onInvite}
      />
    </main>
  )
}
