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

/**
 * Default for STALE_CLIP_MS. A clip is stale when it has waited this long since it ARRIVED at the
 * listener (receivedAt is the listener's own clock at arrival; the speaker's speech end plays no part).
 */
export const MAX_CLIP_AGE_MS = 15_000
export const DUCK_VOLUME: Record<OriginalAudioMode, number> = { off: 1, duck: 0.15, mute: 0 }
/** A clip that has not finished this long after it should have is treated as hung. */
export const PLAY_GRACE_MS = 3000
/** Used when the clip's length is unknown. */
export const DEFAULT_MAX_PLAY_MS = 15_000
/** A clip whose predecessor (seq - 1) has not arrived yet waits this long for it. */
export const REORDER_WAIT_MS = 400
/** After a clip that is not marked last, the original voice stays lowered this long for the next one. */
export const DUCK_HOLD_MS = 800

export interface Clip {
  speakerId: string
  utteranceId: string
  url: string
  /** The clip itself when it arrived inside the data packet (then there is no url to fetch). */
  data?: Uint8Array
  /** Split pipeline: position within the utterance, and whether this is its final clip. */
  seq?: number
  last?: boolean
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
  /** STALE_CLIP_MS (default MAX_CLIP_AGE_MS). */
  staleMs?: number
  /** True while any translated clip is playing (feeds the VAD echo gate). */
  onPlayingChange: (playing: boolean) => void
  /** Called with the first-sound time of each clip (latency metrics) or when one is dropped. */
  onStart?: (clip: Clip, at: number) => void
  /** `ageMs` = time since the clip arrived at this listener. */
  onDrop?: (clip: Clip, reason: DropReason, ageMs: number) => void
  /** A clip finished (or failed / timed out / was interrupted). */
  onEnd?: (clip: Clip, outcome: DuckReason) => void
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
  /** Per utterance: the highest seq that has been played or dropped (for ordering). */
  private progress = new Map<string, number>()
  /** Speakers whose duck is being kept for the next clip of the same utterance. */
  private holds = new Map<string, ReturnType<typeof setTimeout>>()
  private arrival: (() => void) | null = null

  constructor(private readonly deps: PlaybackDeps<Prepared>) {}

  enqueue(clip: Clip): void {
    const prepared = this.deps.prepare(clip)
    prepared.catch(() => {}) // handled when the clip's turn comes
    const queue = this.queues.get(clip.speakerId) ?? []
    // Clips of one utterance play in seq order even when they arrive out of order.
    const later =
      clip.seq === undefined
        ? -1
        : queue.findIndex(
            (q) =>
              q.clip.utteranceId === clip.utteranceId &&
              q.clip.seq !== undefined &&
              q.clip.seq > clip.seq!,
          )
    if (later >= 0) queue.splice(later, 0, { clip, prepared })
    else queue.push({ clip, prepared })
    this.queues.set(clip.speakerId, queue)
    this.arrival?.()
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
    this.clearHolds()
    for (const queue of this.queues.values()) queue.length = 0 // in place: a running drain loop holds it
    this.restoreAll('cleared')
  }

  /**
   * The page was hidden or the audio context stopped: whatever is playing is abandoned and every
   * original voice goes back to full volume at once (waiting clips stay queued, but they are
   * judged by their age and will be dropped if stale).
   */
  restoreAll(reason: DuckReason): void {
    this.clearHolds()
    for (const interrupt of this.interrupts.values()) interrupt()
    for (const speakerId of [...this.ducked]) this.restore(speakerId, reason)
    for (const speakerId of this.queues.keys()) {
      if (!this.ducked.has(speakerId)) this.deps.setOriginalVolume(speakerId, 1)
    }
  }

  private staleMs(): number {
    return this.deps.staleMs ?? MAX_CLIP_AGE_MS
  }

  private clearHolds() {
    for (const timer of this.holds.values()) clearTimeout(timer)
    this.holds.clear()
  }

