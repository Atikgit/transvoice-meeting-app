import { z } from 'zod'
import { isWav } from '@/lib/translation/wav'

/** Upload limits for POST /api/translate. */
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024
export const AUDIO_MIME_TYPES = ['audio/wav', 'audio/x-wav', 'audio/wave'] as const

const fields = z.object({
  sessionId: z.uuid(),
  utteranceId: z.uuid(),
  clientTs: z.coerce.number().int().nonnegative(),
})

export type TranslateUpload = z.infer<typeof fields> & { audio: Uint8Array }

export type UploadError = { status: 400 | 413 | 415; error: string }

/** Validates the multipart body: audio (WAV, ≤ 2 MB), sessionId, utteranceId, clientTs. */
export async function parseTranslateUpload(form: FormData): Promise<TranslateUpload | UploadError> {
  const audio = form.get('audio')
  if (!(audio instanceof Blob)) return { status: 400, error: 'audio is required.' }
  if (audio.size > MAX_AUDIO_BYTES) return { status: 413, error: 'Audio is larger than 2 MB.' }
  const mime = audio.type.split(';')[0]!.trim().toLowerCase()
  if (!(AUDIO_MIME_TYPES as readonly string[]).includes(mime)) {
    return { status: 415, error: 'Only WAV audio is accepted.' }
  }
  const parsed = fields.safeParse({
    sessionId: form.get('sessionId'),
    utteranceId: form.get('utteranceId'),
    clientTs: form.get('clientTs'),
  })
  if (!parsed.success)
    return { status: 400, error: 'sessionId, utteranceId and clientTs are required.' }
  const bytes = new Uint8Array(await audio.arrayBuffer())
  if (!isWav(bytes)) return { status: 415, error: 'The audio is not a WAV file.' }
  return { ...parsed.data, audio: bytes }
}
