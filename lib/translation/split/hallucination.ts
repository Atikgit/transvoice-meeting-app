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
