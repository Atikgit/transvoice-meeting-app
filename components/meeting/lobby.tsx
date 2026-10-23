'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, ChevronRight, Mic, MicOff } from 'lucide-react'
import { joinFromLobby, type LobbyState } from '@/app/m/actions'
import { BackButton } from '@/components/common/back-button'
import { Logo } from '@/components/common/logo'
import type { MeetingRole } from '@/lib/meetings/load'
import {
  LANGUAGES_AND_VOICES,
  languageOptions,
  spokenLanguageOptions,
} from '@/lib/transvoice/languages'

const fieldClass =
  'w-full rounded-xl border border-white/10 bg-[#151c2a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-300'
const toggleClass =
  'flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-cyan-300'

/** Pre-join check for host and guests: name, languages, camera and mic. */
export function Lobby({
  meetingId,
  role,
  defaultName,
  spokenLang,
  listenLang,
}: {
  meetingId: string
  role: MeetingRole
  defaultName: string
  spokenLang: string
  listenLang: string
}) {
  const [state, action, pending] = useActionState<LobbyState, FormData>(joinFromLobby, {})
  const [mic, setMic] = useState(true)
  const [camera, setCamera] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    if (camera) {
      navigator.mediaDevices
        ?.getUserMedia({ video: true, audio: true })
        .then((s) => {
          if (cancelled) return s.getTracks().forEach((t) => t.stop())
          stream = s
          if (videoRef.current) videoRef.current.srcObject = s
        })
        .catch((err) => console.warn('Camera preview unavailable:', err))
    }
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [camera])

  const host = role === 'host'

  return (
    <main className="min-h-dvh bg-[#0b0e16] text-slate-100">
      <header className="flex h-[70px] items-center justify-between border-b border-white/[.08] px-5 lg:px-8">
        <Logo />
        <BackButton />
      </header>

      <div className="mx-auto grid w-full max-w-4xl gap-8 p-5 py-10 md:grid-cols-[1fr_1.15fr] md:items-center">
        <form action={action}>
          <p className="font-mono text-xs uppercase tracking-[.2em] text-cyan-300">
            {host ? 'Your meeting room' : "You're invited"}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white md:text-4xl">
            {host ? 'Start Translated Meeting' : "You're invited — Join Translated Meeting"}
          </h1>
          <p className="mt-4 text-sm leading-6 text-slate-400">
            Speak in your language, hear in theirs: {LANGUAGES_AND_VOICES}. Check your camera and
            microphone, then {host ? 'open your room' : 'join'}.
          </p>

          {state.error && (
            <p
              role="alert"
              className="mt-5 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300"
            >
              {state.error}
            </p>
          )}

          <input type="hidden" name="meetingId" value={meetingId} />
          <input type="hidden" name="camera" value={camera ? 'on' : 'off'} />
          <input type="hidden" name="mic" value={mic ? 'on' : 'off'} />
          <div className="mt-6 space-y-3">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
                Your name
              </span>
              <input
                required
                name="full_name"
                maxLength={120}
                autoComplete="name"
                defaultValue={defaultName}
                className={fieldClass}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
                  I speak
                </span>
                <select name="spoken_lang" defaultValue={spokenLang} className={fieldClass}>
                  {spokenLanguageOptions.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
                  Translate to
                </span>
                <select name="listen_lang" defaultValue={listenLang} className={fieldClass}>
                  {languageOptions.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50"
          >
            {pending ? 'Opening room…' : host ? 'Continue to room' : 'Join call now'}
            <ChevronRight size={16} aria-hidden />
          </button>
        </form>

        <div className="grid grid-cols-2 gap-3">
          <div className="relative col-span-2 flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[#192235]">
            {camera ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full -scale-x-100 object-cover"
              />
            ) : (
              <div className="flex size-14 items-center justify-center rounded-full bg-cyan-700 text-lg font-semibold text-white">
                You
              </div>
            )}
            <span className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-slate-950/60 px-2 py-1 text-[10px] text-slate-200">
              {mic ? (
                <Mic size={12} className="text-cyan-300" aria-hidden />
              ) : (
                <MicOff size={12} className="text-rose-300" aria-hidden />
              )}
              Camera preview · microphone {mic ? 'on' : 'muted'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setCamera(!camera)}
            aria-pressed={camera}
            className={`${toggleClass} ${camera ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-200' : 'border-white/10 bg-white/[.04] text-slate-400'}`}
          >
            {camera ? <Camera size={15} aria-hidden /> : <CameraOff size={15} aria-hidden />}
            {camera ? 'Camera on' : 'Camera off'}
          </button>
          <button
            type="button"
            onClick={() => setMic(!mic)}
            aria-pressed={mic}
            className={`${toggleClass} ${mic ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-200' : 'border-white/10 bg-white/[.04] text-slate-400'}`}
          >
            {mic ? <Mic size={15} aria-hidden /> : <MicOff size={15} aria-hidden />}
            {mic ? 'Microphone on' : 'Microphone muted'}
          </button>
        </div>
      </div>
    </main>
  )
}
