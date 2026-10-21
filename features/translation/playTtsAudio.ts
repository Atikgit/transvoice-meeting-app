/** Plays base64 WAV TTS audio. Replaced by a per-speaker Web Audio queue in Phase 3. */
export function playTtsAudio(base64Wav: string) {
  const audio = new Audio(`data:audio/wav;base64,${base64Wav}`)
  audio.play().catch(() => {})
}
