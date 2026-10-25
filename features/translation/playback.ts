/**
 * Translated-clip playback (§4, §8): per speaker an in-order queue, clips older than 6 s are
 * dropped, and while a speaker's translated clip plays their original audio is ducked to the
 * listener's chosen mode (off = keep full volume, duck = 15 %, mute = 0) and then restored.
 * Pure logic: audio decoding/playing and LiveKit volume control are injected.
 */
export type OriginalAudioMode = 'off' | 'duck' | 'mute'

export const MAX_CLIP_AGE_MS = 6000
export const DUCK_VOLUME: Record<OriginalAudioMode, number> = { off: 1, duck: 0.15, mute: 0 }

export interface Clip {
  speakerId: string
  utteranceId: string
  url: string
  /** The clip itself when it arrived inside the data packet (then there is no url to fetch). */
  data?: Uint8Array
  /** Local clock (ms) when the clip's message arrived — immune to clock differences. */
  receivedAt: number
}

export interface PlaybackDeps<Prepared> {
  now: () => number
  /** Fetches and decodes a clip (started on arrival so it is ready when its turn comes). */
  prepare: (clip: Clip) => Promise<Prepared>
  /** Plays a prepared clip; resolves when it has finished. */
  play: (prepared: Prepared, clip: Clip) => Promise<void>
  /** Sets the volume of a speaker's original LiveKit audio (1 = full). */
  setOriginalVolume: (speakerId: string, volume: number) => void
  mode: () => OriginalAudioMode
  /** True while any translated clip is playing (feeds the VAD echo gate). */
  onPlayingChange: (playing: boolean) => void
  /** Called with the first-sound time of each clip (latency metrics) or when one is dropped. */
  onStart?: (clip: Clip, at: number) => void
  onDrop?: (clip: Clip, reason: 'stale' | 'failed') => void
}

export class PlaybackQueues<Prepared> {
  private queues = new Map<string, { clip: Clip; prepared: Promise<Prepared> }[]>()
  private running = new Set<string>()
  private playingNow = false

  constructor(private readonly deps: PlaybackDeps<Prepared>) {}

  enqueue(clip: Clip): void {
    const prepared = this.deps.prepare(clip)
    prepared.catch(() => {}) // handled when the clip's turn comes
    const queue = this.queues.get(clip.speakerId) ?? []
    queue.push({ clip, prepared })
    this.queues.set(clip.speakerId, queue)
    void this.drain(clip.speakerId)
  }

  /** Clips waiting or playing, over all speakers. */
  size(): number {
    let n = 0
    for (const queue of this.queues.values()) n += queue.length
    return n + this.running.size
  }

  /** Stops waiting clips (leaving the meeting) and restores every original volume. */
  clear(): void {
    for (const [speakerId, queue] of this.queues) {
      queue.length = 0 // in place: a running drain loop holds this array
      this.deps.setOriginalVolume(speakerId, 1)
    }
  }

  private async drain(speakerId: string): Promise<void> {
    if (this.running.has(speakerId)) return
    this.running.add(speakerId)
    const queue = this.queues.get(speakerId)!
    try {
      while (queue.length > 0) {
        const { clip, prepared } = queue.shift()!
        if (this.deps.now() - clip.receivedAt > MAX_CLIP_AGE_MS) {
          this.deps.onDrop?.(clip, 'stale')
          continue
        }
        let ready: Prepared
        try {
          ready = await prepared
        } catch {
          this.deps.onDrop?.(clip, 'failed')
          continue
        }
        // Preparing may have taken long: a clip that is stale now would talk over the present.
        if (this.deps.now() - clip.receivedAt > MAX_CLIP_AGE_MS) {
          this.deps.onDrop?.(clip, 'stale')
          continue
        }
        this.deps.setOriginalVolume(speakerId, DUCK_VOLUME[this.deps.mode()])
        this.setPlaying(true)
        this.deps.onStart?.(clip, this.deps.now())
        try {
          await this.deps.play(ready, clip)
        } catch {
          this.deps.onDrop?.(clip, 'failed')
        }
      }
    } finally {
      this.deps.setOriginalVolume(speakerId, 1)
      this.running.delete(speakerId)
      this.setPlaying(this.running.size > 0)
    }
  }

  private setPlaying(playing: boolean) {
    if (playing === this.playingNow) return
    this.playingNow = playing
    this.deps.onPlayingChange(playing)
  }
}
