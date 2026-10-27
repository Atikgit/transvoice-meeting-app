/** Full English language names for the translation prompt ("Bengali", "English", "Spanish (Mexico)"). */
const OVERRIDES: Record<string, string> = { bn: 'Bengali' }

export function languageName(locale: string): string {
  const primary = locale.split('-')[0]!.toLowerCase()
  if (OVERRIDES[primary]) return OVERRIDES[primary]
  try {
    return new Intl.DisplayNames(['en'], { type: 'language', languageDisplay: 'standard' }).of(locale) ?? locale
  } catch {
    return locale
  }
}
