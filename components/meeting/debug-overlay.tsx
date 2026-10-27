'use client'

import { useEffect, useState } from 'react'
import {
  useConnectionState,
  useLocalParticipant,
  useRemoteParticipants,
} from '@livekit/components-react'
import { Track, type RemoteAudioTrack } from 'livekit-client'
import {
  enableTranslationDebug,
  lastClip,
  lastUtteranceSamples,
  useTranslationDebug,
} from '@/features/translation/debug-store'
import { useMicLevel } from '@/features/translation/useMicLevel'
import { uploadUtterance } from '@/features/translation/useLiveTranslation'
import type { TranslationStatus } from '@/features/translation/useTranslationStatus'
import { encodeWav } from '@/lib/translation/wav'
import {
  audioContextState,
  playBuffer,
  playTestBeep,
  unlockAudio,
} from '@/features/translation/web-audio'

const ago = (at: number | undefined, now: number) =>
  at === undefined ? '—' : `${Math.max(0, Math.round((now - at) / 1000))} s ago`

/** The files the browser needs for voice detection; each must answer 200 from this origin. */
const VAD_FILES = [
  '/vad/silero_vad_v5.onnx',
  '/vad/ort-wasm-simd-threaded.wasm',
  '/vad/ort-wasm-simd-threaded.mjs',
  '/vad/vad.worklet.bundle.min.js',
] as const

/** A 1.5 s, 220 Hz tone at 16 kHz: proves the whole path, but the API will hear no speech in it. */
function toneSamples(): Float32Array {
  const samples = new Float32Array(24_000)
  for (let i = 0; i < samples.length; i++)
    samples[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / 16_000)
  return samples
}

/**
 * `?debug=1` on the room URL (any signed-in participant): where live translation currently stops.
 * Shows local state, what the server stores and decides (GET /api/translate/status) and lets you
 * send a test clip through the real /api/translate and read its exact answer. No text or audio is
 * shown except what the server returns for that test.
 */
