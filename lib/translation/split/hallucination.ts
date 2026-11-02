/** What the speech-to-text returns for silence and noise: words nobody said. */
const HALLUCINATIONS = new Set([
  'you',
  'you.',
  'thank you',
  'thank you.',
  'i',
  'i.',
  'am i',
  'am i?',
])

/** True when a transcript is empty, a single character or one of the known phantom phrases. */
export function isHallucination(text: string | null | undefined): boolean {
  const normalized = (text ?? '').trim().toLowerCase()
  return normalized.length < 2 || HALLUCINATIONS.has(normalized)
}

/** What the speech-to-text returned, without the text: why an utterance was or was not dropped. */
export type SttClass = 'empty' | 'single_char' | 'filtered_phantom' | 'text'

/** isHallucination(text) is true exactly when this is not 'text'. */
export function classifyStt(text: string | null | undefined): SttClass {
  const normalized = (text ?? '').trim().toLowerCase()
  if (normalized.length === 0) return 'empty'
  if (normalized.length < 2) return 'single_char'
  return HALLUCINATIONS.has(normalized) ? 'filtered_phantom' : 'text'
}
