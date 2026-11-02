import 'server-only'

/**
 * Server side of the chunked upload (UPLOAD_MODE=chunked): while the speaker is still talking the
 * browser posts ~500 ms PCM16 chunks of ONE utterance; here they are kept in memory per utterance
 * and, when the last one is in, joined into the WAV the existing pipeline already takes.
 *
 * Limits (and what happens to a gap): an utterance lives 20 s, holds at most 12 s of audio, a user may have 2 open at once.
 * Chunks may arrive in any order and twice; a missing chunk means the utterance is dropped (the
 * browser then sends the whole utterance the old way). Without a last chunk, 3 s of silence from
 * the browser assembles what arrived, if it is complete from the start.
 */
export const CHUNK_TTL_MS = 20_000
export const CHUNK_IDLE_MS = 3_000
export const MAX_OPEN_PER_USER = 2
export const MAX_UTTERANCE_BYTES = 12 * 16_000 * 2 // 12 s of 16 kHz 16-bit mono
export const MAX_CHUNK_BYTES = 64 * 1024
export const MAX_CHUNKS = 64
/** How long a finished utterance id is remembered (to ignore the whole-upload fallback's duplicate). */
export const DONE_TTL_MS = 60_000

export type ChunkRejection =
  'too_many_open' | 'too_long' | 'too_large' | 'bad_chunk' | 'conflict' | 'finished'

export interface OpenUtterance<Meta> {
  userId: string
  utteranceId: string
  meta: Meta
  createdAt: number
  lastChunkAt: number
  chunks: Map<number, Uint8Array>
  bytes: number
  /** seq of the chunk marked last, once seen. */
  lastSeq: number | null
  idleTimer: ReturnType<typeof setTimeout> | null
}

export type AddResult<Meta> =
  | { kind: 'rejected'; reason: ChunkRejection }
  /** Stored (or a harmless duplicate); more chunks are expected. */
  | { kind: 'stored'; duplicate: boolean }
  /** Everything is in: here is the audio, the utterance is closed. */
  | { kind: 'complete'; pcm: Uint8Array; meta: Meta }

export class ChunkStore<Meta> {
  private open = new Map<string, OpenUtterance<Meta>>()
  private done = new Map<string, number>()

  constructor(
    private readonly onIdle: (
      pcm: Uint8Array,
      userId: string,
      utteranceId: string,
      meta: Meta,
    ) => void,
    private readonly now: () => number = Date.now,
    private readonly setTimer: typeof setTimeout = setTimeout,
  ) {}

  private key = (userId: string, utteranceId: string) => `${userId}:${utteranceId}`

  has(userId: string, utteranceId: string): boolean {
    this.sweep()
    return this.open.has(this.key(userId, utteranceId))
  }

  openCount(userId: string): number {
    this.sweep()
    return [...this.open.values()].filter((u) => u.userId === userId).length
  }

  /** What was stored when the utterance was first seen (null if it is not open). */
  meta(userId: string, utteranceId: string): Meta | null {
    return this.open.get(this.key(userId, utteranceId))?.meta ?? null
  }

  /** Was this utterance already assembled (and processed) recently? */
  wasFinished(userId: string, utteranceId: string): boolean {
    this.sweep()
    return this.done.has(this.key(userId, utteranceId))
  }

  /** The browser gave up on chunks and sends the whole utterance: forget the partial one. */
  discard(userId: string, utteranceId: string): void {
    this.close(this.key(userId, utteranceId))
  }

