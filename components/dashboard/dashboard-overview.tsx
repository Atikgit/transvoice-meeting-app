import { Link2, Video, Zap } from 'lucide-react'
import { Button } from '@/components/common/button'

/** Workspace body: greeting, meeting actions and the three summary cards. */
export function DashboardOverview({
  greeting,
  balance,
  onMeeting,
  onPricing,
  onJoin,
}: {
  greeting: string
  balance: number
  onMeeting: () => void
  onPricing: () => void
  onJoin: () => void
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
  )
}
