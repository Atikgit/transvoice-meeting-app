import { Link2, Lock, UserPlus, Video, Zap } from 'lucide-react'
import { Button } from '@/components/common/button'
import { UserManual } from '@/components/dashboard/user-manual'
import { LANGUAGE_COUNT_LABEL, LANGUAGES_AND_VOICES } from '@/lib/transvoice/languages'

/** Workspace body: greeting, meeting actions and the three summary cards. */
export function DashboardOverview({
  greeting,
  balance,
  canInvite,
  onMeeting,
  startingMeeting = false,
  onPricing,
  onJoin,
  onInvite,
}: {
  greeting: string
  balance: number
  /** False at 0 available minutes: inviting is replaced by "Get minutes to invite" (Rule 1). */
  canInvite: boolean
  onMeeting: () => void
  /** The meeting is being created (button busy). */
  startingMeeting?: boolean
  onPricing: () => void
  onJoin: () => void
  onInvite: () => void
}) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-10 lg:px-10">
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-[.2em] text-cyan-300">
            Your workspace
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">{greeting}</h1>
          <p className="mt-2 text-sm text-slate-500">
            Start a translated conversation in {LANGUAGES_AND_VOICES}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onJoin}>
            <Link2 size={15} />
            Join with link
          </Button>
          {canInvite ? (
            <Button variant="outline" onClick={onInvite}>
              <UserPlus size={15} />
              Invite Partner
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={onPricing}
              className="text-slate-400"
              title="You need available minutes to invite a partner"
            >
              <Lock size={15} />
              Get minutes to invite
            </Button>
          )}
          <Button onClick={onMeeting} disabled={startingMeeting} aria-busy={startingMeeting}>
            <Video size={15} />
            {startingMeeting ? 'Opening lobby…' : 'Start meeting'}
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
          <p className="mt-3 text-3xl font-semibold text-white">{LANGUAGE_COUNT_LABEL}</p>
          <p className="mt-3 text-xs text-slate-500">
            {LANGUAGES_AND_VOICES} · neural voice dubbing
          </p>
        </div>
      </div>

      <UserManual />
    </div>
  )
}
