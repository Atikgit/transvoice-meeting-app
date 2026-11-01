import 'server-only'
import { DataPacket_Kind } from 'livekit-server-sdk'
import { serverEnv } from '@/lib/env'
import { roomNameFor, roomService } from '@/lib/livekit/server'
import { hasSseSubscriber, pushSse, sseFrame } from '@/lib/translation/sse-hub'
import {
  AUDIO_TTL_SEC,
  audioCache,
  newAudioId,
  type AudioCache,
} from '@/lib/translation/audio-cache'
import type { LanguageResult } from '@/lib/translation/fanout'
import { logClipTrace } from '@/lib/translation/log'
import {
  captionMessage,
  encodeInlineAudio,
  encodeMessage,
  inlinePacketSize,
  MAX_INLINE_PACKET_BYTES,
  TOPICS,
  type AudioMessage,
  type NoticeMessage,
} from '@/lib/translation/messages'

type Send = (
  sessionId: string,
  data: Uint8Array,
  options: { destinationIdentities: string[]; topic: string },
) => Promise<void>

const sendLiveKit: Send = (sessionId, data, options) =>
  roomService().sendData(roomNameFor(sessionId), data, DataPacket_Kind.RELIABLE, options)

/**
 * DELIVERY=sse: a listener with an open GET /api/stream gets the message from the app server
 * directly; everyone else (and anyone whose stream refuses it) gets it over LiveKit data.
 */
const sendSseFirst: Send = async (sessionId, data, options) => {
  const frame = sseFrame(options.topic, data)
  const rest = options.destinationIdentities.filter(
    (id) => !(hasSseSubscriber(sessionId, id) && pushSse(sessionId, id, frame)),
  )
  if (rest.length > 0)
    await sendLiveKit(sessionId, data, { ...options, destinationIdentities: rest })
}

const sendReliable: Send = (sessionId, data, options) =>
  (serverEnv().DELIVERY === 'sse' ? sendSseFirst : sendLiveKit)(sessionId, data, options)

/**
 * Delivers one language's result to its listeners only: the caption immediately, then the
 * TTS clip as a short-lived URL (audio is too large for a reliable data packet).
 */
export async function deliverResult({
  sessionId,
  utteranceId,
  speakerId,
  speechEndedAt,
  result,
  send = sendReliable,
  cache = audioCache(),
  now = Date.now,
}: {
  sessionId: string
  utteranceId: string
  speakerId: string
  speechEndedAt: number
  result: LanguageResult
  send?: Send
  cache?: AudioCache
  now?: () => number
}): Promise<{ captionMs: number; audioMs: number } | null> {
  if (result.listeners.length === 0) return null
  const destinationIdentities = result.listeners

  if (result.kind === 'failed') {
    const notice: NoticeMessage = { kind: 'translation_unavailable' }
    await send(sessionId, encodeMessage(notice), { destinationIdentities, topic: TOPICS.notice })
    return null
  }
  if (result.kind === 'silence') return null

  const started = now()
  const caption = captionMessage({
    utteranceId,
    speakerId,
    lang: result.lang,
    original: result.originalText,
    translated: result.translatedText,
    speechEndedAt,
  })
  let captionMs = 0
  const captionSent = send(sessionId, encodeMessage(caption), {
    destinationIdentities,
    topic: TOPICS.caption,
  }).then(() => {
    captionMs = now() - started
  })

  let audioMs = -1
  if (!result.ttsAudio) {
    // The API gave no usable audio: the caption stands alone and the listener is told why.
    const notice: NoticeMessage = { kind: 'audio_unavailable' }
    await Promise.all([
      captionSent,
      send(sessionId, encodeMessage(notice), { destinationIdentities, topic: TOPICS.notice }),
    ])
    return { captionMs, audioMs }
  }
  if (result.ttsAudio) {
    const bytes = Buffer.from(result.ttsAudio, 'base64')
    // The audio goes out at the same moment as the caption (never queued behind it): one
    // LiveKit API round trip less before the listener can start fetching.
    let audioSent: Promise<void>
    if (
      result.audioFormat &&
      inlinePacketSize(
        { utteranceId, speakerId, lang: result.lang, format: result.audioFormat, speechEndedAt },
        bytes.length,
      ) <= MAX_INLINE_PACKET_BYTES
    ) {
      // The API says what format this is and the clip is tiny: the audio travels inside the
      // packet, the listener skips the HTTP fetch.
      audioSent = send(
        sessionId,
        encodeInlineAudio(
          {
            utteranceId,
            speakerId,
            lang: result.lang,
            format: result.audioFormat,
            speechEndedAt,
          },
          bytes,
        ),
        { destinationIdentities, topic: TOPICS.audioInline },
      )
    } else {
      const id = newAudioId()
      await cache.put(
        id,
        {
          audio: bytes,
          mime: MIME[result.audioFormat ?? 'wav'],
          recipients: destinationIdentities,
        },
        AUDIO_TTL_SEC,
      )
      const audio: AudioMessage = {
        utteranceId,
        speakerId,
        lang: result.lang,
        url: `/api/tts/${id}`,
        speechEndedAt,
      }
      audioSent = send(sessionId, encodeMessage(audio), {
        destinationIdentities,
        topic: TOPICS.audio,
      })
    }
    await Promise.all([captionSent, audioSent])
    audioMs = now() - started
    return { captionMs, audioMs }
  }
  await captionSent
  return { captionMs, audioMs }
}

