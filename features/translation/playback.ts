/**
 * Translated-clip playback (§4, §8): per speaker an in-order queue, clips older than 6 s are
 * dropped, and while a speaker's translated clip plays their original audio is ducked to the
 * listener's chosen mode (off = keep full volume, duck = 15 %, mute = 0) and then restored.
 *
 * The rule for the original voice: it is lowered ONLY while a translated clip of that same
 * speaker is actually playing, and it is put back to full volume the moment that clip ends,
 * fails, hangs past its length, or the page is hidden / the audio context stops. Nothing else
 * (a dropped, stale or undecodable clip, a blocked audio context, an empty queue) ever touches it.
 * Pure logic: audio decoding/playing and LiveKit volume control are injected.
 */
export type OriginalAudioMode = 'off' | 'duck' | 'mute'

export const MAX_CLIP_AGE_MS = 6000
export const DUCK_VOLUME: Record<OriginalAudioMode, number> = { off: 1, duck: 0.15, mute: 0 }
/** A clip that has not finished this long after it should have is treated as hung. */
export const PLAY_GRACE_MS = 3000
/** Used when the clip's length is unknown. */
export const DEFAULT_MAX_PLAY_MS = 15_000

export interface Clip {
  speakerId: string
  utteranceId: string
  url: string
  /** The clip itself when it arrived inside the data packet (then there is no url to fetch). */
  data?: Uint8Array
  /** Local clock (ms) when the clip's message arrived — immune to clock differences. */
  receivedAt: number
}

export type DropReason = 'stale' | 'failed' | 'blocked' | 'timeout'
export type DuckReason = 'start' | 'ended' | 'failed' | 'timeout' | 'cleared' | 'interrupted'

export interface PlaybackDeps<Prepared> {
  now: () => number
  /** Fetches and decodes a clip (started on arrival so it is ready when its turn comes). */
  prepare: (clip: Clip) => Promise<Prepared>
  /** Plays a prepared clip; resolves when it has finished. */
  play: (prepared: Prepared, clip: Clip) => Promise<void>
  /** Length of a prepared clip in ms, to notice a clip that never finishes. */
  durationMs?: (prepared: Prepared) => number | undefined
  /** False when sound cannot come out right now (suspended audio context): the clip is dropped, nothing is ducked. */
  canPlay?: () => boolean
  /** Sets the volume of a speaker's original LiveKit audio (1 = full). */
  setOriginalVolume: (speakerId: string, volume: number) => void
  mode: () => OriginalAudioMode
  /** True while any translated clip is playing (feeds the VAD echo gate). */
  onPlayingChange: (playing: boolean) => void
  /** Called with the first-sound time of each clip (latency metrics) or when one is dropped. */
  onStart?: (clip: Clip, at: number) => void
  onDrop?: (clip: Clip, reason: DropReason) => void
  /** Every change of a speaker's original volume, for the debug overlay. */
  onDuck?: (event: { speakerId: string; volume: number; reason: DuckReason }) => void
}

export class PlaybackQueues<Prepared> {
  private queues = new Map<string, { clip: Clip; prepared: Promise<Prepared> }[]>()
  private running = new Set<string>()
  /** Speakers whose original voice is lowered right now (always a clip of theirs is playing). */
  private ducked = new Set<string>()
  /** Called to abandon the clip that is playing for a speaker (page hidden, context stopped). */
  private interrupts = new Map<string, () => void>()
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

  /** Speakers whose original voice is currently lowered. */
  duckedSpeakers(): string[] {
    return [...this.ducked]
  }

  /** Stops waiting clips (leaving the meeting) and restores every original volume. */
  clear(): void {
    for (const queue of this.queues.values()) queue.length = 0 // in place: a running drain loop holds it
    this.restoreAll('cleared')
  }

  /**
   * The page was hidden or the audio context stopped: whatever is playing is abandoned and every
   * original voice goes back to full volume at once (waiting clips stay queued, but they are
   * judged by their age and will be dropped if stale).
   */
  restoreAll(reason: DuckReason): void {
    for (const interrupt of this.interrupts.values()) interrupt()
    for (const speakerId of [...this.ducked]) this.restore(speakerId, reason)
    for (const speakerId of this.queues.keys()) {
      if (!this.ducked.has(speakerId)) this.deps.setOriginalVolume(speakerId, 1)
    }
  }

  private duck(speakerId: string) {
    const volume = DUCK_VOLUME[this.deps.mode()]
    this.deps.setOriginalVolume(speakerId, volume)
    if (volume < 1) this.ducked.add(speakerId)
    this.deps.onDuck?.({ speakerId, volume, reason: 'start' })
  }

  private restore(speakerId: string, reason: DuckReason) {
    this.ducked.delete(speakerId)
    this.deps.setOriginalVolume(speakerId, 1)
    this.deps.onDuck?.({ speakerId, volume: 1, reason })
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
        // Nothing could be heard (audio blocked): do not lower the person who IS audible.
        if (this.deps.canPlay && !this.deps.canPlay()) {
          this.deps.onDrop?.(clip, 'blocked')
          continue
        }
        await this.playOne(speakerId, clip, ready)
      }
    } finally {
      // Whatever happened above, the original voice is not left lowered.
      if (this.ducked.has(speakerId)) this.restore(speakerId, 'failed')
      this.interrupts.delete(speakerId)
      this.running.delete(speakerId)
      this.setPlaying(this.running.size > 0)
    }
  }

  private async playOne(speakerId: string, clip: Clip, ready: Prepared) {
    this.duck(speakerId)
    this.setPlaying(true)
    this.deps.onStart?.(clip, this.deps.now())

    const limit =
      (this.deps.durationMs?.(ready) ?? DEFAULT_MAX_PLAY_MS - PLAY_GRACE_MS) + PLAY_GRACE_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    let interrupt!: () => void
    const outcome = await Promise.race([
      this.deps.play(ready, clip).then(
        () => 'ended' as const,
        () => 'failed' as const,
      ),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), limit)
      }),
      new Promise<'interrupted'>((resolve) => {
        interrupt = () => resolve('interrupted')
        this.interrupts.set(speakerId, interrupt)
      }),
    ])
    clearTimeout(timer)
    this.interrupts.delete(speakerId)
    if (outcome === 'failed' || outcome === 'timeout')
      this.deps.onDrop?.(clip, outcome === 'failed' ? 'failed' : 'timeout')
    // Restored right here, per clip: between two clips the original voice is at full volume.
    if (this.ducked.has(speakerId)) this.restore(speakerId, outcome)
    else this.deps.setOriginalVolume(speakerId, 1)
  }

  private setPlaying(playing: boolean) {
    if (playing === this.playingNow) return
    this.playingNow = playing
    this.deps.onPlayingChange(playing)
  }
}
