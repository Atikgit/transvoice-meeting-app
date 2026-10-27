'use client'

/**
 * Alerts for a ringing call that do not need sound: the tab title flashes, a phone vibrates, and
 * (once the user allowed it) the system shows a notification while the tab is in the background.
 * Independent of the "Mute call sounds" setting.
 */
export interface AlertDeps {
  document: Document
  navigator: Navigator
  /** Undefined where the Notification API does not exist. */
  Notification?: typeof Notification
  focus: () => void
}

const browserDeps = (): AlertDeps => ({
  document,
  navigator,
  Notification: typeof Notification === 'undefined' ? undefined : Notification,
  focus: () => window.focus(),
})

export const TITLE_FLASH_MS = 1000
export const VIBRATE_EVERY_MS = 2000
const VIBRATE_PATTERN = [400, 200, 400]

export function startCallAlerts(callerName: string, deps: AlertDeps = browserDeps()): () => void {
  const { document: doc, navigator: nav } = deps
  const original = doc.title
  const message = `📞 Incoming call from ${callerName}`
  let flashed = false
  const flash = setInterval(() => {
    flashed = !flashed
    doc.title = flashed ? message : original
  }, TITLE_FLASH_MS)
  doc.title = message
  flashed = true

  const vibrate = () => nav.vibrate?.(VIBRATE_PATTERN)
  vibrate()
  const buzz =
    typeof nav.vibrate === 'function' ? setInterval(vibrate, VIBRATE_EVERY_MS) : undefined

  let notification: Notification | undefined
  if (deps.Notification?.permission === 'granted' && (doc.hidden || !doc.hasFocus())) {
    try {
      notification = new deps.Notification('Incoming call', {
        body: `${callerName} is calling you on TransVoice`,
        tag: 'incoming-call',
        requireInteraction: true,
      })
      notification.onclick = () => {
        deps.focus()
        notification?.close()
      }
    } catch {
      // some mobile browsers only allow notifications through a service worker
    }
  }

  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    clearInterval(flash)
    if (buzz) clearInterval(buzz)
    nav.vibrate?.(0)
    doc.title = original
    notification?.close()
  }
}

/**
 * Asks for the notification permission. Call it only from a click or tap handler: browsers
 * ignore (or punish) a prompt that was not asked for by the user.
 */
export async function requestNotificationPermission(
  NotificationApi: typeof Notification | undefined = typeof Notification === 'undefined'
    ? undefined
    : Notification,
): Promise<NotificationPermission | 'unsupported'> {
  if (!NotificationApi) return 'unsupported'
  if (NotificationApi.permission !== 'default') return NotificationApi.permission
  try {
    return await NotificationApi.requestPermission()
  } catch {
    return NotificationApi.permission
  }
}
