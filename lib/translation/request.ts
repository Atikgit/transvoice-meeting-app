import { z } from 'zod'
import { isWav } from '@/lib/translation/wav'

/** Upload limits for POST /api/translate. */
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024
export const AUDIO_MIME_TYPES = ['audio/wav', 'audio/x-wav', 'audio/wave'] as const
/** Opus uploads (UPLOAD_FORMAT=opus): Ogg Opus from WebCodecs, or WebM/Opus. */
export const OPUS_MIME_TYPES = ['audio/ogg', 'audio/webm', 'audio/opus'] as const

const fields = z.object({
  sessionId: z.uuid(),
  utteranceId: z.uuid(),
  clientTs: z.coerce.number().int().nonnegative(),
  // Pieces of one long speech: same group, seq 0, 1, 2… (absent for a single utterance).
  group: z.uuid().optional(),
  seq: z.coerce.number().int().min(0).max(200).optional(),
})

export type TranslateUpload = z.infer<typeof fields> & {
  audio: Uint8Array
  format: 'wav' | 'opus'
}

/** Ogg ("OggS") or Matroska/WebM (EBML header) magic bytes. */
function isOpusContainer(bytes: Uint8Array): boolean {
  const ogg =
    bytes.length > 27 &&
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  const webm =
    bytes.length > 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  return ogg || webm
}

export type UploadError = { status: 400 | 413 | 415; error: string }

/** Validates the multipart body: audio (WAV, ≤ 2 MB), sessionId, utteranceId, clientTs. */
export async function parseTranslateUpload(form: FormData): Promise<TranslateUpload | UploadError> {
  const audio = form.get('audio')
  if (!(audio instanceof Blob)) return { status: 400, error: 'audio is required.' }
  if (audio.size > MAX_AUDIO_BYTES) return { status: 413, error: 'Audio is larger than 2 MB.' }
  const mime = audio.type.split(';')[0]!.trim().toLowerCase()
  const isOpus = (OPUS_MIME_TYPES as readonly string[]).includes(mime)
  if (!isOpus && !(AUDIO_MIME_TYPES as readonly string[]).includes(mime)) {
    return { status: 415, error: 'Only WAV or Opus audio is accepted.' }
  }
  const parsed = fields.safeParse({
    sessionId: form.get('sessionId'),
    utteranceId: form.get('utteranceId'),
    clientTs: form.get('clientTs'),
    group: form.get('group') ?? undefined,
    seq: form.get('seq') ?? undefined,
  })
  if (!parsed.success)
    return { status: 400, error: 'sessionId, utteranceId and clientTs are required.' }
  const bytes = new Uint8Array(await audio.arrayBuffer())
  if (isOpus ? !isOpusContainer(bytes) : !isWav(bytes))
    return { status: 415, error: `The audio is not a ${isOpus ? 'Opus' : 'WAV'} file.` }
  return { ...parsed.data, audio: bytes, format: isOpus ? 'opus' : 'wav' }
}