  private duck(speakerId: string) {
    const hold = this.holds.get(speakerId)
    if (hold) clearTimeout(hold)
    this.holds.delete(speakerId)
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
        if (this.deps.now() - clip.receivedAt > this.staleMs()) {
          this.deps.onDrop?.(clip, 'stale', this.deps.now() - clip.receivedAt)
          this.markDone(clip)
          continue
        }
        let ready: Prepared
        try {
          ready = await prepared
        } catch {
          this.deps.onDrop?.(clip, 'failed', this.deps.now() - clip.receivedAt)
          this.markDone(clip)
          continue
        }
        // Preparing may have taken long: a clip that is stale now would talk over the present.
        if (this.deps.now() - clip.receivedAt > this.staleMs()) {
          this.deps.onDrop?.(clip, 'stale', this.deps.now() - clip.receivedAt)
          continue
        }
        // Nothing could be heard (audio blocked): do not lower the person who IS audible.
        if (this.deps.canPlay && !this.deps.canPlay()) {
          this.deps.onDrop?.(clip, 'blocked', this.deps.now() - clip.receivedAt)
          continue
        }
        if (await this.waitForPredecessor(clip)) {
          // an earlier clip of this utterance arrived meanwhile: it goes first
          const lastEarlier = queue.findLastIndex(
            (q) => q.clip.utteranceId === clip.utteranceId && (q.clip.seq ?? 0) < clip.seq!,
          )
          queue.splice(lastEarlier + 1, 0, { clip, prepared })
          continue
        }
        await this.playOne(speakerId, clip, ready)
        this.markDone(clip)
      }
    } finally {
      // Whatever happened above, the original voice is not left lowered (unless it is being held
      // for the next clip of the same utterance, which restores it itself after DUCK_HOLD_MS).
      if (this.ducked.has(speakerId) && !this.holds.has(speakerId))
        this.restore(speakerId, 'failed')
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
      this.deps.onDrop?.(
        clip,
        outcome === 'failed' ? 'failed' : 'timeout',
        this.deps.now() - clip.receivedAt,
      )
    this.deps.onEnd?.(clip, outcome)
    // Restored right here, per clip: between two clips the original voice is at full volume.
    // Split pipeline: within one utterance the voice stays lowered from the first clip's start to
    // the last clip's end (clips not marked last wait DUCK_HOLD_MS for their successor).
    if (this.ducked.has(speakerId) && clip.last === false && outcome === 'ended') {
      this.holds.set(
        speakerId,
        setTimeout(() => {
          this.holds.delete(speakerId)
          if (this.ducked.has(speakerId)) this.restore(speakerId, 'ended')
        }, DUCK_HOLD_MS),
      )
    } else if (this.ducked.has(speakerId)) this.restore(speakerId, outcome)
    else this.deps.setOriginalVolume(speakerId, 1)
  }

  private markDone(clip: Clip) {
    if (clip.seq === undefined) return
    this.progress.set(
      clip.utteranceId,
      Math.max(this.progress.get(clip.utteranceId) ?? -1, clip.seq),
    )
    if (clip.last || this.progress.size > 50)
      this.progress.delete(clip.last ? clip.utteranceId : this.progress.keys().next().value!)
  }

  /** True when an earlier clip of the same utterance arrived while this one waited for it. */
  private async waitForPredecessor(clip: Clip): Promise<boolean> {
    if (clip.seq === undefined || clip.seq === 0) return false
    if ((this.progress.get(clip.utteranceId) ?? -1) >= clip.seq - 1) return false
    const queue = this.queues.get(clip.speakerId) ?? []
    const earlier = () =>
      queue.some((q) => q.clip.utteranceId === clip.utteranceId && (q.clip.seq ?? 0) < clip.seq!)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      this.arrival?.()
    }, REORDER_WAIT_MS)
    while (!earlier() && !timedOut) {
      await new Promise<void>((resolve) => (this.arrival = resolve))
      this.arrival = null
    }
    clearTimeout(timer)
    return earlier()
  }

  private setPlaying(playing: boolean) {
    if (playing === this.playingNow) return
    this.playingNow = playing
    this.deps.onPlayingChange(playing)
  }
}
