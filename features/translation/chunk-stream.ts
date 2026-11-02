import { FRAME_MS, FRAME_SAMPLES } from './utterance-chunker'

/**
 * UPLOAD_MODE=chunked, browser side. Fed with every VAD frame, it hands out the speech as ~500 ms
 * PCM16 chunks WHILE the person is still talking, so that when the speech ends only the last
 * piece (at most 0.5 s) is left to upload. A speech longer than `maxPieceMs` is cut at a pause of
 * at least 250 ms that is happening right now (audio already sent cannot be taken back) and the
 * parts become separate utterances of one group with sequence numbers.
 *
 * It also keeps each piece's samples, which are used if the chunks fail and the whole utterance
 * has to be sent the old way.
 */
export const CHUNK_MS = 500
const CHUNK_FRAMES = Math.round(CHUNK_MS / FRAME_MS)

export type StreamEvent =
  /** A chunk to upload. `last` marks the end of the utterance (its pcm may be empty). */
  | {
      type: 'chunk'
      utteranceId: string
      seq: number
      pcm: Uint8Array
      last: boolean
      group: string
      pieceSeq: number
      endedAgoMs: number
    }
  /** The utterance is complete: its audio, for the whole-upload fallback. */
  | {
      type: 'piece'
      utteranceId: string
      group: string
      pieceSeq: number
      samples: Float32Array
      endedAgoMs: number
    }
  /** A half-spoken utterance that turned out to be noise: throw it away. */
  | { type: 'abort'; utteranceId: string }

export function floatToPcm16(frames: Float32Array[]): Uint8Array {
  const length = frames.reduce((n, f) => n + f.length, 0)
  const out = new Uint8Array(length * 2)
  const view = new DataView(out.buffer)
  let i = 0
  for (const frame of frames) {
    for (let k = 0; k < frame.length; k++) {
      const s = Math.max(-1, Math.min(1, frame[k]!))
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      i++
    }
  }
  return out
}

interface Piece {
  utteranceId: string
  group: string
  pieceSeq: number
  frames: { frame: Float32Array; speech: boolean }[]
  /** Index in `frames` of the first frame not yet sent. */
  sent: number
  chunkSeq: number
  silentRun: number
}

export class ChunkStreamer {
  private readonly maxFrames: number
  private readonly minPauseFrames: number
  private ring: Float32Array[] = []
  private piece: Piece | null = null

  constructor(
    maxPieceMs: number,
    private readonly emit: (event: StreamEvent) => void,
    private readonly options: {
      minPauseMs?: number
      preSpeechFrames?: number
      speechThreshold?: number
      silenceThreshold?: number
      minSpeechFrames?: number
      newId?: () => string
    } = {},
  ) {
    this.maxFrames = Math.ceil(maxPieceMs / FRAME_MS)
    this.minPauseFrames = Math.ceil((options.minPauseMs ?? 250) / FRAME_MS)
  }

  private id() {
    return (this.options.newId ?? (() => crypto.randomUUID()))()
  }

  /** The utterance id being streamed now, if any. */
  get current(): string | null {
    return this.piece?.utteranceId ?? null
  }

  speechStart(): void {
    if (this.piece) this.abort()
    this.begin(
      this.id(),
      0,
      this.ring.map((frame) => ({ frame, speech: false })),
    )
    this.ring = []
  }

  private begin(
    group: string,
    pieceSeq: number,
    frames: { frame: Float32Array; speech: boolean }[],
  ) {
    this.piece = {
      utteranceId: this.id(),
      group: pieceSeq === 0 ? this.id() : group,
      pieceSeq,
      frames,
      sent: 0,
      chunkSeq: 0,
      silentRun: 0,
    }
  }

  /** Every VAD frame (speech or not). */
  frame(isSpeechProbability: number, frame: Float32Array): void {
    const piece = this.piece
    if (!piece) {
      this.ring.push(frame)
      if (this.ring.length > (this.options.preSpeechFrames ?? 10)) this.ring.shift()
      return
    }
    piece.frames.push({
      frame,
      speech: isSpeechProbability >= (this.options.speechThreshold ?? 0.5),
    })
    piece.silentRun =
      isSpeechProbability < (this.options.silenceThreshold ?? 0.35) ? piece.silentRun + 1 : 0

    // A speech that went on long enough is cut in the middle of a pause happening right now.
    if (piece.frames.length >= this.maxFrames && piece.silentRun >= this.minPauseFrames) {
      const { group, pieceSeq } = piece
      const endedAgoMs = piece.silentRun * FRAME_MS
      this.finish(endedAgoMs)
      this.begin(group, pieceSeq + 1, [])
      return
    }
    if (piece.frames.length - piece.sent >= CHUNK_FRAMES) this.sendChunk(piece, false, 0)
  }

  /** The VAD ended the speech (after its end-of-speech wait). */
  speechEnd(redemptionMs: number): void {
    if (!this.piece) return
    this.finish(redemptionMs)
  }

  /** The VAD gave up on this speech, or listening was switched off. */
  abort(): void {
    const piece = this.piece
    this.piece = null
    this.ring = []
    if (piece && piece.chunkSeq > 0) this.emit({ type: 'abort', utteranceId: piece.utteranceId })
  }

  private sendChunk(piece: Piece, last: boolean, endedAgoMs: number) {
    const frames = piece.frames.slice(piece.sent).map((f) => f.frame)
    piece.sent = piece.frames.length
    this.emit({
      type: 'chunk',
      utteranceId: piece.utteranceId,
      seq: piece.chunkSeq++,
      pcm: floatToPcm16(frames),
      last,
      group: piece.group,
      pieceSeq: piece.pieceSeq,
      endedAgoMs,
    })
  }

  private finish(endedAgoMs: number) {
    const piece = this.piece
    this.piece = null
    if (!piece) return
    const speechFrames = piece.frames.filter((f) => f.speech).length
    if (speechFrames < (this.options.minSpeechFrames ?? 10)) {
      // Too little speech to send (a cough, the tail of a long speech): drop it.
      if (piece.chunkSeq > 0) this.emit({ type: 'abort', utteranceId: piece.utteranceId })
      return
    }
    this.sendChunk(piece, true, endedAgoMs)
    // For the fallback: the speech plus a short tail (the end-of-speech wait is silence).
    const lastSpeech = piece.frames.findLastIndex((f) => f.speech)
    const kept = piece.frames.slice(0, Math.min(piece.frames.length, lastSpeech + 1 + 5))
    const samples = new Float32Array(kept.length * FRAME_SAMPLES)
    kept.forEach((f, i) => samples.set(f.frame, i * FRAME_SAMPLES))
    this.emit({
      type: 'piece',
      utteranceId: piece.utteranceId,
      group: piece.group,
      pieceSeq: piece.pieceSeq,
      samples,
      endedAgoMs,
    })
  }
}
