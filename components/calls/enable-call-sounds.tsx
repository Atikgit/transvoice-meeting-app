'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { Button } from '@/components/common/button'
import { requestNotificationPermission } from '@/features/calls/call-alerts'
import {
  callSoundsBannerDismissed,
  callSoundsMuted,
  dismissCallSoundsBanner,
  previewRingtone,
  setCallSoundsMuted,
  subscribeCallSounds,
} from '@/features/calls/call-sounds'
import {
  audioContextState,
  onAudioStateChange,
  unlockAudio,
  unlockAudioOnFirstGesture,
} from '@/features/translation/web-audio'

/** Browsers allow sound only after a tap, click or key press: the first one on any signed-in page unlocks it. */
export function useUnlockCallSounds(): void {
  useEffect(() => unlockAudioOnFirstGesture(), [])
}

/** Is the shared AudioContext running? (false until the browser lets this page make sound). */
export function useAudioRunning(): boolean {
  const [running, setRunning] = useState(false)
  useEffect(() => {
    const sync = () => setRunning(audioContextState() === 'running')
    sync()
    const off = onAudioStateChange(sync)
    const timer = setInterval(sync, 1000)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [])
  return running
}

export function useCallSoundsMuted(): boolean {
  return useSyncExternalStore(subscribeCallSounds, callSoundsMuted, () => false)
}

/**
 * Dashboard banner shown once when the browser still blocks sound: one click enables the ringtone
 * (and asks for notification permission, which is only allowed after a click like this one).
 */
export function EnableCallSoundsBanner() {
  const running = useAudioRunning()
  const muted = useCallSoundsMuted()
  // Hidden on the server and until localStorage has been read.
  const dismissed = useSyncExternalStore(subscribeCallSounds, callSoundsBannerDismissed, () => true)
  if (running || muted || dismissed) return null

  const dismiss = dismissCallSoundsBanner
  return (
    <div
      role="region"
      aria-label="Call sounds"
      className="mx-auto mt-4 flex max-w-5xl flex-wrap items-center gap-3 rounded-2xl border border-cyan-300/25 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100"
    >
      <Bell size={16} aria-hidden />
      <span className="min-w-0 flex-1">
        Your browser blocks sound, so incoming calls would not ring.
      </span>
      <Button
        onClick={() => {
          void unlockAudio().then((ok) => {
            if (ok) previewRingtone()
          })
          void requestNotificationPermission()
          dismiss()
        }}
      >
        Enable call sounds
      </Button>
      <button type="button" onClick={dismiss} className="text-xs text-cyan-200/70 underline">
        Not now
      </button>
    </div>
  )
}

/** Settings: mute toggle, preview and notification permission. Per device (stored in this browser). */
export function CallSoundsSetting() {
  const muted = useCallSoundsMuted()
  const current = useSyncExternalStore(
    () => () => {},
    () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission),
    () => 'unsupported',
  )
  const [asked, setAsked] = useState<string>()
  const permission = asked ?? current
  const setPermission = setAsked
  return (
    <section
      aria-labelledby="call-sounds-title"
      className="mt-6 rounded-3xl border border-white/10 bg-[#151b29] p-6 sm:p-8"
    >
      <h2 id="call-sounds-title" className="text-sm font-semibold text-white">
        Call sounds
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        These settings are kept on this device. The flashing tab title, vibration and notification
        still alert you when the ringtone is muted.
      </p>
      <label className="mt-4 flex items-center gap-3 text-sm text-slate-200">
        <input
          type="checkbox"
          checked={muted}
          onChange={(event) => setCallSoundsMuted(event.target.checked)}
          className="size-4 accent-cyan-300"
        />
        Mute call sounds (ringtone and ringback)
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={muted}
          onClick={() => void unlockAudio().then((ok) => ok && previewRingtone())}
        >
          Play ringtone
        </Button>
        {permission === 'default' && (
          <Button
            type="button"
            variant="outline"
            onClick={() => void requestNotificationPermission().then(setPermission)}
          >
            <Bell size={14} /> Allow call notifications
          </Button>
        )}
        {permission === 'denied' && (
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <BellOff size={14} /> Notifications are blocked in the browser settings.
          </span>
        )}
        {permission === 'granted' && (
          <span className="text-xs text-slate-500">Call notifications are on.</span>
        )}
      </div>
    </section>
  )
}
