import { describe, expect, it } from 'vitest'
import {
  buildCaptureContext,
  couldHearPartner,
  dbOfPower,
  describeContext,
  framePower,
  MicHistory,
  OutputMonitor,
  PRE_MS,
  RECENT_MS,
  VOICE_AUDIBLE,
} from '@/features/translation/capture-context'
import {
  encodeCaptureContext,
  MAX_CAPTURE_CTX_CHARS,
  parseCaptureContext,
} from '@/lib/translation/capture-context'

describe('constants of the cross-capture check', () => {
  it('previous 1.5 s, 300 ms before speech start, partner audible from level 0.01 (-40 dB)', () => {
    expect(RECENT_MS).toBe(1500)
    expect(PRE_MS).toBe(300)
    expect(VOICE_AUDIBLE).toBe(0.01)
  })
})

describe('dbOfPower / framePower', () => {
  it.each([
    [1, 0],
    [0.01, -20],
    [0.0001, -40], // rms 0.01
    [0.00125, -29], // 10 log10 = -29.03
    [0, -120],
  ])('power %s -> %i dB', (power, db) => expect(dbOfPower(power)).toBe(db))

  it('framePower is the mean square: a constant 0.1 frame has power 0.01 (-20 dB)', () => {
    expect(framePower(new Float32Array(512).fill(0.1))).toBeCloseTo(0.01, 6)
    expect(framePower(new Float32Array(0))).toBe(0)
  })
})

describe('OutputMonitor.snapshot (the speakers just before the local speech starts)', () => {
  it('partner voice audible until 200 ms before: voiceMs 200, output -29 dB over the last 300 ms', () => {
    const m = new OutputMonitor()
    for (const [at, level] of [
      [1000, 0.05],
      [1100, 0.05],
      [1200, 0.05],
      [1300, 0],
      [1400, 0],
    ] as const)
      m.pushVoice(at, level)
    // window [1100, 1400]: levels .05, .05, 0, 0 -> mean power (0.0025 + 0.0025) / 4 = 0.00125 = -29 dB
    expect(m.snapshot(1400)).toEqual({ clipMs: null, voiceMs: 200, outDb: -29 })
  })

  it('partner voice 1600 ms ago is outside the 1.5 s rule: voiceMs null; nothing in the window is -120 dB', () => {
    const m = new OutputMonitor()
    m.pushVoice(1000, 0.2)
    m.pushVoice(2000, 0)
    m.pushVoice(2500, 0)
    expect(m.snapshot(2600)).toEqual({
      clipMs: null,
      voiceMs: null,
      outDb: -120,
    })
  })

  it('exactly 1500 ms still counts, 1501 ms does not', () => {
    const m = new OutputMonitor()
    m.pushVoice(1000, 0.5)
    expect(m.snapshot(2500).voiceMs).toBe(1500)
    expect(m.snapshot(2501).voiceMs).toBeNull()
  })

  it('a translated clip playing now: clipMs 0; ended 700 ms ago: 700; ended 1501 ms ago: null', () => {
    const m = new OutputMonitor()
    m.clipStart()
    expect(m.snapshot(5000).clipMs).toBe(0)
    expect(m.playingClip).toBe(true)
    m.clipEnd(5000)
    expect(m.snapshot(5700).clipMs).toBe(700)
    expect(m.snapshot(6500).clipMs).toBe(1500)
    expect(m.snapshot(6501).clipMs).toBeNull()
  })

  it('output level is the louder of partner voice and clip: clip 0.1 (-20 dB) beats voice 0.01 (-40 dB)', () => {
    const m = new OutputMonitor()
    m.pushVoice(900, 0.01)
    m.pushVoice(1000, 0.01)
    m.pushClip(900, 0.1)
    m.pushClip(1000, 0.1)
    expect(m.snapshot(1000).outDb).toBe(-20)
  })

  it('samples older than 3 s are dropped and reset() forgets everything', () => {
    const m = new OutputMonitor()
    m.pushVoice(0, 0.5)
    m.pushVoice(3500, 0)
    expect(m.snapshot(3500).voiceMs).toBeNull() // 0.5 at t=0 is 3500 ms ago
    m.pushVoice(3600, 0.5)
    m.reset()
    expect(m.snapshot(3600)).toEqual({ clipMs: null, voiceMs: null, outDb: -120 })
  })
})

