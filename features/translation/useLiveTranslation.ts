'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocalParticipant, useRemoteParticipants } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { DRAIN_RETRY_MS } from '@/lib/draining'
import { reportLatency } from './latency-beacon'
import { encodeWav } from '@/lib/translation/wav'
import { encodeOpus } from './opus-upload'
import { serverNow } from './clock'
import { describeRefusal, type RefusalReason } from '@/lib/translation/refusal'
import { measureLeg, observeLongTasks } from './net-timing'
import { ChunkUpload } from './chunk-upload'
import type { StreamEvent } from './chunk-stream'
import { useSpeechDetector, type Utterance } from './useSpeechDetector'
import { rememberUtterance, setTranslationDebug } from './debug-store'
import { useLocalAudioWatch } from './useLocalAudioWatch'
import { shouldListen } from './vad-gate'

export type UploadFormat = 'wav' | 'opus'
export type UploadMode = 'whole' | 'chunked'

export type TranslationNotice = {
  tone: 'info' | 'error'
  text: string
  /** PAYER_NO_MINUTES: the room offers Subscribe (payer) or Message host (everyone else). */
  code?: 'PAYER_NO_MINUTES'
  payerIsSpeaker?: boolean
} | null

/** Uploads one utterance (POST /api/translate, multipart). */
export async function uploadUtterance(
  {
    sessionId,
    utteranceId,
    utterance,
    format = 'wav',
    chunk,
  }: {
    sessionId: string
    utteranceId: string
    utterance: Utterance
    /** UPLOAD_FORMAT. opus falls back to wav where the browser cannot encode it. */
    format?: UploadFormat
    /** Piece of a long speech (see Utterance.chunk). */
    chunk?: { group: string; seq: number }
  },
  onEncoded?: (encodeMs: number, sent: { format: UploadFormat; bytes: number }) => void,
): Promise<Response> {
  const form = new FormData()
  const encodeStarted = performance.now()
  const opus = format === 'opus' ? await encodeOpus(utterance.samples) : null
  const audio = opus ?? encodeWav(utterance.samples)
  form.set(
    'audio',
    new Blob([audio as Uint8Array<ArrayBuffer>], { type: opus ? 'audio/ogg' : 'audio/wav' }),
    opus ? 'utterance.ogg' : 'utterance.wav',
  )
  onEncoded?.(Math.round(performance.now() - encodeStarted), {
    format: opus ? 'opus' : 'wav',
    bytes: audio.length,
  })
  form.set('sessionId', sessionId)
  form.set('utteranceId', utteranceId)
  if (chunk) {
    form.set('group', chunk.group)
    form.set('seq', String(chunk.seq))
  }
  // Wall-clock time the speaker stopped talking (listeners derive latency from it).
  form.set('clientTs', String(Math.round(serverNow() - (performance.now() - utterance.endedAt))))
  const send = () => fetch('/api/translate', { method: 'POST', body: form })
  const res = await send()
  // The server is restarting (SIGTERM drain): one retry, which lands on the new container.
  if (res.status === 503 && (await isRetryable(res))) {
    await new Promise((resolve) => setTimeout(resolve, DRAIN_RETRY_MS))
    return send()
  }
  return res
}

async function isRetryable(res: Response): Promise<boolean> {
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { retryable?: boolean } | null
  return body?.retryable === true
}

/**
 * Live translation for the local participant: VAD on the LiveKit microphone, gated by
 * shouldListen(), each utterance uploaded as 16 kHz mono WAV. The server's answers decide
 * what happens next: the beta gate stops it for the session, an empty payer balance pauses it
 * for a minute, everything else is a transient notice.
 */