  /** `meta` is stored when the utterance is first seen (the admission of the speaker). */
  add(
    userId: string,
    utteranceId: string,
    chunk: { seq: number; data: Uint8Array; last: boolean },
    makeMeta: () => Meta,
  ): AddResult<Meta> {
    this.sweep()
    const key = this.key(userId, utteranceId)
    if (this.done.has(key)) return { kind: 'rejected', reason: 'finished' }
    if (
      !Number.isInteger(chunk.seq) ||
      chunk.seq < 0 ||
      chunk.seq >= MAX_CHUNKS ||
      chunk.data.length % 2 !== 0
    )
      return { kind: 'rejected', reason: 'bad_chunk' }
    if (chunk.data.length > MAX_CHUNK_BYTES) return { kind: 'rejected', reason: 'too_large' }

    let utterance = this.open.get(key)
    if (!utterance) {
      if (this.openCount(userId) >= MAX_OPEN_PER_USER)
        return { kind: 'rejected', reason: 'too_many_open' }
      utterance = {
        userId,
        utteranceId,
        meta: makeMeta(),
        createdAt: this.now(),
        lastChunkAt: this.now(),
        chunks: new Map(),
        bytes: 0,
        lastSeq: null,
        idleTimer: null,
      }
      this.open.set(key, utterance)
    }

    const existing = utterance.chunks.get(chunk.seq)
    if (existing) {
      // The same chunk again (a retry) is fine; a different one under the same number is not.
      if (existing.length === chunk.data.length) return { kind: 'stored', duplicate: true }
      this.close(key)
      return { kind: 'rejected', reason: 'conflict' }
    }
    if (utterance.bytes + chunk.data.length > MAX_UTTERANCE_BYTES) {
      this.close(key)
      return { kind: 'rejected', reason: 'too_long' }
    }

    utterance.chunks.set(chunk.seq, chunk.data)
    utterance.bytes += chunk.data.length
    utterance.lastChunkAt = this.now()
    if (chunk.last) utterance.lastSeq = chunk.seq

    const joined = utterance.lastSeq === null ? null : this.join(utterance, utterance.lastSeq)
    if (utterance.lastSeq !== null && joined) {
      this.finish(key)
      return { kind: 'complete', pcm: joined, meta: utterance.meta }
    }
    this.armIdle(key, utterance)
    return { kind: 'stored', duplicate: false }
  }

  private armIdle(key: string, utterance: OpenUtterance<Meta>) {
    if (utterance.idleTimer) clearTimeout(utterance.idleTimer)
    utterance.idleTimer = this.setTimer(() => {
      // 3 s without a chunk and no last one: use what arrived if it is complete from the start.
      if (this.open.get(key) !== utterance) return
      // A gap means a chunk got lost: drop it all, the browser then sends the whole utterance.
      const complete = this.contiguousEnd(utterance) + 1 === utterance.chunks.size
      const pcm = complete ? this.join(utterance, null) : null
      if (!pcm) return this.close(key)
      this.finish(key)
      if (pcm.length > 0) this.onIdle(pcm, utterance.userId, utterance.utteranceId, utterance.meta)
    }, CHUNK_IDLE_MS)
  }

  /** Chunks 0..lastSeq (or 0..highest contiguous when lastSeq is null), joined; null if there is a gap. */
  private join(utterance: OpenUtterance<Meta>, lastSeq: number | null): Uint8Array | null {
    const end = lastSeq ?? this.contiguousEnd(utterance)
    if (end < 0 && lastSeq === null) return null
    const parts: Uint8Array[] = []
    for (let i = 0; i <= end; i++) {
      const part = utterance.chunks.get(i)
      if (!part) return null
      parts.push(part)
    }
    // With a last chunk, chunks beyond it must not exist (a stray chunk means a confused client).
    if (lastSeq !== null && utterance.chunks.size !== lastSeq + 1) return null
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) {
      out.set(p, at)
      at += p.length
    }
    return out
  }

  private contiguousEnd(utterance: OpenUtterance<Meta>): number {
    let i = 0
    while (utterance.chunks.has(i)) i++
    return i - 1
  }

  private finish(key: string) {
    const utterance = this.open.get(key)
    this.close(key)
    if (utterance) this.done.set(key, this.now())
  }

  private close(key: string) {
    const utterance = this.open.get(key)
    if (utterance?.idleTimer) clearTimeout(utterance.idleTimer)
    this.open.delete(key)
  }

  private sweep() {
    const now = this.now()
    for (const [key, u] of this.open) if (now - u.createdAt > CHUNK_TTL_MS) this.close(key)
    for (const [key, at] of this.done) if (now - at > DONE_TTL_MS) this.done.delete(key)
  }
}
