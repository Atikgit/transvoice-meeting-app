import { groupListeners } from '@/lib/translation/fanout'
import { languageOptions, sameLanguage } from '@/lib/transvoice/languages'

/**
 * What an utterance of `speakerLang` turns into for the listeners who are connected right now.
 * The ONE place that decides; /api/translate performs it and /api/translate/status reports it,
 * so the room can never claim something different from what the server does.
 *
 * Input is always the stored meeting_participants values (the session row), nothing else.
 */
export type FanoutReason =
  | 'ok' // at least one listener needs a translation
  | 'same_language' // others are here, but all of them already hear the speaker's language
  | 'no_listeners' // nobody else is connected

export interface FanoutPlan {
  /** Target locale → listener ids. */
  groups: Map<string, string[]>
  reason: FanoutReason
}

export function planFanout(
  speakerLang: string,
  listeners: { userId: string; listenLang: string }[],
): FanoutPlan {
  const groups = groupListeners(listeners, speakerLang)
  return {
    groups,
    reason: groups.size > 0 ? 'ok' : listeners.length > 0 ? 'same_language' : 'no_listeners',
  }
}

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
