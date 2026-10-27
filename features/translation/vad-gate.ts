/**
 * When the microphone may be listened to for translation (§8). VAD runs only when the session
 * is live, at least two people are connected, the user's mic is unmuted, and no translated clip
 * is playing locally — otherwise the TTS coming out of the speakers would be re-translated.
 */
export interface ListenConditions {
  status: 'ready' | 'live' | 'ended'
  connectedParticipants: number
  micEnabled: boolean
  playingTranslation: boolean
}

export function shouldListen(c: ListenConditions): boolean {
  return (
    c.status === 'live' && c.connectedParticipants >= 2 && c.micEnabled && !c.playingTranslation
  )
}

/** VAD tuning: 400 ms end-of-speech pause (VAD_END_SILENCE_MS), 300 ms minimum speech, 12 s maximum utterance. */
export const VAD_SETTINGS = {
  redemptionMs: 400,
  minSpeechMs: 300,
  preSpeechPadMs: 300,
  maxUtteranceMs: 12_000,
  /** A speech longer than this is cut at its latest pause (VAD_MAX_CHUNK_MS). */
  maxChunkMs: 5000,
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
} as const

/** Where the pinned VAD/ONNX assets are served from (scripts/copy-vad-assets.ts). */
export const VAD_ASSET_PATH = '/vad/'

/** Allowed range for the end-of-speech pause (the server validates VAD_END_SILENCE_MS the same way). */
export const END_SILENCE_RANGE = { min: 300, max: 700 } as const

export function clampEndSilence(ms: number | undefined): number {
  if (ms === undefined || !Number.isFinite(ms)) return VAD_SETTINGS.redemptionMs
  return Math.min(END_SILENCE_RANGE.max, Math.max(END_SILENCE_RANGE.min, Math.round(ms)))
}
