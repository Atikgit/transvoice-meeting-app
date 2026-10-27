import { NextResponse, type NextRequest } from 'next/server'
import { serverEnv } from '@/lib/env'
import { checkRateLimit } from '@/lib/rate-limit'
import { getSessionUser } from '@/lib/supabase/server'
import { betaAllows } from '@/lib/translation/gate'
import { checkLocaleVoices, staticVoiceReport } from '@/lib/translation/voice-check'
import { normalizeLocale } from '@/lib/transvoice/languages'

/**
 * GET /api/translate/voices[?lang=bn-BD&lang=en-US] — voice self-test.
 *  - always: the configuration check (every listed language has a male and a female voice that
 *    matches its locale; no API call);
 *  - per `lang` (max 3): both voices of that locale are asked from the API's /v1/tts, one request
 *    at a time, so an unknown or wrong-language voice shows up before a meeting does.
 * Allow-listed hosts only (it spends API calls); the answer has voice names and sizes, nothing else.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  if (!betaAllows(user.email, serverEnv().TRANSLATION_BETA_ALLOWLIST))
    return NextResponse.json({ error: 'Not available.' }, { status: 403 })
  if (!(await checkRateLimit('translate', user.id)))
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })

  const langs = [...new Set(request.nextUrl.searchParams.getAll('lang').map(normalizeLocale))]
  const report = staticVoiceReport()
  const live = []
  for (const lang of langs.slice(0, 3)) {
    const voices = await checkLocaleVoices(lang)
    live.push({ lang, ok: voices.every((v) => v.ok), voices })
  }
  return NextResponse.json({
    config: { ...report, ok: report.problems.length === 0 },
    live,
    skipped: langs.slice(3),
  })
}
