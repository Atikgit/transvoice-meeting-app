import 'server-only'
import { z } from 'zod'
import { serverEnv } from '@/lib/env'
import { transvoiceFetch } from '@/lib/transvoice/http'

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
  | {
      kind: 'speech'
      originalText: string
      translatedText: string
      ttsAudio: string
      /** Format the API says the audio is in (audio_format / output_format field), if it says. */
      audioFormat?: AudioFormat
      /** The API's own stage timings, when it sends them. */
      timings?: ApiTimings
    }
  | { kind: 'silence' }

export interface ApiTimings {
  asrMs?: number
  mtMs?: number
  ttsMs?: number
}

export type AudioFormat = 'wav' | 'mp3' | 'opus'

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
  // null/absent when the API had no usable voice: handled as "no audio", not as a bad payload.
  tts_audio: z.string().nullish(),
  // Optional: only an API that supports output_format says which one it used.
  audio_format: z.string().optional(),
  output_format: z.string().optional(),
  // Optional: per-stage timings of the API's own pipeline, if it reports them (nested or flat).
  timings: z
    .object({ asr_ms: z.number(), mt_ms: z.number(), tts_ms: z.number() })
    .partial()
    .optional(),
  asr_ms: z.number().optional(),
  mt_ms: z.number().optional(),
  tts_ms: z.number().optional(),
})
const silenceResponse = z.object({ error: z.literal('Silence') })

export interface TransVoiceClientOptions {
  baseUrl: string
  apiKey: string
  timeoutMs?: number
  /** Asked from the API as output_format when not wav. */
  outputFormat?: AudioFormat
  fetch?: typeof fetch
}

export const DEFAULT_TIMEOUT_MS = 4000

export async function translateSpeech(
  input: TranslateSpeechInput,
  options: TransVoiceClientOptions = defaultOptions(),
): Promise<TranslateSpeechResult> {
  const doFetch = options.fetch ?? transvoiceFetch
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
        // Omitted for wav: an API without the feature never sees an unknown field.
        ...(options.outputFormat && options.outputFormat !== 'wav'
          ? { output_format: options.outputFormat }
          : {}),
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
    ttsAudio: parsed.data.tts_audio ?? '',
    audioFormat: knownFormat(parsed.data.audio_format ?? parsed.data.output_format),
    ...apiTimings(parsed.data),
  }
}

function defaultOptions(): TransVoiceClientOptions {
  const env = serverEnv()
  return {
    baseUrl: env.TRANSVOICE_API_URL,
    apiKey: env.TRANSVOICE_MASTER_API_KEY,
    outputFormat: env.TRANSVOICE_OUTPUT_FORMAT,
  }
}

function knownFormat(value: string | undefined): AudioFormat | undefined {
  const format = value?.trim().toLowerCase()
  return format === 'wav' || format === 'mp3' || format === 'opus' ? format : undefined
}

function apiTimings(data: {
  timings?: { asr_ms?: number; mt_ms?: number; tts_ms?: number }
  asr_ms?: number
  mt_ms?: number
  tts_ms?: number
}): { timings?: ApiTimings } {
  const asrMs = data.timings?.asr_ms ?? data.asr_ms
  const mtMs = data.timings?.mt_ms ?? data.mt_ms
  const ttsMs = data.timings?.tts_ms ?? data.tts_ms
  return asrMs === undefined && mtMs === undefined && ttsMs === undefined
    ? {}
    : { timings: { asrMs, mtMs, ttsMs } }
}
