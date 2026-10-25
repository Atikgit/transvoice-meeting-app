import { describe, expect, it, vi } from 'vitest'
import { addCaption, captionText } from '@/features/translation/captions'
import { LatencyTracker } from '@/features/translation/metrics'
import {
  DUCK_VOLUME,
  MAX_CLIP_AGE_MS,
  PlaybackQueues,
  type Clip,
  type OriginalAudioMode,
} from '@/features/translation/playback'
import { encodeMessage, parseDataMessage, TOPICS } from '@/lib/translation/messages'

/** A controllable playback environment: each play() resolves when the test says so. */
function harness(mode: OriginalAudioMode = 'duck') {
  let now = 0
  const events: string[] = []
  const finishers: (() => void)[] = []
  let prepareFails = new Set<string>()
  const playing: boolean[] = []
  const queues = new PlaybackQueues<string>({
    now: () => now,
    prepare: async (clip) => {
      if (prepareFails.has(clip.utteranceId)) throw new Error('decode failed')
      return clip.utteranceId
    },
    play: (id) => {
      events.push(`play:${id}`)
      return new Promise<void>((resolve) =>
        finishers.push(() => (events.push(`end:${id}`), resolve())),
      )
    },
    setOriginalVolume: (speaker, volume) => events.push(`vol:${speaker}=${volume}`),
    mode: () => mode,
    onPlayingChange: (p) => playing.push(p),
    onDrop: (clip, reason) => events.push(`drop:${clip.utteranceId}:${reason}`),
  })
  const clip = (utteranceId: string, speakerId = 'sp1', receivedAt = now): Clip => ({
    speakerId,
    utteranceId,
    url: `/api/tts/${utteranceId}`,
    receivedAt,
  })
  const tick = () => new Promise((r) => setTimeout(r, 0))
  return {
    queues,
    events,
    playing,
    clip,
    tick,
    advance: (ms: number) => (now += ms),
    finish: async () => (finishers.shift()?.(), tick()),
    failPrepare: (id: string) => prepareFails.add(id),
    reset: () => (prepareFails = new Set()),
  }
}

describe('per-speaker playback queue', () => {
  it('plays a speaker’s clips in order, one at a time', async () => {
    const h = harness()
    h.queues.enqueue(h.clip('a'))
    h.queues.enqueue(h.clip('b'))
    await h.tick()
    expect(h.events.filter((e) => e.startsWith('play') || e.startsWith('end'))).toEqual(['play:a'])
    await h.finish()
    await h.tick()
    expect(h.events.filter((e) => e.startsWith('play') || e.startsWith('end'))).toEqual([
      'play:a',
      'end:a',
      'play:b',
    ])
  })

  it('different speakers play independently', async () => {
    const h = harness()
    h.queues.enqueue(h.clip('a', 'sp1'))
    h.queues.enqueue(h.clip('b', 'sp2'))
    await h.tick()
    expect(h.events.filter((e) => e.startsWith('play'))).toEqual(['play:a', 'play:b'])
  })

  it('drops clips that waited longer than 6 s behind a long clip', async () => {
    const h = harness()
    h.queues.enqueue(h.clip('a'))
    h.queues.enqueue(h.clip('b')) // arrives now, will wait
    await h.tick()
    h.advance(MAX_CLIP_AGE_MS + 1)
    await h.finish()
    await h.tick()
    expect(h.events).toContain('drop:b:stale')
    expect(h.events).not.toContain('play:b')
  })

  it('keeps clips that are exactly at the limit; skips clips that fail to decode', async () => {
    const h = harness()
    h.failPrepare('bad')
    h.queues.enqueue(h.clip('bad'))
    h.queues.enqueue(h.clip('good'))
    await h.tick()
    expect(h.events).toContain('drop:bad:failed')
    expect(h.events).toContain('play:good')
  })

  it('reports playing while any clip plays (VAD echo gate) and clears afterwards', async () => {
    const h = harness()
    h.queues.enqueue(h.clip('a'))
    await h.tick()
    expect(h.playing).toEqual([true])
    await h.finish()
    await h.tick()
    expect(h.playing).toEqual([true, false])
  })
})

