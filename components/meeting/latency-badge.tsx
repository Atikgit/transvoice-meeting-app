import type { LatencySample } from '@/features/translation/metrics'

/** Development-only: speech end → caption → first sound, as seen by this listener. */
export function LatencyBadge({ sample }: { sample: LatencySample | null }) {
  if (!sample) return null
  const ms = (value?: number) => (value === undefined ? '…' : `${value} ms`)
  return (
    <div
      data-testid="latency-badge"
      className="fixed top-16 left-3 z-50 rounded-md bg-slate-950/80 px-2 py-1 font-mono text-[10px] text-cyan-200"
    >
      caption {ms(sample.captionMs)} · audio {ms(sample.audioMs)}
    </div>
  )
}