describe('MicHistory.micDb (the microphone in the 300 ms before speech start)', () => {
  it('averages the power of the frames within 300 ms: three frames of rms 0.01 -> -40 dB; an older loud frame is ignored', () => {
    const mic = new MicHistory()
    mic.push(100, 1) // loud, 900 ms before
    mic.push(700, 0.0001)
    mic.push(800, 0.0001)
    mic.push(900, 0.0001)
    expect(mic.micDb(1000)).toBe(-40)
  })

  it('no frames: -120 dB; clear() forgets', () => {
    const mic = new MicHistory()
    expect(mic.micDb(1000)).toBe(-120)
    mic.push(990, 0.01)
    mic.clear()
    expect(mic.micDb(1000)).toBe(-120)
  })
})

describe('buildCaptureContext / describeContext / couldHearPartner', () => {
  it('vadMs = speech start to end minus the end-of-speech wait: 12400 - 10000 - 400 = 2000', () => {
    const ctx = buildCaptureContext({
      startedAt: 10_000,
      endedAt: 12_400,
      redemptionMs: 400,
      micDb: -42,
      output: { clipMs: null, voiceMs: 200, outDb: -29 },
    })
    expect(ctx).toEqual({ vadMs: 2000, clipMs: null, voiceMs: 200, micDb: -42, outDb: -29 })
    expect(describeContext(ctx)).toBe(
      '2.0 s | no clip, partner audible 200 ms before | mic -42 dB vs output -29 dB',
    )
    expect(couldHearPartner(ctx)).toBe(true)
  })

  it('a speech shorter than the end wait is 0, never negative', () => {
    expect(
      buildCaptureContext({
        startedAt: 1000,
        endedAt: 1200,
        redemptionMs: 400,
        micDb: -60,
        output: { clipMs: null, voiceMs: null, outDb: -120 },
      }).vadMs,
    ).toBe(0)
  })

  it('nothing audible within 1.5 s: could not hear the partner', () => {
    expect(
      couldHearPartner({ vadMs: 900, clipMs: null, voiceMs: null, micDb: -50, outDb: -120 }),
    ).toBe(false)
    expect(couldHearPartner({ vadMs: 900, clipMs: 0, voiceMs: null, micDb: -50, outDb: -20 })).toBe(
      true,
    )
  })
})

describe('the context on the wire', () => {
  const ctx = { vadMs: 2000, clipMs: 0, voiceMs: 200, micDb: -42, outDb: -29 }

  it('round-trips and stays far below the 200-character limit', () => {
    const raw = encodeCaptureContext(ctx)
    expect(raw).toBe('{"vadMs":2000,"clipMs":0,"voiceMs":200,"micDb":-42,"outDb":-29}')
    expect(raw.length).toBeLessThan(MAX_CAPTURE_CTX_CHARS)
    expect(parseCaptureContext(raw)).toEqual(ctx)
  })

  it.each([
    ['not a string', 42],
    ['empty', ''],
    ['not JSON', '{nope'],
    ['clip older than 1.5 s', '{"vadMs":1,"clipMs":1600,"voiceMs":null,"micDb":-1,"outDb":-1}'],
    ['positive dB', '{"vadMs":1,"clipMs":null,"voiceMs":null,"micDb":5,"outDb":-1}'],
    ['extra text field smuggled in as a missing field', '{"vadMs":1}'],
    ['too long', ' '.repeat(MAX_CAPTURE_CTX_CHARS + 1)],
  ])('ignores a bad value (%s) instead of failing the upload', (_name, raw) => {
    expect(parseCaptureContext(raw)).toBeUndefined()
  })
})
