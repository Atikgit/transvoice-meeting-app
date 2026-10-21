import { Sparkles } from 'lucide-react'

export function CaptionBar({
  translating,
  originalText,
  translatedText,
}: {
  translating: boolean
  originalText: string
  translatedText: string
}) {
  return (
    <div className="relative mt-4 rounded-2xl border border-cyan-300/20 bg-[#151d2c] p-4">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
        <Sparkles size={13} /> {translating ? 'Translating live...' : 'Live translation'}
      </div>
      <p className="mt-2 text-sm text-slate-400">{originalText}</p>
      <p className="mt-1 text-base font-medium text-white">{translatedText}</p>
    </div>
  )
}
