import 'server-only'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { ChunkStore, MAX_OPEN_PER_USER, type ChunkRejection } from '@/lib/translation/chunks'
import { admitUtterance, translateUtterance, type Admission } from '@/lib/translation/process'
import type { TranslateUpload } from '@/lib/translation/request'
import { pcm16ToWav } from '@/lib/translation/wav'

/** What is remembered about an utterance from its first chunk: who/where, and the admission. */
export interface ChunkMeta {
  sessionId: string
  admission: Admission
  clientTs: number
  group?: string
  seq?: number
  startedAt: number
}

const holder = globalThis as unknown as { __tvChunks?: ChunkStore<ChunkMeta> }

function runAssembled(userId: string, utteranceId: string, pcm: Uint8Array, meta: ChunkMeta) {
  const upload: TranslateUpload = {
    sessionId: meta.sessionId,
    utteranceId,
    clientTs: meta.clientTs,
    group: meta.group,
    seq: meta.seq,
    audio: pcm16ToWav(pcm),
    format: 'wav',
  }
  return translateUtterance({
    user: { id: userId },
    upload,
    startedAt: performance.now(),
    admitted: meta.admission,
  })
}

/** The process-wide store; utterances that end without a last chunk are processed from here. */
export function chunkStore(): ChunkStore<ChunkMeta> {
  holder.__tvChunks ??= new ChunkStore<ChunkMeta>((pcm, userId, utteranceId, meta) => {
    void runAssembled(userId, utteranceId, pcm, meta).catch((error) =>
      console.error(
        JSON.stringify({
          event: 'chunk_idle_failed',
          detail: error instanceof Error ? error.message.slice(0, 100) : 'error',
        }),
      ),
    )
  })
  return holder.__tvChunks
}

const REJECTIONS: Record<ChunkRejection, { status: number; error: string }> = {
  too_many_open: { status: 429, error: 'Too many utterances in progress.' },
  too_long: { status: 413, error: 'The utterance is longer than 12 seconds.' },
  too_large: { status: 413, error: 'The chunk is too large.' },
  bad_chunk: { status: 400, error: 'Invalid chunk.' },
  conflict: { status: 400, error: 'A different chunk with this number was already received.' },
  finished: { status: 200, error: 'Already processed.' },
}

/**
 * One chunk of one utterance. The first chunk of an utterance is where the speaker is admitted
 * (the same checks as POST /api/translate: live session, connected participant, beta allow-list,
 * kill switch, payer minutes) and where the per-UTTERANCE rate limit is spent; later chunks only
 * need to belong to that utterance. The request that completes the utterance runs the pipeline and
 * returns the same answer POST /api/translate gives; the others answer 202.
 */
export async function acceptChunk({
  user,
  sessionId,
  utteranceId,
  seq,
  last,
  clientTs,
  group,
  pieceSeq,
  data,
  store = chunkStore(),
}: {
  user: { id: string }
  sessionId: string
  utteranceId: string
  seq: number
  last: boolean
  clientTs: number
  group?: string
  pieceSeq?: number
  data: Uint8Array
  store?: ChunkStore<ChunkMeta>
}): Promise<NextResponse> {
  if (store.wasFinished(user.id, utteranceId))
    return NextResponse.json({ utteranceId, duplicate: true, languages: [] })

  const startedAt = performance.now()
  // Admission happens once, when the utterance is first seen.
  let admitted: Admission | undefined
  if (!store.has(user.id, utteranceId)) {
    if (store.openCount(user.id) >= MAX_OPEN_PER_USER)
      return NextResponse.json({ error: REJECTIONS.too_many_open.error }, { status: 429 })
    if (!(await checkRateLimit('translate', user.id)))
      return NextResponse.json(
        { error: 'Too many utterances. Slow down a little.' },
        { status: 429 },
      )
    const admission = await admitUtterance({ user, sessionId, utteranceId })
    if (!admission.ok) return admission.response
    admitted = admission
  }

  // The speaker's clock reading rides on the last chunk, which may arrive before the others.
  if (last) {
    const stored = store.meta(user.id, utteranceId)
    if (stored) stored.clientTs = clientTs
  }
  let result: ReturnType<typeof store.add>
  try {
    result = store.add(user.id, utteranceId, { seq, data, last }, () => {
      if (!admitted) throw new Error('NO_ADMISSION') // the utterance expired between two chunks
      return {
        sessionId,
        admission: admitted,
        clientTs: last ? clientTs : 0,
        group,
        seq: pieceSeq,
        startedAt,
      }
    })
  } catch {
    return NextResponse.json({ error: 'Utterance not found.' }, { status: 409 })
  }
  if (result.kind === 'rejected') {
    const r = REJECTIONS[result.reason]
    return NextResponse.json({ error: r.error }, { status: r.status })
  }
  if (result.kind === 'stored')
    return NextResponse.json({ received: seq, duplicate: result.duplicate }, { status: 202 })
  if (result.pcm.length === 0)
    return NextResponse.json({ utteranceId, languages: [], silence: true })
  // This request completed the utterance.
  return runAssembled(user.id, utteranceId, result.pcm, result.meta)
}
