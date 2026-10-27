/**
 * Cuts a long speech into pieces while it is still being spoken (VAD_MAX_CHUNK_MS, default 5 s)
 * so the first piece is already being translated while the speaker goes on. Fed with every VAD
 * frame (512 samples = 32 ms at 16 kHz): it keeps its own copy of the audio since the speech
 * began and, once the speech is longer than the limit, cuts at the LATEST pause of at least
 * `minPauseMs` (the middle of that pause), keeping the rest for the next piece.
 *
 * A speech that never exceeds the limit is not touched here: speechEnd() answers 'whole' and the
 * caller sends the VAD's own utterance as before. Pure logic, no browser APIs.
 */
export const FRAME_SAMPLES = 512
export const FRAME_MS = 32

export interface Chunk {
  samples: Float32Array
  /** 0, 1, 2… within one speech. */
  seq: number
  /** Milliseconds ago that the speech in this piece ended (the pause length so far). */
  endedAgoMs: number
}

export class UtteranceChunker {
  private readonly maxFrames: number
  private readonly minPauseFrames: number
  /** Frames before the speech started (the VAD's own pre-speech padding). */
  private ring: Float32Array[] = []
  private frames: { frame: Float32Array; speech: boolean }[] = []
  private active = false
  private silentRun = 0
  /** Index into `frames` of the start and length of the latest pause of >= minPauseFrames. */
  private pause: { start: number; length: number } | null = null
  private nextSeq = 0

  constructor(
    maxChunkMs: number,
    private readonly options: {
      minPauseMs?: number
      preSpeechFrames?: number
      speechThreshold?: number
      silenceThreshold?: number
      minSpeechFrames?: number
    } = {},
  ) {
    this.maxFrames = Math.ceil(maxChunkMs / FRAME_MS)
    this.minPauseFrames = Math.ceil((options.minPauseMs ?? 250) / FRAME_MS)
  }

  /** Pieces emitted for the current speech so far. */
  get pieces(): number {
    return this.nextSeq
  }

  /** Every VAD frame, speech or not. Returns a piece when the speech has to be cut now. */
  frame(isSpeechProbability: number, frame: Float32Array): Chunk | null {
    const speech = isSpeechProbability >= (this.options.speechThreshold ?? 0.5)
    if (!this.active) {
      this.ring.push(frame)
      if (this.ring.length > (this.options.preSpeechFrames ?? 10)) this.ring.shift()
      return null
    }
    this.frames.push({ frame, speech })
    if (isSpeechProbability < (this.options.silenceThreshold ?? 0.35)) {
      this.silentRun++
      if (this.silentRun >= this.minPauseFrames)
        this.pause = { start: this.frames.length - this.silentRun, length: this.silentRun }
    } else {
      this.silentRun = 0
    }
    if (this.frames.length < this.maxFrames || !this.pause) return null
    return this.cut()
  }

  speechStart(): void {
    this.active = true
    this.frames = this.ring.map((frame) => ({ frame, speech: false }))
    this.ring = []
    this.silentRun = 0
    this.pause = null
    this.nextSeq = 0
  }

  /**
   * The VAD ended the speech. 'whole': nothing was cut, use the VAD's own utterance. A piece:
   * what is left after the last cut. null: nothing worth sending is left.
   */
  speechEnd(): 'whole' | Chunk | null {
    const cuts = this.nextSeq
    // Trim the VAD's end-of-speech wait (it is silence) down to a short tail.
    const lastSpeech = this.frames.findLastIndex((f) => f.speech)
    const rest = this.take(Math.min(this.frames.length, lastSpeech + 1 + 5))
    this.reset()
    if (cuts === 0) return 'whole'
    return rest ? { samples: rest, seq: cuts, endedAgoMs: 0 } : null
  }

  /** The VAD gave up on this speech (misfire) or was paused. */
  reset(): void {
    this.active = false
    this.frames = []
    this.silentRun = 0
    this.pause = null
    this.nextSeq = 0
  }

  private cut(): Chunk | null {
    const pause = this.pause!
    const middle = pause.start + Math.floor(pause.length / 2)
    const endedAgoMs = (this.frames.length - pause.start) * FRAME_MS
    const samples = this.take(middle)
    this.frames = this.frames.slice(middle)
    this.pause = null
    this.silentRun = Math.max(0, this.silentRun - middle)
    return samples ? { samples, seq: this.nextSeq++, endedAgoMs } : null
  }

  /** Audio of the first `count` frames, or null when it holds too little speech to be worth sending. */
  private take(count: number): Float32Array | null {
    const part = this.frames.slice(0, count)
    if (part.filter((f) => f.speech).length < (this.options.minSpeechFrames ?? 10)) return null
    const out = new Float32Array(part.length * FRAME_SAMPLES)
    part.forEach((f, i) => out.set(f.frame, i * FRAME_SAMPLES))
    return out
  }
}
