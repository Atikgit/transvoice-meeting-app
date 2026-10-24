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
  encodeMessage,
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
  const captionSent = send(sessionId, encodeMessage(caption), {
    destinationIdentities,
    topic: TOPICS.caption,
  })

  let audioMs = -1
  if (result.ttsAudio) {
    const id = newAudioId()
    await cache.put(
      id,
      {
        audio: Buffer.from(result.ttsAudio, 'base64'),
        mime: 'audio/wav',
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
    await captionSent
    await send(sessionId, encodeMessage(audio), { destinationIdentities, topic: TOPICS.audio })
    audioMs = now() - started
  }
  await captionSent
  return { captionMs: now() - started, audioMs }
}
