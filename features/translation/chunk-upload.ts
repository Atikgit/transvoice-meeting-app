/**
 * Uploads the chunks of ONE utterance to POST /api/translate/chunk as they are produced, and says
 * at the end whether the server got all of them. Any chunk that fails (network error, 3 s without
 * an answer, a 5xx, or a 400 that means the server lost the thread) makes the whole attempt fail:
 * the caller then sends the whole utterance the old way. Answers that are decisions about the
 * speaker (not signed in, beta gate, no minutes, rate limit, not connected) are real answers, not
 * failures: they are handed to the caller exactly as /api/translate would have answered.
 */
export const CHUNK_TIMEOUT_MS = 3000

export type Poster = (
  headers: Record<string, string>,
  body: Uint8Array,
  signal: AbortSignal,
) => Promise<Response>

export const postChunk: Poster = (headers, body, signal) =>
  fetch('/api/translate/chunk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', ...headers },
    body: body as Uint8Array<ArrayBuffer>,
    signal,
  })

export type ChunkOutcome = { ok: true; response: Response | null } | { ok: false; reason: string }

/** Statuses that answer "may this speaker translate?" rather than "did the upload work?". */
const isDecision = (status: number) =>
  status === 200 || status === 401 || status === 402 || status === 403 || status === 429

export class ChunkUpload {
  private pending: Promise<{ response: Response } | { error: string }>[] = []
  private failed: string | null = null
  private closed = false

  constructor(
    readonly utteranceId: string,
    private readonly base: { sessionId: string },
    private readonly post: Poster = postChunk,
    private readonly timeoutMs = CHUNK_TIMEOUT_MS,
  ) {}

  /** Sends one chunk now (chunks go out in parallel; the server accepts any order). */
  push(chunk: {
    seq: number
    pcm: Uint8Array
    last: boolean
    group: string
    pieceSeq: number
    clientTs?: number
  }): void {
    if (this.closed || this.failed) return
    const headers: Record<string, string> = {
      'x-utterance-id': this.utteranceId,
      'x-session-id': this.base.sessionId,
      'x-seq': String(chunk.seq),
      'x-last': chunk.last ? '1' : '0',
      'x-group': chunk.group,
      'x-piece-seq': String(chunk.pieceSeq),
    }
    if (chunk.last && chunk.clientTs !== undefined) headers['x-client-ts'] = String(chunk.clientTs)
    this.pending.push(
      this.post(headers, chunk.pcm, AbortSignal.timeout(this.timeoutMs)).then(
        (response) => ({ response }),
        (error: unknown) => ({ error: error instanceof Error ? error.name : 'network' }),
      ),
    )
  }

  /** Tells the server to forget a half-spoken utterance (it was noise). Fire and forget. */
  abort(): void {
    this.closed = true
    void this.post(
      {
        'x-utterance-id': this.utteranceId,
        'x-session-id': this.base.sessionId,
        'x-seq': '0',
        'x-abort': '1',
      },
      new Uint8Array(0),
      AbortSignal.timeout(this.timeoutMs),
    ).catch(() => {})
  }

  /** Waits for every chunk. The response to hand on is the one that carries the translation answer. */
  async finish(): Promise<ChunkOutcome> {
    this.closed = true
    const results = await Promise.all(this.pending)
    let answer: Response | null = null
    for (const r of results) {
      if ('error' in r) return { ok: false, reason: r.error }
      const { status } = r.response
      if (status === 202) continue
      if (status === 204) continue
      if (!isDecision(status)) return { ok: false, reason: `status ${status}` }
      // A decision about the speaker (or the finished answer): the first non-202 one wins.
      answer ??= r.response
    }
    return { ok: true, response: answer }
  }
}