export function useLiveTranslation({
  sessionId,
  status,
  playingTranslation = false,
  enabled = true,
  endSilenceMs,
  uploadFormat = 'wav',
  uploadMode = 'whole',
  maxChunkMs,
  onTranscript,
}: {
  sessionId: string
  status: 'ready' | 'live' | 'ended'
  playingTranslation?: boolean
  /** False while translation is not available (beta gate): the VAD stays off. */
  enabled?: boolean
  /** Silence that ends an utterance (VAD_END_SILENCE_MS). */
  endSilenceMs?: number
  /** UPLOAD_FORMAT: what each utterance is uploaded as. */
  uploadFormat?: UploadFormat
  /** UPLOAD_MODE: whole = one upload at speech end; chunked = ~500 ms chunks while speaking. */
  uploadMode?: UploadMode
  /** VAD_MAX_CHUNK_MS. */
  maxChunkMs?: number
  /** The speaker's own transcript of an utterance. */
  onTranscript?: (utteranceId: string, original: string) => void
}) {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant()
  const remotes = useRemoteParticipants()
  const [notice, setNotice] = useState<TranslationNotice>(null)
  const [pending, setPending] = useState(0)
  const [blocked, setBlocked] = useState<TranslationNotice>(null)
  const [paused, setPaused] = useState(false)
  useEffect(() => observeLongTasks(), [])
  const chunkUploads = useRef(new Map<string, ChunkUpload>())
  const chains = useRef(new Map<string, Promise<void>>())
  const transcriptRef = useRef(onTranscript)
  useEffect(() => {
    transcriptRef.current = onTranscript
  }, [onTranscript])

  const micTrack = localParticipant.getTrackPublication(Track.Source.Microphone)?.track
    ?.mediaStreamTrack
  useLocalAudioWatch(micTrack, sessionId)
  const listening =
    enabled &&
    !blocked &&
    !paused &&
    shouldListen({
      status,
      connectedParticipants: remotes.length + 1,
      micEnabled: isMicrophoneEnabled,
      playingTranslation,
    })

  useEffect(() => {
    setTranslationDebug({
      gate: {
        status,
        remotes: remotes.length,
        micEnabled: isMicrophoneEnabled,
        playingTranslation,
        translationEnabled: enabled,
      },
    })
  }, [status, remotes.length, isMicrophoneEnabled, playingTranslation, enabled])

  const handle = async (res: Response, utteranceId: string) => {
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        original?: string | null
        unavailable?: boolean
        serviceKeyRejected?: boolean
        serviceNoBalance?: boolean
        languages?: { lang: string }[]
        reason?: 'same_language' | 'no_listeners'
        refusal?: RefusalReason
      }
      setTranslationDebug({
        lastRefusal: body.refusal ? { reason: body.refusal, at: Date.now() } : undefined,
      })
      setTranslationDebug({ listenerLanguages: (body.languages ?? []).map((l) => l.lang) })
      if (body.original) transcriptRef.current?.(utteranceId, body.original)
      if (body.reason === 'same_language') {
        setNotice({
          tone: 'info',
          text: 'You and your partner use the same language, so there is nothing to translate. Change a language in the Languages menu.',
        })
        return
      }
      if (body.refusal) {
        setNotice({ tone: 'error', text: describeRefusal(body.refusal) })
        return
      }
      setNotice(
        body.serviceNoBalance
          ? {
              tone: 'error',
              text: 'Translation is unavailable: the translation service has no credit left. Please tell support.',
            }
          : body.serviceKeyRejected
            ? {
                tone: 'error',
                text: 'Translation is unavailable: the translation service rejected our access key. Please tell support.',
              }
            : body.unavailable
              ? {
                  tone: 'error',
                  text: 'Translation is temporarily unavailable. It resumes by itself.',
                }
              : null,
      )
      return
    }
    const body = (await res.json().catch(() => ({}))) as {
      code?: string
      error?: string
      payerIsSpeaker?: boolean
      reason?: RefusalReason
    }
    if (body.reason) setTranslationDebug({ lastRefusal: { reason: body.reason, at: Date.now() } })
    if (body.code === 'BETA') {
      setBlocked({ tone: 'info', text: describeRefusal('allowlist') })
    } else if (body.code === 'DISABLED') {
      setBlocked({ tone: 'info', text: describeRefusal('switched_off') })
    } else if (body.code === 'PAYER_NO_MINUTES') {
      setNotice({
        tone: 'error',
        text: describeRefusal('payer_minutes', { payerIsSpeaker: body.payerIsSpeaker === true }),
        code: 'PAYER_NO_MINUTES',
        payerIsSpeaker: body.payerIsSpeaker === true,
      })
      setPaused(true)
      setTimeout(() => setPaused(false), 60_000) // re-check the balance after a minute
    } else if (res.status === 429) {
      setNotice({ tone: 'info', text: 'Speaking fast: some phrases were skipped.' })
    } else if (res.status >= 500) {
      setNotice({
        tone: 'error',
        text: 'Translation is temporarily unavailable. It resumes by itself.',
      })
    }
  }

  const detector = useSpeechDetector({
    track: micTrack,
    listening,
    endSilenceMs,
    maxChunkMs,
    streaming: uploadMode === 'chunked',
    onStream: (event: StreamEvent) => {
      if (event.type === 'abort') {
        chunkUploads.current.get(event.utteranceId)?.abort()
        chunkUploads.current.delete(event.utteranceId)
        return
      }
      if (event.type !== 'chunk') return
      let upload = chunkUploads.current.get(event.utteranceId)
      if (!upload) {
        upload = new ChunkUpload(event.utteranceId, { sessionId })
        chunkUploads.current.set(event.utteranceId, upload)
      }
      upload.push({
        seq: event.seq,
        pcm: event.pcm,
        last: event.last,
        group: event.group,
        pieceSeq: event.pieceSeq,
        // the speaker's clock (server time) at the moment the speech really ended
        clientTs: Math.round(serverNow() - event.endedAgoMs),
      })
    },
    onUtterance: (utterance) => {
      const chunked = uploadMode === 'chunked' && utterance.utteranceId !== undefined
      const utteranceId = utterance.utteranceId ?? crypto.randomUUID()
      const sentAt = performance.now()
      setPending((n) => n + 1)
      rememberUtterance(utterance.samples)
      setTranslationDebug({
        lastUtterance: {
          ms: (utterance.samples.length / 16_000) * 1000,
          bytes: 44 + utterance.samples.length * 2,
          at: Date.now(),
        },
      })
      let encodeMs = 0
      let sent: { format: UploadFormat; bytes: number } | undefined
      // Chunked: the audio is already at the server; wait for the answer to the last chunk. If any
      // chunk failed, send the whole utterance the old way (the server ignores it if it had already
      // processed the chunks).
      const uploadChunked = async (): Promise<Response> => {
        const chunks = chunkUploads.current.get(utteranceId)
        chunkUploads.current.delete(utteranceId)
        const outcome = chunks
          ? await chunks.finish()
          : ({ ok: false, reason: 'no chunks' } as const)
        sent = { format: 'wav', bytes: 44 + utterance.samples.length * 2 }
        if (outcome.ok) return outcome.response ?? new Response('{}', { status: 200 })
        return uploadUtterance(
          { sessionId, utteranceId, utterance, format: 'wav', chunk: utterance.chunk },
          (ms, info) => {
            encodeMs = ms
            sent = info
          },
        )
      }
      const upload = () =>
        uploadUtterance(
          { sessionId, utteranceId, utterance, format: uploadFormat, chunk: utterance.chunk },
          (ms, info) => {
            encodeMs = ms
            sent = info
          },
        )
      // Pieces of one long speech go out one after the other: the server has delivered piece n
      // before piece n+1 is sent, so the listener's per-speaker queue plays them in order.
      const group = chunked ? undefined : utterance.chunk?.group
      const request = chunked
        ? uploadChunked()
        : group
          ? (chains.current.get(group) ?? Promise.resolve()).then(upload)
          : upload()
      if (group) {
        const settled = request.then(
          () => {},
          () => {},
        )
        chains.current.set(group, settled)
        void settled.then(() => {
          if (chains.current.get(group) === settled) chains.current.delete(group)
        })
      }
      void request
        .then((res) => {
          reportLatency({
            sessionId,
            utteranceId,
            kind: 'speak',
            encodeMs,
            vadMs: Math.max(0, Math.round(sentAt - utterance.endedAt)),
            roundTripMs: Math.round(performance.now() - sentAt),
            bytes: sent?.bytes ?? 44 + utterance.samples.length * 2,
            format: sent?.format,
            mode: chunked ? 'chunked' : 'whole',
            endSilenceMs,
            ...measureLeg(utterance.endedAt, chunked ? '/api/translate/chunk' : '/api/translate'),
          })
          setTranslationDebug({
            lastTranslate: {
              status: res.status,
              ms: Math.round(performance.now() - sentAt),
              at: Date.now(),
            },
          })
          return handle(res, utteranceId)
        })
        .catch(() => {
          setTranslationDebug({
            lastTranslate: {
              status: 'network',
              ms: Math.round(performance.now() - sentAt),
              at: Date.now(),
            },
          })
          setNotice({ tone: 'error', text: 'Network problem: translation paused.' })
        })
        .finally(() => setPending((n) => n - 1))
    },
  })

  return {
    listening,
    speaking: detector.speaking,
    translating: pending > 0,
    blocked: Boolean(blocked),
    notice: detector.error ? { tone: 'error' as const, text: detector.error } : (blocked ?? notice),
  }
}
