'use client'

import { useEffect, useRef, useState } from 'react'
import { AudioLines, ChevronDown } from 'lucide-react'
import { Button } from '@/components/common/button'
import { Logo } from '@/components/common/logo'
import { languageOptions } from '@/lib/transvoice/languages'

export function JoinScreen({
  onJoin,
  srcLang,
  setSrcLang,
  tgtLang,
  setTgtLang,
  guestName,
  setGuestName,
}: {
  onJoin: () => void
  srcLang: string
  setSrcLang: (v: string) => void
  tgtLang: string
  setTgtLang: (v: string) => void
  guestName: string
  setGuestName: (v: string) => void
}) {
  const [mic, setMic] = useState(true)
  const [camera, setCamera] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    let stream: MediaStream | null = null
    if (camera) {
      navigator.mediaDevices
        ?.getUserMedia({ video: true, audio: true })
        .then((s) => {
          stream = s
          if (videoRef.current) videoRef.current.srcObject = s
        })
        .catch((err) => console.log('Camera preview error:', err))
    }
    return () => {
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [camera])

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0b0e16] p-5">
      <div className="w-full max-w-3xl">
        <Logo />
        <div className="mt-12 grid gap-8 md:grid-cols-[1fr_1.15fr] md:items-center">
          <div>
            <p className="font-mono text-xs uppercase tracking-[.2em] text-cyan-300">
              You&apos;re invited
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">
              Join Translated Meeting
            </h1>
            <p className="mt-4 text-sm leading-6 text-slate-400">
              Speak in your language, hear in theirs. Set your languages before joining.
            </p>
            <div className="mt-8 space-y-3">
              <input
                className="w-full rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-sm text-white outline-none"
                placeholder="Your display name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
                    I Speak
                  </label>
                  <select
                    value={srcLang}
                    onChange={(e) => setSrcLang(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-[#151c2a] px-3 py-2.5 text-xs text-slate-200 outline-none"
                  >
                    {languageOptions.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
                    Translate To
                  </label>
                  <select
                    value={tgtLang}
                    onChange={(e) => setTgtLang(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-[#151c2a] px-3 py-2.5 text-xs text-slate-200 outline-none"
                  >
                    {languageOptions.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <Button onClick={onJoin} className="mt-5 w-full">
              Join call now <ChevronDown className="-rotate-90" size={16} />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[#192235]">
              {camera ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex size-14 items-center justify-center rounded-full bg-cyan-700 text-lg font-semibold text-white">
                  You
                </div>
              )}
              <span className="absolute bottom-2 left-2 text-[10px] text-slate-300">
                Camera preview
              </span>
            </div>
            <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[#192235]">
              <AudioLines
                className={`size-10 ${mic ? 'text-cyan-300 animate-pulse' : 'text-slate-600'}`}
              />
              <span className="absolute bottom-2 left-2 text-[10px] text-slate-300">
                Microphone: {mic ? 'Active' : 'Muted'}
              </span>
            </div>
            <button
              onClick={() => setCamera(!camera)}
              className="rounded-xl border border-white/10 bg-white/[.04] p-3 text-xs text-slate-400"
            >
              {camera ? 'Turn camera off' : 'Turn camera on'}
            </button>
            <button
              onClick={() => setMic(!mic)}
              className="rounded-xl border border-white/10 bg-white/[.04] p-3 text-xs text-slate-400"
            >
              {mic ? 'Mute mic' : 'Unmute mic'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
