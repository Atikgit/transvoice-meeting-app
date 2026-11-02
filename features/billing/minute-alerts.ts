/** The payer's minute warnings: a toast at 5 and at 1 minute left, a standing message at 0. */
export type MinuteAlert = 'five' | 'one' | 'zero'

export interface AlertState {
  five: boolean
  one: boolean
}

export const NO_ALERTS: AlertState = { five: false, one: false }

/**
 * Which alert (if any) the new balance triggers. Each of 5 / 1 fires once per downward crossing;
 * topping up above the threshold re-arms it. `left` is null when there is no countdown (postpaid).
 * Returns the alert to show (the most urgent crossed) and the updated state.
 */
export function nextAlert(
  left: number | null,
  state: AlertState,
): { alert: MinuteAlert | null; state: AlertState } {
  if (left === null) return { alert: null, state: NO_ALERTS }
  const next: AlertState = {
    five: left <= 5 ? state.five : false,
    one: left <= 1 ? state.one : false,
  }
  if (left <= 0) return { alert: 'zero', state: { five: true, one: true } }
  if (left <= 1 && !state.one) return { alert: 'one', state: { five: true, one: true } }
  if (left <= 5 && !state.five) return { alert: 'five', state: { ...next, five: true } }
  return { alert: null, state: next }
}

export function alertText(alert: MinuteAlert, left: number | null): string {
  switch (alert) {
    case 'five':
      return `${Math.max(1, Math.ceil(left ?? 5))} minutes left.`
    case 'one':
      return '1 minute left.'
    case 'zero':
      return "You're out of minutes. Translation has stopped; the call and chat continue."
  }
}
