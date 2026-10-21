import { AudioLines } from 'lucide-react'

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-9 items-center justify-center rounded-xl bg-cyan-300 text-slate-950">
        <AudioLines size={19} strokeWidth={2.5} />
      </div>
      <div>
        <p className="font-mono text-[10px] font-bold tracking-[.22em] text-cyan-300">TRANSVOICE</p>
        <p className="text-[10px] text-slate-500">Meet without limits</p>
      </div>
    </div>
  )
}
