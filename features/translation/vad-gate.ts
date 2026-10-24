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

/** VAD tuning: ~500 ms end-of-speech pause, 300 ms minimum speech, 12 s maximum utterance. */
export const VAD_SETTINGS = {
  redemptionMs: 500,
  minSpeechMs: 300,
  preSpeechPadMs: 300,
  maxUtteranceMs: 12_000,
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
} as const

/** Where the pinned VAD/ONNX assets are served from (scripts/copy-vad-assets.ts). */
export const VAD_ASSET_PATH = '/vad/'