export function DebugOverlay({
  sessionId,
  spokenLang,
  listenLang,
  status,
}: {
  sessionId: string
  spokenLang: string
  listenLang: string
  status: TranslationStatus | null
}) {
  const connection = useConnectionState()
  const { localParticipant } = useLocalParticipant()
  const remotes = useRemoteParticipants()
  const d = useTranslationDebug()
  const [now, setNow] = useState(() => Date.now())
  const [audio, setAudio] = useState(audioContextState())
  const [assets, setAssets] = useState<string>('checking…')
  const [blocked, setBlocked] = useState<string[]>([])
  const [test, setTest] = useState<string>('')
  const [testing, setTesting] = useState(false)
  const [beep, setBeep] = useState('')
  const [replay, setReplay] = useState('')

  const micTrack = localParticipant.getTrackPublication(Track.Source.Microphone)?.track
    ?.mediaStreamTrack
  const level = useMicLevel(micTrack, true)
  const localPub = localParticipant.getTrackPublication(Track.Source.Microphone)
  const localAudio = localPub
    ? `published, LiveKit ${localPub.isMuted ? 'MUTED' : 'live'}, track ${micTrack?.readyState ?? '?'}${micTrack && !micTrack.enabled ? ', DISABLED' : ''}${micTrack?.muted ? ', MUTED BY SYSTEM' : ''}`
    : 'NOT published'
  const remoteAudio = remotes
    .map((p) => {
      const pub = p.getTrackPublication(Track.Source.Microphone)
      if (!pub) return `${p.name || 'Participant'}: no microphone track`
      const volume = (pub.track as RemoteAudioTrack | undefined)?.getVolume?.()
      return `${p.name || 'Participant'}: ${pub.isSubscribed ? 'subscribed' : 'NOT subscribed'}, ${pub.isMuted ? 'MUTED' : 'live'}, volume ${volume === undefined ? '?' : volume}`
    })
    .join('; ')

  useEffect(() => {
    enableTranslationDebug(true)
    const timer = setInterval(() => {
      setNow(Date.now())
      setAudio(audioContextState())
    }, 500)
    // Anything the Content-Security-Policy refuses (scripts, wasm, workers, media) shows up here.
    const onViolation = (event: SecurityPolicyViolationEvent) =>
      setBlocked((list) =>
        [...list, `${event.effectiveDirective} ✗ ${event.blockedURI || 'inline'}`].slice(-3),
      )
    document.addEventListener('securitypolicyviolation', onViolation)
    void Promise.all(
      VAD_FILES.map((url) =>
        fetch(url, { method: 'HEAD', cache: 'no-store' }).then(
          (res) => (res.ok ? null : `${url.split('/').pop()} ${res.status}`),
          () => `${url.split('/').pop()} unreachable`,
        ),
      ),
    ).then((problems) => {
      const bad = problems.filter(Boolean)
      setAssets(bad.length ? bad.join(', ') : `${VAD_FILES.length}/${VAD_FILES.length} ok`)
    })
    return () => {
      clearInterval(timer)
      document.removeEventListener('securitypolicyviolation', onViolation)
      enableTranslationDebug(false)
    }
  }, [])

  const replayLastClip = async () => {
    const clip = lastClip()
    if (!clip) return setReplay('no clip yet')
    const ok = await unlockAudio()
    if (!ok) return setReplay(`blocked (AudioContext ${audioContextState()})`)
    setReplay('playing…')
    await playBuffer(clip).then(
      () => setReplay('played'),
      (error) => setReplay(`failed: ${error instanceof Error ? error.message : String(error)}`),
    )
  }

  const downloadLastClip = () => {
    const clip = lastClip()
    if (!clip) return setReplay('no clip yet')
    const wav = encodeWav(clip.getChannelData(0), clip.sampleRate)
    const url = URL.createObjectURL(new Blob([wav.buffer as ArrayBuffer], { type: 'audio/wav' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'last-translated-clip.wav'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  const sendTestClip = async () => {
    setTesting(true)
    const remembered = lastUtteranceSamples()
    const samples = remembered ?? toneSamples()
    const started = performance.now()
    try {
      const res = await uploadUtterance({
        sessionId,
        utteranceId: crypto.randomUUID(),
        utterance: { samples, endedAt: performance.now() },
      })
      const text = (await res.text()).slice(0, 360)
      setTest(
        `${remembered ? 'your last sentence' : 'a tone'} → ${res.status} in ${Math.round(performance.now() - started)} ms: ${text}`,
      )
    } catch (error) {
      setTest(`network error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setTesting(false)
    }
  }

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
  const me = status?.me ?? { spokenLang, listenLang }
  const allowed = status
    ? status.decision.allowed
      ? `yes (${status.allowlist === 'everyone' ? 'open to everyone' : 'allow-listed host'})`
      : `NO: ${status.decision.reason}`
    : '—'
  const rows: [string, string][] = [
    ['VAD', vad],
    ['vad files', assets],
    ['blocked by CSP', blocked.length ? blocked.join(' | ') : 'none'],
    [
      'mic level',
      level === null
        ? d.gate.micEnabled
          ? 'no signal source'
          : 'MUTED'
        : `${level} dB ${'▮'.repeat(Math.max(0, Math.min(10, Math.round((level + 70) / 5))))}`,
    ],
    [
      'gate',
      `${gateOpen ? 'OPEN' : 'closed'} (session ${d.gate.status}, ${d.gate.remotes + 1} connected, mic ${d.gate.micEnabled ? 'on' : 'MUTED'}${d.gate.playingTranslation ? ', playing' : ''}${d.gate.translationEnabled ? '' : ', translation OFF for this meeting'})`,
    ],
    ['livekit', `${connection}, ${d.gate.remotes} remote participant(s)`],
    ['my mic track', localAudio],
    ['their mic tracks', remoteAudio || 'nobody else'],
    [
      'last ducking',
      d.lastDuck
        ? `${d.lastDuck.volume === 1 ? 'restored to 1' : `lowered to ${d.lastDuck.volume}`} (${d.lastDuck.reason}), ${ago(d.lastDuck.at, now)}`
        : 'none',
    ],
    ['translation allowed', allowed],
    [
      'service',
      status
        ? `enabled ${status.translationEnabled ? 'yes' : 'NO'}, API key ${status.api === 'ok' ? 'accepted' : status.api === 'rejected' ? 'REJECTED (401)' : 'unreachable'}`
        : '—',
    ],
    ['me (server)', `speak ${me.spokenLang}, hear ${me.listenLang}`],
    [
      'others (server)',
      status
        ? status.others
            .map(
              (o) =>
                `${o.name}: speak ${o.spokenLang}, hear ${o.listenLang}${o.connected ? '' : ' (offline)'}`,
            )
            .join('; ') || 'nobody else'
        : '—',
    ],
    [
      'my sentences go to',
      status
        ? status.fanout.targets.length
          ? status.fanout.targets.map((t) => `${t.lang} ×${t.listeners}`).join(', ')
          : `nobody (${status.fanout.reason.replace('_', ' ')})`
        : '—',
    ],
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
    [
      'last clip',
      d.lastClip
        ? `${d.lastClip.seconds.toFixed(2)} s, ${d.lastClip.sampleRate} Hz ×${d.lastClip.channels}, peak ${d.lastClip.peak.toFixed(3)}, rms ${d.lastClip.rms.toFixed(3)}${d.lastClip.peak < 0.01 ? ' ⚠ INAUDIBLE' : ''}; gain ${d.lastClip.gain ?? '—'}, context ${d.lastClip.ctxAtStart ?? '—'}, original voice ${d.lastClip.originalAtStart ?? '—'} → ${d.lastClip.originalAtEnd ?? '—'}; ${ago(d.lastClip.at, now)}`
        : '—',
    ],
    ['playback queue', String(d.queue)],
    ['AudioContext', audio],
  ]
  return (
    <aside
      aria-label="Translation debug"
      data-testid="debug-overlay"
      className="fixed bottom-24 left-2 z-50 max-h-[70dvh] max-w-[calc(100vw-1rem)] overflow-auto rounded-lg border border-cyan-300/30 bg-slate-950/90 p-2 font-mono text-[10px] leading-4 text-slate-200"
    >
      <dl className="pointer-events-none grid grid-cols-[auto_1fr] gap-x-2">
        {rows.map(([name, value]) => (
          <div key={name} className="contents">
            <dt className="text-cyan-300">{name}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        onClick={() => void sendTestClip()}
        disabled={testing}
        className="mt-1.5 rounded border border-cyan-300/40 px-2 py-0.5 text-cyan-200 disabled:opacity-50"
      >
        {testing ? 'Sending…' : 'Send test clip'}
      </button>
      <span className="ml-2 text-slate-500">
        sends your last sentence (or a tone) through /api/translate; your partner receives the
        result
      </span>
      <button
        type="button"
        onClick={() => void playTestBeep().then(setBeep)}
        className="mt-1.5 ml-2 rounded border border-cyan-300/40 px-2 py-0.5 text-cyan-200"
      >
        Play test beep
      </button>
      <button
        type="button"
        onClick={() => void replayLastClip()}
        className="mt-1.5 ml-2 rounded border border-cyan-300/40 px-2 py-0.5 text-cyan-200"
      >
        Replay last clip
      </button>
      <button
        type="button"
        onClick={downloadLastClip}
        className="mt-1.5 ml-2 rounded border border-cyan-300/40 px-2 py-0.5 text-cyan-200"
      >
        Download last clip
      </button>
      {replay && (
        <span data-testid="debug-replay-result" className="ml-2 text-amber-200">
          {replay}
        </span>
      )}
      {beep && (
        <span data-testid="debug-beep-result" className="ml-2 text-amber-200">
          {beep}
        </span>
      )}
      {test && (
        <p data-testid="debug-test-result" className="mt-1 break-words text-amber-200">
          {test}
        </p>
      )}
    </aside>
  )
}
