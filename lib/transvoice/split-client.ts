import 'server-only'
import { serverEnv } from '@/lib/env'
import { transvoiceFetch } from '@/lib/transvoice/http'
import { languageName } from '@/lib/translation/split/language-name'

/**
 * The three building blocks of the split pipeline, against what the Speech API serves today:
 * POST /v1/stt, POST /v1/tts and a streaming translator (OpenAI directly, or the API's /v1/chat).
 * Every call has its own 4 s limit; any failure throws SplitStepError and the caller falls back to
 * the single POST / path. Nothing here logs text or audio.
 */
export const STEP_TIMEOUT_MS = 4000

export class SplitStepError extends Error {
  constructor(
    readonly step: 'stt' | 'translate' | 'tts',
    message: string,
    readonly status: number | null = null,
  ) {
    super(`${step}: ${message}`)
    this.name = 'SplitStepError'
  }
}

export interface SplitConfig {
  baseUrl: string
  apiKey: string
  openaiKey?: string
  model: string
  provider: 'openai' | 'api-chat'
  timeoutMs?: number
  fetch?: typeof fetch
}

export function splitConfig(): SplitConfig {
  const env = serverEnv()
  return {
    baseUrl: env.TRANSVOICE_API_URL.replace(/\/+$/, ''),
    apiKey: env.TRANSVOICE_MASTER_API_KEY,
    openaiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_TRANSLATE_MODEL,
    provider: env.TRANSLATE_PROVIDER,
  }
}

/** Is a translator configured for the split pipeline? OpenAI wins when its key is set. */
export function translatorKind(config: SplitConfig): 'openai' | 'api-chat' | null {
  if (config.openaiKey) return 'openai'
  return config.provider === 'api-chat' ? 'api-chat' : null
}

const apiFetch = (config: SplitConfig) => config.fetch ?? transvoiceFetch
const post = (config: SplitConfig, path: string, body: unknown, signal: AbortSignal) =>
  apiFetch(config)(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(body),
    signal,
  })

/** Speech to text, once per utterance. "" means silence. */
export async function transcribe(
  config: SplitConfig,
  audioBase64: string,
  ext: 'wav' | 'ogg' | 'webm',
  lang: string,
): Promise<{ text: string; durationS: number }> {
  try {
    const res = await post(
      config,
      '/v1/stt',
      { audio: audioBase64, ext, lang },
      AbortSignal.timeout(config.timeoutMs ?? STEP_TIMEOUT_MS),
    )
    if (!res.ok) throw new SplitStepError('stt', `responded ${res.status}`, res.status)
    const body = (await res.json().catch(() => null)) as {
      text?: unknown
      duration_s?: unknown
    } | null
    if (!body || typeof body.text !== 'string')
      throw new SplitStepError('stt', 'unexpected payload', res.status)
    return { text: body.text, durationS: Number(body.duration_s) || 0 }
  } catch (error) {
    throw asStepError('stt', error)
  }
}

/** Text to speech: the whole mp3 plus how long the first byte took. */
export async function synthesize(
  config: SplitConfig,
  text: string,
  voice: string,
): Promise<{ audio: Uint8Array; firstByteMs: number }> {
  const started = performance.now()
  try {
    const res = await post(
      config,
      '/v1/tts',
      { text: text.slice(0, 3000), voice },
      AbortSignal.timeout(config.timeoutMs ?? STEP_TIMEOUT_MS),
    )
    if (!res.ok || !res.body) throw new SplitStepError('tts', `responded ${res.status}`, res.status)
    const reader = res.body.getReader()
    const parts: Uint8Array[] = []
    let firstByteMs = -1
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (firstByteMs < 0) firstByteMs = Math.round(performance.now() - started)
      parts.push(value)
    }
    const audio = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) {
      audio.set(p, at)
      at += p.length
    }
    return { audio, firstByteMs: Math.max(0, firstByteMs) }
  } catch (error) {
    throw asStepError('tts', error)
  }
}

/** The same instruction the Speech API itself uses, with a full language name. */
export function translationPrompt(locale: string): string {
  return (
    `You are a professional translator. Translate the given text accurately to ${languageName(locale)}. ` +
    `Output ONLY the translated text. If the text is completely empty, background noise, or just isolated ` +
    `conversational fillers like 'hi', 'hello', 'you', output ONLY the exact word 'Silence'.`
  )
}

/** Streams the translation as text pieces. */
export async function* streamTranslation(
  config: SplitConfig,
  text: string,
  locale: string,
): AsyncGenerator<string> {
  const kind = translatorKind(config)
  if (!kind) throw new SplitStepError('translate', 'no translator configured')
  const signal = AbortSignal.timeout(config.timeoutMs ?? STEP_TIMEOUT_MS)
  const system = translationPrompt(locale)
  try {
    if (kind === 'openai') {
      const res = await (config.fetch ?? fetch)('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.openaiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          stream: true,
          temperature: 0,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: text },
          ],
        }),
        signal,
      })
      if (!res.ok || !res.body)
        throw new SplitStepError('translate', `OpenAI responded ${res.status}`, res.status)
      yield* sseContent(res.body)
    } else {
      // The API's /v1/chat takes the instruction as a top-level `system` (a system-role message is
      // ignored there) and streams plain text.
      const res = await post(
        config,
        '/v1/chat',
        { system, messages: [{ role: 'user', content: text }] },
        signal,
      )
      if (!res.ok || !res.body)
        throw new SplitStepError('translate', `chat responded ${res.status}`, res.status)
      const decoder = new TextDecoder()
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        yield decoder.decode(value, { stream: true })
      }
    }
  } catch (error) {
    throw asStepError('translate', error)
  }
}

/** Text deltas of an OpenAI chat-completions event stream. */
async function* sseContent(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const delta = (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] })
          .choices?.[0]?.delta?.content
        if (delta) yield delta
      } catch {
        // a keep-alive or partial line
      }
    }
  }
}

function asStepError(step: 'stt' | 'translate' | 'tts', error: unknown): SplitStepError {
  if (error instanceof SplitStepError) return error
  const message = error instanceof Error ? error.message.slice(0, 100) : 'failed'
  return new SplitStepError(step, /abort|timeout/i.test(message) ? 'timeout' : message)
}
