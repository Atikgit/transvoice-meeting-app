'use client'

import { useEffect, useState } from 'react'

interface Dropped {
  utteranceId: string
  createdAt: number
  expiresAt: number
  seconds: number
  peak: number
  rms: number
  sttClass: string
  lang: string
}

export const DROPPED_POLL_MS = 5000

const db = (level: number) => (level > 1e-6 ? (20 * Math.log10(level)).toFixed(1) : '-120')

/**
 * "Dropped utterances" of the ?debug=1 overlay: what the speech-to-text threw away as silence, with
 * Play and Download of the audio the microphone delivered (kept 1 hour, only for the same signed-in
 * user). Renders nothing while DEBUG_CAPTURE_DROPPED is off on the server (404) or when this user
 * is not named in TRANSLATION_BETA_ALLOWLIST. No audio or text is ever logged.
 */
export function DroppedList({ sessionId }: { sessionId: string }) {
  const [items, setItems] = useState<Dropped[] | null>(null)
  const [playing, setPlaying] = useState('')

  useEffect(() => {
    let alive = true
    const load = async () => {
      const res = await fetch(`/api/debug/dropped?sessionId=${sessionId}`, {
        cache: 'no-store',
      }).catch(() => null)
      if (!alive) return
      if (!res?.ok) return setItems(null)
      const body = (await res.json().catch(() => null)) as {
        allowed?: boolean
        items?: Dropped[]
      } | null
      setItems(body?.allowed ? (body.items ?? []) : null)
    }
    void load()
    const timer = setInterval(() => void load(), DROPPED_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [sessionId])

  if (items === null) return null
  const play = (id: string) => {
    setPlaying(id)
    const audio = new Audio(`/api/debug/dropped/${id}`)
    audio.onended = () => setPlaying('')
    audio.onerror = () => setPlaying('')
    void audio.play().catch(() => setPlaying(''))
  }
  return (
    <section data-testid="dropped-list" className="mt-1.5 border-t border-cyan-300/20 pt-1">
      <h3 className="text-cyan-300">dropped utterances ({items.length}, kept 1 h)</h3>
      {items.length === 0 && <p className="text-slate-500">none yet</p>}
      <ul>
        {items.map((item) => (
          <li key={item.utteranceId} className="flex flex-wrap items-center gap-x-2">
            <span>{new Date(item.createdAt).toISOString().slice(11, 19)}</span>
            <span>{item.seconds.toFixed(2)} s</span>
            <span>
              peak {db(item.peak)} / rms {db(item.rms)} dBFS
            </span>
            <span>{item.sttClass}</span>
            <span>{item.lang}</span>
            <button
              type="button"
              onClick={() => play(item.utteranceId)}
              className="rounded border border-cyan-300/40 px-1.5 text-cyan-200"
            >
              {playing === item.utteranceId ? 'Playing…' : 'Play'}
            </button>
            <a
              href={`/api/debug/dropped/${item.utteranceId}?download=1`}
              download
              className="rounded border border-cyan-300/40 px-1.5 text-cyan-200"
            >
              Download
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
