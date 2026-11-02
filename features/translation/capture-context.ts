import type { CaptureContext } from '@/lib/translation/capture-context'

/** "Within the previous 1.5 s" and "the 300 ms before speech start" of the cross-capture check. */
export const RECENT_MS = 1500
export const PRE_MS = 300
/** A partner voice level (LiveKit audioLevel, 0..1) from which their voice counts as audible here. */
export const VOICE_AUDIBLE = 0.01
const SILENCE_DB = -120

/** Level in whole dBFS from a mean square (0 = full scale, -120 = silence). */
export function dbOfPower(power: number): number {
  return power > 1e-12 ? Math.max(SILENCE_DB, Math.round(10 * Math.log10(power))) : SILENCE_DB
}

interface Sample {
  at: number
  /** rms, 0..1 */
  level: number
}

/**
 * What this device's speakers did lately: the partner's original voice (their LiveKit audio level,
 * sampled by the room every ~100 ms) and the translated clips (their playback, with the level read
 * from an analyser on the clip output). `snapshot(now)` answers the cross-capture questions at the
 * moment the local speech starts. Times are performance.now() milliseconds.
 */
export class OutputMonitor {
  private voice: Sample[] = []
  private clips: Sample[] = []
  private voiceAudibleAt: number | null = null
  private clipPlaying = false
  private clipEndedAt: number | null = null

  pushVoice(now: number, level: number): void {
    this.voice.push({ at: now, level })
    if (level >= VOICE_AUDIBLE) this.voiceAudibleAt = now
    this.trim(this.voice, now)
  }

  pushClip(now: number, level: number): void {
    this.clips.push({ at: now, level })
    this.trim(this.clips, now)
  }

  clipStart(): void {
    this.clipPlaying = true
  }

  clipEnd(now: number): void {
    this.clipPlaying = false
    this.clipEndedAt = now
  }

  get playingClip(): boolean {
    return this.clipPlaying
  }

  reset(): void {
    this.voice = []
    this.clips = []
    this.voiceAudibleAt = null
    this.clipPlaying = false
    this.clipEndedAt = null
  }

  private trim(list: Sample[], now: number) {
    while (list.length > 0 && now - list[0]!.at > 3000) list.shift()
  }

  /** Mean power of the samples taken in the PRE_MS before `now` (0 when there are none). */
  private power(list: Sample[], now: number): number {
    const inWindow = list.filter((s) => s.at <= now && now - s.at <= PRE_MS)
    if (inWindow.length === 0) return 0
    return inWindow.reduce((sum, s) => sum + s.level * s.level, 0) / inWindow.length
  }

  snapshot(now: number): Pick<CaptureContext, 'clipMs' | 'voiceMs' | 'outDb'> {
    const since = (at: number | null): number | null => {
      if (at === null) return null
      const ms = Math.max(0, Math.round(now - at))
      return ms <= RECENT_MS ? ms : null
    }
    return {
      clipMs: this.clipPlaying ? 0 : since(this.clipEndedAt),
      voiceMs: since(this.voiceAudibleAt),
      // the louder of the two sources, as the speaker would hear it
      outDb: dbOfPower(Math.max(this.power(this.voice, now), this.power(this.clips, now))),
    }
  }
}

/** Mean-square power of a frame. */
export function framePower(frame: Float32Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!
  return frame.length > 0 ? sum / frame.length : 0
}

/** The microphone's recent frames (timestamped); micDb() = their loudness in the PRE_MS before `now`. */
export class MicHistory {
  private frames: { at: number; power: number }[] = []

  push(now: number, power: number): void {
    this.frames.push({ at: now, power })
    while (this.frames.length > 0 && now - this.frames[0]!.at > 1000) this.frames.shift()
  }

  clear(): void {
    this.frames = []
  }

  micDb(now: number): number {
    const recent = this.frames.filter((f) => now - f.at <= PRE_MS)
    if (recent.length === 0) return SILENCE_DB
    return dbOfPower(recent.reduce((sum, f) => sum + f.power, 0) / recent.length)
  }
}

/** The one monitor of this browser tab (the room samples into it; the detector reads from it). */
export const outputMonitor = new OutputMonitor()

/** Everything the detector knows at speech end. */
export function buildCaptureContext(args: {
  startedAt: number
  endedAt: number
  redemptionMs: number
  micDb: number
  output: Pick<CaptureContext, 'clipMs' | 'voiceMs' | 'outDb'>
}): CaptureContext {
  return {
    // the VAD reports the end only after its end-of-speech wait: not part of the speech
    vadMs: Math.max(0, Math.round(args.endedAt - args.startedAt - args.redemptionMs)),
    clipMs: args.output.clipMs,
    voiceMs: args.output.voiceMs,
    micDb: args.micDb,
    outDb: args.output.outDb,
  }
}

/** One line for the overlay. */
export function describeContext(ctx: CaptureContext): string {
  const clip =
    ctx.clipMs === null
      ? 'no clip'
      : ctx.clipMs === 0
        ? 'clip PLAYING'
        : `clip ended ${ctx.clipMs} ms before`
  const voice =
    ctx.voiceMs === null
      ? 'partner silent'
      : ctx.voiceMs === 0
        ? 'partner AUDIBLE'
        : `partner audible ${ctx.voiceMs} ms before`
  return `${(ctx.vadMs / 1000).toFixed(1)} s | ${clip}, ${voice} | mic ${ctx.micDb} dB vs output ${ctx.outDb} dB`
}

/** Could this microphone have heard the other side? (the 1.5 s rule: a clip or the partner's voice within it) */
export function couldHearPartner(ctx: CaptureContext): boolean {
  return ctx.clipMs !== null || ctx.voiceMs !== null
}
