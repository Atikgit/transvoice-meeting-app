'use client'

import { useSyncExternalStore } from 'react'

/**
 * Live translation diagnostics for the room's `?debug=1` overlay. The hooks write what they
 * see; nothing is recorded unless the overlay is mounted (enableTranslationDebug), and nothing
 * leaves the browser. No transcripts or audio, only sizes, timings, states and language codes.
 */
export interface TranslationDebug {
  vad: 'off' | 'loading' | 'ready' | 'error'
  vadError?: string
  vadListening: boolean
  vadSpeaking: boolean
  /** The inputs of shouldListen(), as the hook sees them right now. */
  gate: {
    status: string
    remotes: number
    micEnabled: boolean
    playingTranslation: boolean
    translationEnabled: boolean
  }
  lastUtterance?: { ms: number; bytes: number; at: number }
  lastTranslate?: { status: number | 'network'; ms: number; at: number; note?: string }
  lastCaption?: { lang: string; at: number }
  lastAudio?: { via: 'url' | 'inline'; status: 'ok' | number | 'error'; ms: number; at: number }
  queue: number
  /** The last change of a speaker's original-voice volume (translation ducking). */
  lastDuck?: { speakerId: string; volume: number; reason: string; at: number }
  /** Languages the server translated into for the last utterance (listener languages). */
  listenerLanguages?: string[]
}

const INITIAL: TranslationDebug = {
  vad: 'off',
  vadListening: false,
  vadSpeaking: false,
  gate: {
    status: 'ready',
    remotes: 0,
    micEnabled: false,
    playingTranslation: false,
    translationEnabled: true,
  },
  queue: 0,
}

let state = INITIAL
let enabled = false
const listeners = new Set<() => void>()

export function enableTranslationDebug(on: boolean) {
  enabled = on
  if (!on) {
    state = INITIAL
    lastSamples = null
  }
}

export function setTranslationDebug(patch: Partial<TranslationDebug>) {
  if (!enabled) return
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function useTranslationDebug(): TranslationDebug {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    () => state,
    () => INITIAL,
  )
}

/** The last utterance the VAD cut (kept in memory only while the overlay is mounted), for "Send test clip". */
let lastSamples: Float32Array | null = null
export function rememberUtterance(samples: Float32Array) {
  if (enabled) lastSamples = samples
}
export function lastUtteranceSamples(): Float32Array | null {
  return lastSamples
}
