import { groupListeners } from '@/lib/translation/fanout'

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
