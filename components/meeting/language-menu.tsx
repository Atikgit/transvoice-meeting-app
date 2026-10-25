'use client'

import { useId, useState } from 'react'
import { Languages } from 'lucide-react'
import { saveLanguages } from '@/features/translation/language-api'
import { languageOptions, spokenLanguageOptions } from '@/lib/transvoice/languages'

const selectClass =
  'w-full rounded-lg border border-white/10 bg-[#151c2a] px-2 py-2 text-xs text-slate-200 outline-none focus:border-cyan-300'

/**
 * "Live translation" dropdown in the caption bar: change what you speak and what you hear
 * during the meeting. Applies from your next sentence; your saved settings stay as they are.
 * The values shown are the ones the server has stored (the room refreshes them every 3 s and
 * right after a change), never a local guess.
 */
export function LanguageMenu({
  sessionId,
  spokenLang: spoken,
  listenLang: listen,
  onConfirmed,
}: {
  sessionId: string
  /** Server-confirmed values. */
  spokenLang: string
  listenLang: string
  /** Called after the server stored a change (the room refreshes its status). */
  onConfirmed?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | { error: string }>('idle')
  const id = useId()

  const change = async (patch: { spokenLang?: string; listenLang?: string }) => {
    setState('saving')
    const result = await saveLanguages(sessionId, patch)
    if (result.ok) {
      setState('saved')
      onConfirmed?.()
    } else {
      setState({ error: result.error })
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={id}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[.04] px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-white/[.09] focus-visible:outline-2 focus-visible:outline-cyan-300"
      >
        <Languages size={12} aria-hidden /> Languages
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label="Live translation languages"
          className="absolute right-0 bottom-9 z-40 w-64 space-y-3 rounded-2xl border border-white/10 bg-[#151b29] p-4 shadow-2xl"
        >
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
              I speak
            </span>
            <select
              value={spoken}
              onChange={(e) => void change({ spokenLang: e.target.value })}
              className={selectClass}
            >
              {spokenLanguageOptions.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
              I want to hear
            </span>
            <select
              value={listen}
              onChange={(e) => void change({ listenLang: e.target.value })}
              className={selectClass}
            >
              {languageOptions.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] leading-4 text-slate-500">
            &ldquo;I want to hear&rdquo; is the language <em>you</em> understand, normally your own:
            what your partner says is translated into it.
          </p>
          <p role="status" className="text-[11px] text-slate-500">
            {state === 'saving' && 'Saving…'}
            {state === 'saved' && 'Done: applies from your next sentence.'}
            {typeof state === 'object' && <span className="text-rose-300">{state.error}</span>}
            {state === 'idle' && 'Applies from your next sentence, for this meeting only.'}
          </p>
        </div>
      )}
    </div>
  )
}