describe('ducking the speaker’s original audio', () => {
  it.each([
    ['duck', 0.15],
    ['mute', 0],
    ['off', 1], // "keep it at full volume"
  ] as const)(
    '%s → volume %s while the clip plays, restored to 1 afterwards',
    async (mode, volume) => {
      expect(DUCK_VOLUME[mode]).toBe(volume)
      const h = harness(mode)
      h.queues.enqueue(h.clip('a', 'sp1'))
      await h.tick()
      expect(h.events).toContain(`vol:sp1=${volume}`)
      await h.finish()
      await h.tick()
      expect(h.events.at(-1)).toBe('vol:sp1=1')
    },
  )

  it('lowers the voice only while a clip plays: back to full volume between two clips', async () => {
    const h = harness('duck')
    h.queues.enqueue(h.clip('a', 'sp1'))
    h.queues.enqueue(h.clip('b', 'sp1'))
    await h.tick()
    await h.finish()
    await h.tick()
    expect(h.events.filter((e) => e.startsWith('vol:') || e.startsWith('play:'))).toEqual([
      'vol:sp1=0.15',
      'play:a',
      'vol:sp1=1', // a ended: restored before b is even considered
      'vol:sp1=0.15',
      'play:b',
    ])
    await h.finish()
    await h.tick()
    expect(h.events.filter((e) => e.startsWith('vol:')).at(-1)).toBe('vol:sp1=1')
    expect(h.events.some((e) => e.includes('sp2'))).toBe(false)
  })

  it('clear() restores originals and stops waiting clips', async () => {
    const h = harness('mute')
    h.queues.enqueue(h.clip('a'))
    h.queues.enqueue(h.clip('b'))
    await h.tick()
    h.queues.clear()
    await h.finish()
    await h.tick()
    expect(h.events).not.toContain('play:b')
    expect(h.events.at(-1)).toBe('vol:sp1=1')
  })
})

describe('captions', () => {
  it('keeps the last entries; own speech shows only the original transcript', () => {
    let log = addCaption([], { id: '1', from: 'self', original: 'আমি ভালো আছি', translated: '' })
    log = addCaption(log, { id: '2', from: 'other', original: 'Hello', translated: 'হ্যালো' })
    expect(captionText(log)).toEqual({ original: 'আমি ভালো আছি Hello', translated: 'হ্যালো' })
    for (let i = 3; i < 9; i++)
      log = addCaption(log, {
        id: String(i),
        from: 'other',
        original: `o${i}`,
        translated: `t${i}`,
      })
    expect(log).toHaveLength(4)
    expect(captionText(log).original).toBe('o6 o7 o8')
  })

  it('updates an entry instead of duplicating it', () => {
    let log = addCaption([], { id: '1', from: 'other', original: 'a', translated: '' })
    log = addCaption(log, { id: '1', from: 'other', original: 'a', translated: 'b' })
    expect(log).toHaveLength(1)
    expect(log[0]!.translated).toBe('b')
  })
})

describe('data message parsing', () => {
  const enc = (m: object) => encodeMessage(m)
  const caption = {
    utteranceId: 'u',
    speakerId: 's',
    lang: 'en-US',
    original: 'o',
    translated: 't',
    speechEndedAt: 1,
  }

  it('accepts well-formed captions, audio and notices', () => {
    expect(parseDataMessage(TOPICS.caption, enc(caption))).toMatchObject({ topic: TOPICS.caption })
    const audio = {
      utteranceId: 'u',
      speakerId: 's',
      lang: 'en-US',
      url: `/api/tts/${'A'.repeat(24)}`,
      speechEndedAt: 1,
    }
    expect(parseDataMessage(TOPICS.audio, enc(audio))).toMatchObject({ topic: TOPICS.audio })
    expect(parseDataMessage(TOPICS.notice, enc({ kind: 'translation_unavailable' }))).not.toBeNull()
  })

  it('rejects other origins, malformed JSON and unknown topics', () => {
    const evil = {
      utteranceId: 'u',
      speakerId: 's',
      lang: 'en-US',
      url: 'https://evil.example/a.wav',
      speechEndedAt: 1,
    }
    expect(parseDataMessage(TOPICS.audio, enc(evil))).toBeNull()
    expect(parseDataMessage(TOPICS.audio, enc({ ...evil, url: '/api/tts/../../admin' }))).toBeNull()
    expect(parseDataMessage(TOPICS.caption, new TextEncoder().encode('not json'))).toBeNull()
    expect(parseDataMessage('other.topic', enc(caption))).toBeNull()
    expect(parseDataMessage(undefined, enc(caption))).toBeNull()
  })
})

describe('LatencyTracker', () => {
  it('measures speech end → caption → audio start and keeps the latest', () => {
    const t = new LatencyTracker(2)
    t.captionShown('u1', 1000, 1900)
    t.audioStarted('u1', 1000, 2300)
    expect(t.latest()).toEqual({ utteranceId: 'u1', captionMs: 900, audioMs: 1300 })
    t.captionShown('u2', 5000, 4990) // clock skew never gives negative numbers
    t.captionShown('u3', 6000, 6500)
    expect(t.latest()).toEqual({ utteranceId: 'u3', captionMs: 500 })
  })
})

