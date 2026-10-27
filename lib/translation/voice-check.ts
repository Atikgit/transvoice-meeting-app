import 'server-only'
import { serverEnv } from '@/lib/env'
import { languageOptions } from '@/lib/transvoice/languages'
import { transvoiceFetch } from '@/lib/transvoice/http'
import { findVoice, voiceMapping, type VoiceGender } from '@/lib/transvoice/voices'

const GENDERS: VoiceGender[] = ['male', 'female']

/** Configuration check (no API call): every listed language has a well-formed voice per gender. */
export function staticVoiceReport(): { languages: number; problems: string[] } {
  const problems: string[] = []
  for (const { code } of languageOptions) {
    const entry = voiceMapping[code]
    if (!entry) {
      problems.push(`${code}: no voice entry`)
      continue
    }
    for (const gender of GENDERS) {
      const voice = findVoice(code, gender)
      if (!voice || !voice.startsWith(`${code}-`) || !voice.endsWith('Neural'))
        problems.push(`${code}/${gender}: ${voice ?? 'missing'} does not match the locale`)
    }
  }
  return { languages: languageOptions.length, problems }
}

export interface VoiceCheck {
  voice: string
  gender: VoiceGender
  ok: boolean
  /** HTTP status of the API, null = no answer. */
  status: number | null
  bytes: number
  ms: number
}

/**
 * Asks the API's /v1/tts for a few digits in one voice: an unknown, misspelt or wrong-language
 * voice gives an error or an empty body there. Tiny and independent of the speech engine
 * (no ASR / translation). Callers must run these one at a time.
 */
export async function checkVoice(voice: string, gender: VoiceGender): Promise<VoiceCheck> {
  const env = serverEnv()
  const started = performance.now()
  const ms = () => Math.round(performance.now() - started)
  try {
    const res = await transvoiceFetch(`${env.TRANSVOICE_API_URL.replace(/\/+$/, '')}/v1/tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.TRANSVOICE_MASTER_API_KEY}`,
      },
      body: JSON.stringify({ text: '1, 2, 3.', voice }),
      signal: AbortSignal.timeout(6000),
    })
    const bytes = (await res.arrayBuffer()).byteLength
    // An MP3 of three spoken digits is several KiB; an empty answer is a few dozen bytes.
    return { voice, gender, ok: res.ok && bytes > 1000, status: res.status, bytes, ms: ms() }
  } catch {
    return { voice, gender, ok: false, status: null, bytes: 0, ms: ms() }
  }
}

/** Both genders of one locale, sequentially. */
export async function checkLocaleVoices(
  locale: string,
  check: typeof checkVoice = checkVoice,
): Promise<VoiceCheck[]> {
  const results: VoiceCheck[] = []
  for (const gender of GENDERS) {
    const voice = findVoice(locale, gender)
    results.push(
      voice
        ? await check(voice, gender)
        : { voice: 'none', gender, ok: false, status: null, bytes: 0, ms: 0 },
    )
  }
  return results
}
