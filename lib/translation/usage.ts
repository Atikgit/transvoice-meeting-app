import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { wavSeconds } from '@/lib/translation/wav'

/**
 * api_usage_events: how many seconds of the speaker's audio the TransVoice API processed, per
 * target language. Cost/margin reporting only (admin.session_costs); it never affects what a
 * payer is charged. One row per successful API call (speech or silence), request_id unique so a
 * retry or a replayed request cannot count twice. Ids and numbers only: no text, no audio.
 */
export interface UsageInput {
  sessionId: string
  speakerId: string
  utteranceId: string
  seq?: number
  audio: Uint8Array
  format: 'wav' | 'opus'
  /** Target languages whose API call succeeded (speech or silence). */
  languages: string[]
}

export function usageRows(input: UsageInput) {
  // WAV length is exact. Opus uploads carry no duration, so they are not recorded rather than guessed.
  if (input.format !== 'wav') return []
  const seconds = Math.round(wavSeconds(input.audio.length) * 1000) / 1000
  return input.languages.map((lang) => ({
    request_id: `${input.utteranceId}:${input.seq ?? 0}:${lang}`,
    session_id: input.sessionId,
    speaker_id: input.speakerId,
    target_lang: lang,
    speech_seconds: seconds,
  }))
}

/** Never throws and never delays the answer to the speaker. */
export function recordApiUsage(input: UsageInput): void {
  const rows = usageRows(input)
  if (rows.length === 0) return
  void (async () => {
    try {
      const { error } = await createAdminClient()
        .from('api_usage_events')
        .upsert(rows, { onConflict: 'request_id', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: 'api_usage_failed',
          rows: rows.length,
          error: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
        }),
      )
    }
  })()
}
