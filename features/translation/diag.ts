/**
 * Tells the server log about client-side audio trouble that is otherwise invisible
 * (POST /api/diag): a local microphone track that got muted or ended, audio blocked by the
 * browser, a voice that stayed lowered. Fire and forget; no text, audio, names or ids beyond
 * the session id.
 */
export type DiagType =
  | 'local_audio_muted'
  | 'local_audio_unmuted'
  | 'local_audio_ended'
  | 'audio_blocked'
  | 'duck_restored'
  | 'realtime_status'

export function reportDiag(event: { type: DiagType; detail?: string; sessionId?: string }): void {
  void fetch('/api/diag', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => {})
}
