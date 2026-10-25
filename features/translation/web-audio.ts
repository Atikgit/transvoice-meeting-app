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
  // A suspended context accepts start() and then never plays or ends: fail instead of hanging.
  if (ctx.state !== 'running') return Promise.reject(new Error('Audio is blocked'))
  return new Promise((resolve) => {
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.onended = () => resolve()
    source.start()
  })
}

/** Is the shared AudioContext running (false before the first user gesture on iOS / Android)? */
export function audioIsRunning(): boolean {
  return context?.state === 'running'
}

/** Calls back when the shared context starts or stops running. */
export function onAudioStateChange(callback: () => void): () => void {
  const ctx = audioContext()
  ctx?.addEventListener('statechange', callback)
  return () => ctx?.removeEventListener('statechange', callback)
}

/** 'none' before the context exists (or where Web Audio is missing), else its state. */
export function audioContextState(): string {
  return context?.state ?? 'none'
}

/** Decodes a clip that arrived inside a data packet (the bytes are copied: decoding detaches them). */
export async function decodeBytes(data: Uint8Array): Promise<AudioBuffer> {
  const ctx = audioContext()
  if (!ctx) throw new Error('Web Audio is not available')
  return ctx.decodeAudioData(data.slice().buffer)
}

/**
 * A short 440 Hz beep through the same AudioContext the translated clips use: tells whether sound
 * can come out of this browser/device at all. Call from a click. Returns what happened.
 */
export async function playTestBeep(): Promise<string> {
  const ok = await unlockAudio()
  const ctx = audioContext()
  if (!ctx || !ok) return `blocked (AudioContext ${ctx?.state ?? 'none'})`
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  gain.gain.value = 0.2
  osc.frequency.value = 440
  osc.connect(gain).connect(ctx.destination)
  osc.start()
  osc.stop(ctx.currentTime + 0.4)
  return `played (AudioContext ${ctx.state}, sample rate ${ctx.sampleRate})`
}
