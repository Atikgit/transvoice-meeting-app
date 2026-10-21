import 'server-only'
import { z } from 'zod'
import { serverEnv } from '@/lib/env'

/**
 * Typed client for the TransVoice Speech API (Whisper ASR → translation → Azure Neural TTS,
 * served by Triton on an Azure VM). One call returns transcript + translation + TTS audio.
 */

export interface TranslateSpeechInput {
  /** Base64 webm/opus or wav audio. */
  audio: string
  /** API language code ("bn", "en", …) or "auto". */
  srcLang: string
  /** API language code of the listener. */
  tgtLang: string
  azureVoice: string
  /** Lets the API server tag its usage reports. */
  sessionId?: string
  speakerId?: string
}

export type TranslateSpeechResult =
  | { kind: 'speech'; originalText: string; translatedText: string; ttsAudio: string }
  | { kind: 'silence' }

export class TransVoiceApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** True for network errors, timeouts and 5xx — safe to retry. */
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'TransVoiceApiError'
  }
}

const speechResponse = z.object({
  original_text: z.string(),
  translated_text: z.string(),
  tts_audio: z.string(),
})
const silenceResponse = z.object({ error: z.literal('Silence') })

export interface TransVoiceClientOptions {
  baseUrl: string
  apiKey: string
  timeoutMs?: number
  fetch?: typeof fetch
}

export const DEFAULT_TIMEOUT_MS = 4000

export async function translateSpeech(
  input: TranslateSpeechInput,
  options: TransVoiceClientOptions = defaultOptions(),
): Promise<TranslateSpeechResult> {
  const doFetch = options.fetch ?? fetch
  const url = `${options.baseUrl.replace(/\/+$/, '')}/`

  let response: Response
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        audio: input.audio,
        src_lang: input.srcLang,
        tgt_lang: input.tgtLang,
        azure_voice: input.azureVoice,
        session_id: input.sessionId,
        speaker_id: input.speakerId,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new TransVoiceApiError(`TransVoice API request failed: ${reason}`, null, true)
  }

  if (!response.ok) {
    throw new TransVoiceApiError(
      `TransVoice API responded ${response.status}`,
      response.status,
      response.status >= 500,
    )
  }

  const body: unknown = await response.json().catch(() => null)

  if (silenceResponse.safeParse(body).success) return { kind: 'silence' }

  const parsed = speechResponse.safeParse(body)
  if (!parsed.success) {
    throw new TransVoiceApiError(
      'TransVoice API returned an unexpected payload',
      response.status,
      false,
    )
  }

  return {
    kind: 'speech',
    originalText: parsed.data.original_text,
    translatedText: parsed.data.translated_text,
    ttsAudio: parsed.data.tts_audio,
  }
}

function defaultOptions(): TransVoiceClientOptions {
  const env = serverEnv()
  return { baseUrl: env.TRANSVOICE_API_URL, apiKey: env.TRANSVOICE_MASTER_API_KEY }
}
