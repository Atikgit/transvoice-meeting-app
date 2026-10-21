import { http, HttpResponse } from 'msw'
import { TEST_ENV } from './env'

/** Request body the TransVoice Speech API receives (see docs/PROMPT.md §2). */
export interface TransVoiceRequestBody {
  audio: string
  src_lang: string
  tgt_lang: string
  azure_voice: string
  session_id?: string
  speaker_id?: string
}

/** Audio payload the mock treats as "no speech detected". */
export const SILENT_AUDIO = 'U0lMRU5DRQ=='

export const FAKE_TRANSLATIONS: Record<string, string> = {
  en: 'Hello, how are you?',
  bn: 'হ্যালো, আপনি কেমন আছেন?',
  es: 'Hola, ¿cómo estás?',
}

/** Default happy-path handler mirroring the real contract. */
export const transvoiceHandlers = [
  http.post(`${TEST_ENV.TRANSVOICE_API_URL}/`, async ({ request }) => {
    if (request.headers.get('authorization') !== `Bearer ${TEST_ENV.TRANSVOICE_MASTER_API_KEY}`) {
      return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = (await request.json()) as TransVoiceRequestBody
    if (body.audio === SILENT_AUDIO) return HttpResponse.json({ error: 'Silence' })

    return HttpResponse.json({
      original_text: 'হ্যালো, আপনি কেমন আছেন?',
      translated_text: FAKE_TRANSLATIONS[body.tgt_lang] ?? `[${body.tgt_lang}] translation`,
      tts_audio: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=',
    })
  }),
]
