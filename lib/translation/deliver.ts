import 'server-only'
import { DataPacket_Kind } from 'livekit-server-sdk'
import { roomNameFor, roomService } from '@/lib/livekit/server'
import {
  AUDIO_TTL_SEC,
  audioCache,
  newAudioId,
  type AudioCache,
} from '@/lib/translation/audio-cache'
import type { LanguageResult } from '@/lib/translation/fanout'
import {
  captionMessage,
  encodeInlineAudio,
  encodeMessage,
  MAX_INLINE_AUDIO_BYTES,
  TOPICS,
  type AudioMessage,
  type NoticeMessage,
} from '@/lib/translation/messages'

type Send = (
  sessionId: string,
  data: Uint8Array,
  options: { destinationIdentities: string[]; topic: string },
) => Promise<void>

const sendReliable: Send = (sessionId, data, options) =>
  roomService().sendData(roomNameFor(sessionId), data, DataPacket_Kind.RELIABLE, options)

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
    if (result.audioFormat && bytes.length <= MAX_INLINE_AUDIO_BYTES) {
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