const MIME = { wav: 'audio/wav', mp3: 'audio/mpeg', opus: 'audio/ogg; codecs=opus' } as const

/** One sentence's caption (cumulative text so far) for the listeners of one language. */
export async function deliverSentenceCaption({
  sessionId,
  utteranceId,
  speakerId,
  speechEndedAt,
  lang,
  listeners,
  original,
  translated,
  send = sendReliable,
}: {
  sessionId: string
  utteranceId: string
  speakerId: string
  speechEndedAt: number
  lang: string
  listeners: string[]
  original: string
  translated: string
  send?: Send
}): Promise<void> {
  if (listeners.length === 0) return
  const caption = captionMessage({
    utteranceId,
    speakerId,
    lang,
    original,
    translated,
    speechEndedAt,
  })
  await send(sessionId, encodeMessage(caption), {
    destinationIdentities: listeners,
    topic: TOPICS.caption,
  })
}

/**
 * One mp3 sentence clip, served as it came from the API (audio/mpeg): inline in the LiveKit packet
 * when it is at most 12 KiB, else through the short-lived /api/tts/<id> URL. Carries {seq, last}.
 */
export async function deliverSentenceClip({
  sessionId,
  utteranceId,
  speakerId,
  speechEndedAt,
  lang,
  listeners,
  seq,
  last,
  audio,
  send = sendReliable,
  cache = audioCache(),
}: {
  sessionId: string
  utteranceId: string
  speakerId: string
  speechEndedAt: number
  lang: string
  listeners: string[]
  seq: number
  last: boolean
  audio: Uint8Array
  send?: Send
  cache?: AudioCache
}): Promise<'inline' | 'url'> {
  if (listeners.length === 0) return 'inline'
  const destinationIdentities = listeners
  const header = { utteranceId, speakerId, lang, format: 'mp3' as const, speechEndedAt, seq, last }
  // Inline only when the whole packet (length + JSON header + audio) is at most 12 KiB.
  const packetBytes = inlinePacketSize(header, audio.length)
  const via = packetBytes <= MAX_INLINE_PACKET_BYTES ? 'inline' : 'url'
  logClipTrace({ stage: 'created', utteranceId, seq, lang, via, bytes: audio.length, packetBytes })
  const sentAt = Date.now()
  const traced = async (data: Uint8Array, topic: string) => {
    try {
      await send(sessionId, data, { destinationIdentities, topic })
      logClipTrace({
        stage: 'sent',
        utteranceId,
        seq,
        lang,
        via,
        ok: true,
        ms: Date.now() - sentAt,
      })
    } catch (error) {
      logClipTrace({
        stage: 'sent',
        utteranceId,
        seq,
        lang,
        via,
        ok: false,
        ms: Date.now() - sentAt,
        error: error instanceof Error ? error.message.slice(0, 100) : 'error',
      })
      throw error
    }
  }
  if (via === 'inline') {
    await traced(encodeInlineAudio(header, audio), TOPICS.audioInline)
    return 'inline'
  }
  // The whole mp3 is in the cache BEFORE its URL is announced.
  const id = newAudioId()
  await cache.put(
    id,
    { audio: Buffer.from(audio), mime: MIME.mp3, recipients: destinationIdentities },
    AUDIO_TTL_SEC,
  )
  const message: AudioMessage = {
    utteranceId,
    speakerId,
    lang,
    url: `/api/tts/${id}`,
    speechEndedAt,
    seq,
    last,
  }
  await traced(encodeMessage(message), TOPICS.audio)
  return 'url'
}
