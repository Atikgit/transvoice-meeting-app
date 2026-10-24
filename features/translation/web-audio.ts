'use client'

/**
 * Web Audio output for translated clips. One AudioContext per page, created and resumed from a
 * user gesture (iOS Safari and Chrome block audio otherwise): call unlockAudio() from the
 * Start / Join / any click handler.
 */
let context: AudioContext | null = null

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  context ??= new Ctor({ latencyHint: 'interactive' })
  return context
}

/** The page's shared AudioContext (created on first use), for the VAD and for playback. */
export function sharedAudioContext(): AudioContext | null {
  return audioContext()
}

/** Resumes (or creates) the context. Safe to call repeatedly; returns whether audio can play. */
export async function unlockAudio(): Promise<boolean> {
  const ctx = audioContext()
  if (!ctx) return false
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
  return ctx.state === 'running'
}

/** Registers one-time gesture listeners that unlock audio on the first tap, click or key. */
export function unlockAudioOnFirstGesture(): () => void {
  const unlock = () => void unlockAudio()
  const events = ['pointerdown', 'touchend', 'keydown'] as const
  for (const e of events) window.addEventListener(e, unlock, { once: true, passive: true })
  return () => {
    for (const e of events) window.removeEventListener(e, unlock)
  }
}

export async function fetchAndDecode(url: string): Promise<AudioBuffer> {
  const ctx = audioContext()
  if (!ctx) throw new Error('Web Audio is not available')
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
  if (!res.ok) throw new Error(`Clip responded ${res.status}`)
  return ctx.decodeAudioData(await res.arrayBuffer())
}

/** Plays a decoded clip; resolves when it ends. */
export function playBuffer(buffer: AudioBuffer): Promise<void> {
  const ctx = audioContext()
  if (!ctx) return Promise.reject(new Error('Web Audio is not available'))
  return new Promise((resolve) => {
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.onended = () => resolve()
    source.start()
  })
}
