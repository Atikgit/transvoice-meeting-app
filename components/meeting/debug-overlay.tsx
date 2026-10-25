'use client'

import { useEffect, useState } from 'react'
import { useConnectionState } from '@livekit/components-react'
import { enableTranslationDebug, useTranslationDebug } from '@/features/translation/debug-store'
import { audioContextState } from '@/features/translation/web-audio'

const ago = (at: number | undefined, now: number) =>
  at === undefined ? '—' : `${Math.max(0, Math.round((now - at) / 1000))} s ago`

/**
 * `?debug=1` on the room URL (allow-listed users, or any user in development): where live
 * translation currently stops. Everything shown is local state: no text, audio or ids.
 */
export function DebugOverlay({
  spokenLang,
  listenLang,
}: {
  spokenLang: string
  listenLang: string
}) {
  const connection = useConnectionState()
  const d = useTranslationDebug()
  const [now, setNow] = useState(() => Date.now())
  const [audio, setAudio] = useState(audioContextState())

  useEffect(() => {
    enableTranslationDebug(true)
    const timer = setInterval(() => {
      setNow(Date.now())
      setAudio(audioContextState())
    }, 500)
    return () => {
      clearInterval(timer)
      enableTranslationDebug(false)
    }
  }, [])

  const gateOpen =
    d.gate.status === 'live' &&
    d.gate.remotes >= 1 &&
    d.gate.micEnabled &&
    !d.gate.playingTranslation &&
    d.gate.translationEnabled
  const vad = d.vadError
    ? `error: ${d.vadError}`
    : d.vadSpeaking
      ? 'speech detected'
      : d.vadListening
        ? 'listening'
        : d.vad === 'ready'
          ? 'loaded, paused'
          : d.vad === 'loading'
            ? 'loading model…'
            : d.vad
  const rows: [string, string][] = [
    ['VAD', vad],
    [
      'gate',
      `${gateOpen ? 'OPEN' : 'closed'} (session ${d.gate.status}, ${d.gate.remotes + 1} connected, mic ${d.gate.micEnabled ? 'on' : 'MUTED'}${d.gate.playingTranslation ? ', playing' : ''}${d.gate.translationEnabled ? '' : ', translation OFF for this meeting'})`,
    ],
    ['livekit', `${connection}, ${d.gate.remotes} remote participant(s)`],
    [
      'last utterance',
      d.lastUtterance
        ? `${(d.lastUtterance.ms / 1000).toFixed(1)} s, ${(d.lastUtterance.bytes / 1024).toFixed(0)} KiB, ${ago(d.lastUtterance.at, now)}`
        : '—',
    ],
    [
      '/api/translate',
      d.lastTranslate
        ? `${d.lastTranslate.status} in ${d.lastTranslate.ms} ms${d.lastTranslate.note ? ` (${d.lastTranslate.note})` : ''}, ${ago(d.lastTranslate.at, now)}`
        : '—',
    ],
    ['last caption', d.lastCaption ? `${d.lastCaption.lang}, ${ago(d.lastCaption.at, now)}` : '—'],
    [
      'last audio',
      d.lastAudio
        ? `${d.lastAudio.via} ${d.lastAudio.status} in ${d.lastAudio.ms} ms, ${ago(d.lastAudio.at, now)}`
        : '—',
    ],
    ['playback queue', String(d.queue)],
    ['AudioContext', audio],
    ['me', `speak ${spokenLang}, hear ${listenLang}`],
    [
      'listeners',
      d.listenerLanguages ? d.listenerLanguages.join(', ') || 'none (same language)' : '—',
    ],
  ]
  return (
    <aside
      aria-label="Translation debug"
      data-testid="debug-overlay"
      className="pointer-events-none fixed bottom-24 left-2 z-50 max-w-[calc(100vw-1rem)] rounded-lg border border-cyan-300/30 bg-slate-950/90 p-2 font-mono text-[10px] leading-4 text-slate-200"
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-2">
        {rows.map(([name, value]) => (
          <div key={name} className="contents">
            <dt className="text-cyan-300">{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  )
}
