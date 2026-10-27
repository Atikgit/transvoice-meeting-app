'use client'

import { sharedAudioContext } from '@/features/translation/web-audio'

/**
 * Call sounds, synthesised with Web Audio (no audio files): a two-tone ringtone for the person
 * being called and a softer ringback tone for the caller. They use the page's shared
 * AudioContext (unlocked by the first tap / click / key on any signed-in page, see
 * CallSoundsUnlock) and stay silent, without error, while the browser still blocks audio.
 * "Mute call sounds" is a per-device setting (localStorage); the visual alerts do not depend on it.
 */
const MUTE_KEY = 'tv.callSounds.muted'

let mutedValue: boolean | null = null
const subscribers = new Set<() => void>()

export function callSoundsMuted(): boolean {
  if (mutedValue === null) {
    try {
      mutedValue = localStorage.getItem(MUTE_KEY) === '1'
    } catch {
      mutedValue = false
    }
  }
  return mutedValue
}

export function setCallSoundsMuted(muted: boolean): void {
  mutedValue = muted
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    // private window: the choice lasts until the page closes
  }
  for (const notify of subscribers) notify()
}

const DISMISSED_KEY = 'tv.callSounds.bannerDismissed'
let bannerDismissedValue: boolean | null = null

/** Has the "Enable call sounds" banner been closed on this device? */
export function callSoundsBannerDismissed(): boolean {
  if (bannerDismissedValue === null) {
    try {
      bannerDismissedValue = localStorage.getItem(DISMISSED_KEY) === '1'
    } catch {
      bannerDismissedValue = false
    }
  }
  return bannerDismissedValue
}

export function dismissCallSoundsBanner(): void {
  bannerDismissedValue = true
  try {
    localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // shown again next visit
  }
  for (const notify of subscribers) notify()
}

export function subscribeCallSounds(callback: () => void): () => void {
  subscribers.add(callback)
  return () => void subscribers.delete(callback)
}

export interface TonePattern {
  /** One burst of notes repeats every cycle. */
  cycleMs: number
  /** Output level, 0..1 (kept low: it plays on top of whatever else is running). */
  level: number
  notes: { freqs: number[]; startMs: number; durationMs: number }[]
}

/** Incoming: A5 – E5, twice, then a pause (3 s cycle). */
export const RINGTONE: TonePattern = {
  cycleMs: 3000,
  level: 0.22,
  notes: [
    { freqs: [880], startMs: 0, durationMs: 350 },
    { freqs: [659.25], startMs: 400, durationMs: 350 },
    { freqs: [880], startMs: 900, durationMs: 350 },
    { freqs: [659.25], startMs: 1300, durationMs: 350 },
  ],
}

/** Outgoing: the classic 440 + 480 Hz double tone, 1.2 s on / 2.8 s off. */
export const RINGBACK: TonePattern = {
  cycleMs: 4000,
  level: 0.12,
  notes: [{ freqs: [440, 480], startMs: 0, durationMs: 1200 }],
}

const FADE_S = 0.02

/**
 * Plays `pattern` in a loop until the returned function is called (idempotent). Safe when audio
 * is blocked, muted or unavailable: it tries again on the next cycle.
 */
export function startTonePattern(
  pattern: TonePattern,
  context: () => AudioContext | null = sharedAudioContext,
): () => void {
  let stopped = false
  let live: { osc: OscillatorNode; gain: GainNode }[] = []

  const silence = () => {
    const ctx = context()
    for (const { osc, gain } of live) {
      try {
        const now = ctx?.currentTime ?? 0
        gain.gain.cancelScheduledValues(now)
        gain.gain.setTargetAtTime(0, now, FADE_S / 3)
        osc.stop(now + FADE_S * 2)
      } catch {
        // already stopped
      }
    }
    live = []
  }

  const cycle = () => {
    if (stopped || callSoundsMuted()) return
    const ctx = context()
    if (!ctx) return
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    if (ctx.state !== 'running') return
    const origin = ctx.currentTime + 0.02
    for (const note of pattern.notes) {
      const start = origin + note.startMs / 1000
      const end = start + note.durationMs / 1000
      for (const freq of note.freqs) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq
        const level = pattern.level / note.freqs.length
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(level, start + FADE_S)
        gain.gain.setValueAtTime(level, end - FADE_S)
        gain.gain.linearRampToValueAtTime(0, end)
        osc.connect(gain).connect(ctx.destination)
        osc.start(start)
        osc.stop(end + FADE_S)
        const entry = { osc, gain }
        live.push(entry)
        osc.onended = () => {
          live = live.filter((l) => l !== entry)
        }
      }
    }
  }

  cycle()
  const timer = setInterval(cycle, pattern.cycleMs)
  const unsubscribe = subscribeCallSounds(() => {
    if (callSoundsMuted()) silence()
    else cycle()
  })
  return () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    unsubscribe()
    silence()
  }
}

export const startRingtone = () => startTonePattern(RINGTONE)
export const startRingback = () => startTonePattern(RINGBACK)

/** One pass of the ringtone, for the Settings preview and the "Enable call sounds" button. */
export function previewRingtone(): () => void {
  const stop = startRingtone()
  const timer = setTimeout(stop, 1800)
  return () => {
    clearTimeout(timer)
    stop()
  }
}
