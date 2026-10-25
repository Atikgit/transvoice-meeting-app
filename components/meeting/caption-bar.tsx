import { Sparkles } from 'lucide-react'

/** Keeps the latest words of a running caption (older text scrolls out of the 2-line box). */
export function appendCaption(previous: string, next: string, maxChars = 400): string {
  const text = previous ? `${previous} ${next.trim()}` : next.trim()
  return text.length > maxChars ? text.slice(text.length - maxChars) : text
}

// Two lines, newest at the bottom, older text fading out at the top.
const twoLines =
  'flex flex-col justify-end overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_55%)]'

/** Live captions directly above the control bar: 2 lines original + 2 lines translated. */
export function CaptionBar({
  translating,
  originalText,
  translatedText,
  placeholder,
  actions,
  statusLine,
}: {
  translating: boolean
  originalText: string
  translatedText: string
  /** Shown while there are no captions yet. */
  placeholder?: string
  /** Controls at the right of the header (language menu). */
  actions?: React.ReactNode
  /** What translation is doing right now (languages, server-confirmed). */
  statusLine?: React.ReactNode
}) {
  const empty = !originalText && !translatedText

  return (
    <div
      data-testid="caption-bar"
      className="mx-4 mt-3 rounded-2xl border border-cyan-300/20 bg-[#151d2c] px-4 py-2.5 lg:mx-6"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
          <Sparkles size={12} aria-hidden />{' '}
          {translating ? 'Translating live...' : 'Live translation'}
        </div>
        {actions}
      </div>
      {statusLine}
      {empty ? (
        <p className="mt-1 text-sm leading-5 text-slate-500">{placeholder}</p>
      ) : (
        <>
          <div className={`mt-1 h-10 ${twoLines}`}>
            <p className="text-sm leading-5 text-slate-400">{originalText}</p>
          </div>
          <div className={`h-12 ${twoLines}`} aria-live="polite">
            <p className="text-base leading-6 font-medium text-white">{translatedText}</p>
          </div>
        </>
      )}
    </div>
  )
}