describe('every path puts the original voice back (and never lowers it without a clip)', () => {
  const volumes = (h: ReturnType<typeof harness>) => h.events.filter((e) => e.startsWith('vol:'))

  it('a clip that cannot be decoded, a stale clip and an empty queue never touch the volume', async () => {
    const h = harness('mute')
    h.failPrepare('bad')
    h.queues.enqueue(h.clip('bad'))
    await h.tick()
    h.advance(MAX_CLIP_AGE_MS + 1)
    h.queues.enqueue(h.clip('old', 'sp1', 0))
    await h.tick()
    expect(h.events).toContain('drop:bad:failed')
    expect(h.events).toContain('drop:old:stale')
    expect(volumes(h)).toEqual([]) // "mute" mode has nothing to mute when no translation plays
  })

  it('"mute" mode lowers nothing for a direction that has no translated clip', async () => {
    const h = harness('mute')
    await h.tick()
    expect(volumes(h)).toEqual([])
    expect(h.queues.duckedSpeakers()).toEqual([])
  })

  it('a clip whose playback fails restores the voice', async () => {
    const events: string[] = []
    const queues = new PlaybackQueues<string>({
      now: () => 0,
      prepare: async () => 'x',
      play: async () => {
        throw new Error('decode error')
      },
      setOriginalVolume: (s, v) => events.push(`vol:${s}=${v}`),
      mode: () => 'duck',
      onPlayingChange: () => {},
      onDrop: (_c, r) => events.push(`drop:${r}`),
    })
    queues.enqueue({ speakerId: 'sp1', utteranceId: 'a', url: '', receivedAt: 0 })
    await new Promise((r) => setTimeout(r, 0))
    expect(events).toEqual(['vol:sp1=0.15', 'drop:failed', 'vol:sp1=1'])
    expect(queues.duckedSpeakers()).toEqual([])
  })

  it('a clip that never ends is abandoned after its length + 3 s and the voice comes back', async () => {
    vi.useFakeTimers()
    try {
      const events: string[] = []
      const queues = new PlaybackQueues<{ ms: number }>({
        now: () => 0,
        prepare: async () => ({ ms: 2000 }),
        durationMs: (p) => p.ms,
        play: () => new Promise<void>(() => {}), // a suspended context: never ends
        setOriginalVolume: (s, v) => events.push(`vol:${s}=${v}`),
        mode: () => 'mute',
        onPlayingChange: (p) => events.push(`playing:${p}`),
        onDrop: (_c, r) => events.push(`drop:${r}`),
      })
      queues.enqueue({ speakerId: 'sp1', utteranceId: 'a', url: '', receivedAt: 0 })
      await vi.advanceTimersByTimeAsync(1)
      expect(queues.duckedSpeakers()).toEqual(['sp1'])
      await vi.advanceTimersByTimeAsync(4_900)
      expect(queues.duckedSpeakers()).toEqual(['sp1']) // still within 2 s + 3 s
      await vi.advanceTimersByTimeAsync(200)
      expect(events).toEqual([
        'vol:sp1=0',
        'playing:true',
        'drop:timeout',
        'vol:sp1=1',
        'playing:false',
      ])
      expect(queues.duckedSpeakers()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a hidden tab or a stopped audio context restores at once, even mid-clip', async () => {
    const h = harness('mute')
    h.queues.enqueue(h.clip('a', 'sp1'))
    h.queues.enqueue(h.clip('b', 'sp2'))
    await h.tick()
    expect(h.queues.duckedSpeakers().sort()).toEqual(['sp1', 'sp2'])
    h.queues.restoreAll('interrupted')
    await h.tick()
    expect(h.queues.duckedSpeakers()).toEqual([])
    expect([...new Set(volumes(h).filter((v) => v.endsWith('=1')))].sort()).toEqual([
      'vol:sp1=1',
      'vol:sp2=1',
    ])
  })

  it('blocked audio (suspended context): the clip is dropped and the audible voice is NOT lowered', async () => {
    const events: string[] = []
    const queues = new PlaybackQueues<string>({
      now: () => 0,
      prepare: async () => 'x',
      play: async () => void events.push('play'),
      canPlay: () => false,
      setOriginalVolume: (s, v) => events.push(`vol:${s}=${v}`),
      mode: () => 'mute',
      onPlayingChange: () => {},
      onDrop: (_c, r) => events.push(`drop:${r}`),
    })
    queues.enqueue({ speakerId: 'sp1', utteranceId: 'a', url: '', receivedAt: 0 })
    await new Promise((r) => setTimeout(r, 0))
    expect(events).toEqual(['drop:blocked'])
  })

  it('reports every change for the debug overlay (start, end)', async () => {
    const ducks: string[] = []
    const queues = new PlaybackQueues<string>({
      now: () => 0,
      prepare: async () => 'x',
      play: async () => {},
      setOriginalVolume: () => {},
      mode: () => 'duck',
      onPlayingChange: () => {},
      onDuck: (e) => ducks.push(`${e.volume}:${e.reason}`),
    })
    queues.enqueue({ speakerId: 'sp1', utteranceId: 'a', url: '', receivedAt: 0 })
    await new Promise((r) => setTimeout(r, 0))
    expect(ducks).toEqual(['0.15:start', '1:ended'])
  })
})
