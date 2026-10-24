/** Rolling caption log: the bar shows the last two lines of original and translated text. */
export interface CaptionEntry {
  id: string
  /** Who spoke: me (original transcript only) or someone else (original + translation). */
  from: 'self' | 'other'
  original: string
  translated: string
}

const KEEP = 4

export function addCaption(log: CaptionEntry[], entry: CaptionEntry): CaptionEntry[] {
  const next = log.some((e) => e.id === entry.id && e.from === entry.from)
    ? log.map((e) => (e.id === entry.id && e.from === entry.from ? entry : e))
    : [...log, entry]
  return next.slice(-KEEP)
}

/** Text for the caption bar: the last entries joined; the bar itself fades older lines. */
export function captionText(log: CaptionEntry[]): { original: string; translated: string } {
  const recent = log.slice(-3)
  return {
    original: recent
      .map((e) => e.original)
      .filter(Boolean)
      .join(' '),
    translated: recent
      .map((e) => e.translated)
      .filter(Boolean)
      .join(' '),
  }
}
