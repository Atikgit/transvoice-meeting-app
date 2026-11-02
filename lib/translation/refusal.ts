/**
 * Why an utterance was not translated, in one vocabulary shared by the server (translate_decision
 * log, response body) and the speaker's UI (notice + ?debug=1 overlay).
 */
export type RefusalReason =
  | 'allowlist' // the meeting host is not on the beta allow-list
  | 'switched_off' // TRANSLATION_ENABLED=false
  | 'payer_minutes' // the payer (speaker or sponsor) has no minutes
  | 'api_credit' // the Speech API account has no credit (402)
  | 'api_key' // the Speech API rejected our key (401/403)
  | 'circuit_breaker' // too many recent API failures: calls are paused for a moment
  | 'service_error' // the API failed or timed out

export const GATE_REASON = {
  BETA: 'allowlist',
  DISABLED: 'switched_off',
  PAYER_NO_MINUTES: 'payer_minutes',
} as const satisfies Record<string, RefusalReason>

/** The most specific reason among failed languages (credit and key problems first). */
export function refusalFromFailures(
  failed: { reason: 'error' | 'timeout' | 'circuit_open'; status?: number | null }[],
): RefusalReason | null {
  if (failed.length === 0) return null
  if (failed.some((f) => f.status === 402)) return 'api_credit'
  if (failed.some((f) => f.status === 401 || f.status === 403)) return 'api_key'
  if (failed.some((f) => f.reason === 'circuit_open')) return 'circuit_breaker'
  return 'service_error'
}

export function describeRefusal(
  reason: RefusalReason,
  options: { payerIsSpeaker?: boolean } = {},
): string {
  switch (reason) {
    case 'allowlist':
      return 'Translation is off: the host of this meeting is not on the private-beta allow-list (allowlist).'
    case 'switched_off':
      return 'Translation is switched off for the whole service (switched off). Video, voice and chat still work.'
    case 'payer_minutes':
      return options.payerIsSpeaker
        ? 'No translation: you have no minutes left (payer minutes). Get minutes to keep translating.'
        : "No translation: the host's minutes have run out (payer minutes). Chat still works."
    case 'api_credit':
      return 'No translation: the translation service has no credit left (API credit). Please tell support.'
    case 'api_key':
      return 'No translation: the translation service rejected our access key (API key). Please tell support.'
    case 'circuit_breaker':
      return 'Translation is paused for a few seconds after repeated failures (circuit breaker). It resumes by itself.'
    case 'service_error':
      return 'Translation failed for this phrase (service error). It retries with the next one.'
  }
}
