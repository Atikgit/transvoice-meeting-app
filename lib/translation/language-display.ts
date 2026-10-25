import { languageOptions, sameLanguage } from '@/lib/transvoice/languages'

/**
 * Client-safe language helpers for the room (no server-only imports, unlike plan.ts, so client
 * components may use them).
 */

/** "bn-BD" → "Bangla"; the picker label without its region. */
export function shortLanguageName(code: string): string {
  const label = languageOptions.find((l) => l.code === code)?.label
  return label ? label.replace(/\s*\(.*\)\s*$/, '') : code
}

/**
 * Both people have set "I want to hear" to the language the OTHER one speaks, so each hears the
 * other's original voice and nothing is translated. That is the usual mix-up: "I want to hear"
 * is the language *you* understand (normally your own), not the one your partner should get.
 */
export function looksSwapped(
  me: { spokenLang: string; listenLang: string },
  other: { spokenLang: string; listenLang: string },
): boolean {
  return (
    !sameLanguage(me.spokenLang, other.spokenLang) &&
    sameLanguage(me.listenLang, other.spokenLang) &&
    sameLanguage(other.listenLang, me.spokenLang)
  )
}
