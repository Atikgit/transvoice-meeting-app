import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { DRAIN_RETRY_MS, isDraining } from '@/lib/draining'
import { acceptChunk, chunkStore } from '@/lib/translation/chunk-service'
import { MAX_CHUNK_BYTES } from '@/lib/translation/chunks'
import { getSessionUser } from '@/lib/supabase/server'

const headers = z.object({
  utteranceId: z.uuid(),
  sessionId: z.uuid(),
  seq: z.coerce.number().int().min(0).max(200),
  // "1" on the final chunk of the utterance (which may be empty).
  last: z.enum(['0', '1']).default('0'),
  // The speaker's clock (server time, ms) when speech ended; read from the last chunk.
  clientTs: z.coerce.number().int().nonnegative().default(0),
  group: z.uuid().optional(),
  pieceSeq: z.coerce.number().int().min(0).max(200).optional(),
})

/**
 * POST /api/translate/chunk — one ~500 ms chunk (raw 16 kHz mono PCM16, application/octet-stream)
 * of an utterance that is still being spoken. Headers: x-utterance-id, x-session-id, x-seq, x-last
 * (and x-client-ts on the last chunk, x-group / x-piece-seq for pieces of a long speech).
 * `x-abort: 1` throws a half-spoken utterance away. When the last chunk is in, the same pipeline as
 * POST /api/translate runs and its answer is returned; the other chunks answer 202.
 */
export async function POST(request: NextRequest) {
  if (isDraining()) {
    return NextResponse.json(
      { code: 'DRAINING', error: 'The server is restarting. Retrying…', retryable: true },
      { status: 503, headers: { 'Retry-After': String(DRAIN_RETRY_MS / 1000) } },
    )
  }
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })

  const h = request.headers
  const parsed = headers.safeParse({
    utteranceId: h.get('x-utterance-id'),
    sessionId: h.get('x-session-id'),
    seq: h.get('x-seq'),
    last: h.get('x-last') ?? undefined,
    clientTs: h.get('x-client-ts') ?? undefined,
    group: h.get('x-group') ?? undefined,
    pieceSeq: h.get('x-piece-seq') ?? undefined,
  })
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid chunk headers.' }, { status: 400 })
  const meta = parsed.data

  if (h.get('x-abort') === '1') {
    chunkStore().discard(user.id, meta.utteranceId)
    return new NextResponse(null, { status: 204 })
  }
  const declared = Number(h.get('content-length') ?? 0)
  if (declared > MAX_CHUNK_BYTES)
    return NextResponse.json({ error: 'The chunk is too large.' }, { status: 413 })
  const data = new Uint8Array(await request.arrayBuffer())

  return acceptChunk({
    user,
    sessionId: meta.sessionId,
    utteranceId: meta.utteranceId,
    seq: meta.seq,
    last: meta.last === '1',
    clientTs: meta.clientTs,
    group: meta.group,
    pieceSeq: meta.pieceSeq,
    data,
  })
}
