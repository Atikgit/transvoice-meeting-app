import { describe, expect, it, vi } from 'vitest'
import { MemoryAudioCache } from '@/lib/translation/audio-cache'
import { deliverSentenceClip } from '@/lib/translation/deliver'
import {
  decodeInlineAudio,
  encodeInlineAudio,
  encodeMessage,
  inlinePacketSize,
  MAX_INLINE_PACKET_BYTES,
  MAX_PACKET_BYTES,
  parseDataMessage,
  TOPICS,
  type InlineAudioHeader,
} from '@/lib/translation/messages'
import { BUILD_ID, PROTOCOL_VERSION } from '@/lib/build-id'
import { MAX_CLIP_AGE_MS, PlaybackQueues, type Clip } from '@/features/translation/playback'

const header: InlineAudioHeader = {
  utteranceId: '33333333-3333-4333-8333-333333333333',
  speakerId: '44444444-4444-4444-8444-444444444444',
  lang: 'bn-BD',
  format: 'mp3',
  speechEndedAt: 1_761_300_000_000,
  seq: 3,
  last: true,
}

describe('inline packet size (JSON header + length prefix + raw audio, whole packet ≤ 12 KiB)', () => {
  it('inlinePacketSize equals the real encoded packet', () => {
    const packet = encodeInlineAudio(header, new Uint8Array(5000))
    expect(inlinePacketSize(header, 5000)).toBe(packet.length)
    expect(packet.length).toBe(2 + (packet.length - 2 - 5000) + 5000)
    // the header carries the protocol version and the build
    expect(decodeInlineAudio(packet)!.header).toMatchObject({
      v: PROTOCOL_VERSION,
      build: BUILD_ID,
    })
  })

  it('refuses a packet over 12 KiB and stays far below the 15 KiB transport limit', () => {
    const room = MAX_INLINE_PACKET_BYTES - inlinePacketSize(header, 0)
    expect(() => encodeInlineAudio(header, new Uint8Array(room))).not.toThrow()
    expect(encodeInlineAudio(header, new Uint8Array(room)).length).toBe(MAX_INLINE_PACKET_BYTES)
    expect(() => encodeInlineAudio(header, new Uint8Array(room + 1))).toThrow('too large')
    expect(MAX_INLINE_PACKET_BYTES).toBeLessThan(MAX_PACKET_BYTES)
  })

  it('deliverSentenceClip: inline exactly up to the cap, URL one byte over; the whole mp3 is cached BEFORE its URL is announced', async () => {
    const order: string[] = []
    const send = vi.fn(async (_s: string, _d: Uint8Array, o: { topic: string }) => {
      order.push(`send:${o.topic}`)
    })
    const cache = new MemoryAudioCache()
    const put = cache.put.bind(cache)
    cache.put = async (...args) => {
      order.push('cache.put')
      return put(...args)
    }
    const common = {
      sessionId: 's',
      utteranceId: header.utteranceId,
      speakerId: header.speakerId,
      speechEndedAt: header.speechEndedAt,
      lang: 'bn-BD',
      listeners: ['g'],
      seq: 3,
      last: true,
      send,
      cache,
    }
    const cap = MAX_INLINE_PACKET_BYTES - inlinePacketSize(header, 0)
    expect(await deliverSentenceClip({ ...common, audio: new Uint8Array(cap) })).toBe('inline')
    expect(order).toEqual([`send:${TOPICS.audioInline}`])

    order.length = 0
    const big = new Uint8Array(cap + 1).fill(5)
    expect(await deliverSentenceClip({ ...common, audio: big })).toBe('url')
    expect(order).toEqual(['cache.put', `send:${TOPICS.audio}`]) // cached first
    const message = JSON.parse(new TextDecoder().decode(send.mock.calls.at(-1)![1]))
    const id = message.url.split('/').pop()
    const entry = await cache.get(id)
    expect(entry!.audio.length).toBe(big.length) // the whole file
    expect(entry!.mime).toBe('audio/mpeg')
    expect(message).toMatchObject({ seq: 3, last: true, v: PROTOCOL_VERSION, build: BUILD_ID })
  })
})

describe('every data message carries protocol version and build', () => {
  it('captions, audio and notices', () => {
    const caption = parseDataMessage(
      TOPICS.caption,
      encodeMessage({
        utteranceId: 'u',
        speakerId: 's',
        lang: 'bn-BD',
        original: 'a',
        translated: 'b',
        speechEndedAt: 1,
      }),
    )
    expect(caption!.message).toMatchObject({ v: PROTOCOL_VERSION, build: BUILD_ID })
    const notice = parseDataMessage(TOPICS.notice, encodeMessage({ kind: 'audio_unavailable' }))
    expect(notice!.message).toMatchObject({ v: PROTOCOL_VERSION, build: BUILD_ID })
  })

  it('an older tab (no v/build in the message) and a newer sender both still parse', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ kind: 'translation_unavailable' }))
    expect(parseDataMessage(TOPICS.notice, bytes)).not.toBeNull()
    const future = new TextEncoder().encode(
      JSON.stringify({ kind: 'translation_unavailable', v: 99, build: 'zzz', extra: 1 }),
    )
    expect(parseDataMessage(TOPICS.notice, future)!.message).toMatchObject({ v: 99, build: 'zzz' })
  })
})

describe('stale-drop uses time since the clip ARRIVED at the listener', () => {
  function setup(staleMs?: number) {
    let now = 0
    const events: string[] = []
    const drops: { reason: string; age: number }[] = []
    const finishers: (() => void)[] = []
    const queues = new PlaybackQueues<string>({
      now: () => now,
      staleMs,
      prepare: async (c) => c.utteranceId,
      play: (id) => {
        events.push(`play:${id}`)
        return new Promise<void>((r) => finishers.push(r))
      },
      setOriginalVolume: () => {},
      mode: () => 'off',
      onPlayingChange: () => {},
      onDrop: (c, reason, age) => {
        events.push(`drop:${c.utteranceId}`)
        drops.push({ reason, age })
      },
    })
    const clip = (id: string): Clip => ({
      speakerId: 'sp',
      utteranceId: id,
      url: '',
      receivedAt: now,
    })
    const tick = () => new Promise((r) => setTimeout(r, 0))
    return {
      queues,
      events,
      drops,
      clip,
      advance: (ms: number) => (now += ms),
      tick,
      finish: async () => (finishers.shift()?.(), tick()),
    }
  }

  it('default 15 s: a clip that waited 14 s behind another still plays; at 16 s it is dropped and the age is reported', async () => {
    const t = setup()
    t.queues.enqueue(t.clip('a'))
    t.queues.enqueue(t.clip('b'))
    await t.tick()
    t.advance(14_000)
    await t.finish()
    await t.tick()
    expect(t.events).toContain('play:b')

    const late = setup()
    late.queues.enqueue(late.clip('a'))
    late.queues.enqueue(late.clip('b'))
    await late.tick()
    late.advance(MAX_CLIP_AGE_MS + 1_000)
    await late.finish()
    await late.tick()
    expect(late.events).toContain('drop:b')
    expect(late.drops).toEqual([{ reason: 'stale', age: MAX_CLIP_AGE_MS + 1_000 }])
  })

  it('the threshold is STALE_CLIP_MS', async () => {
    const t = setup(3_000)
    t.queues.enqueue(t.clip('a'))
    t.queues.enqueue(t.clip('b'))
    await t.tick()
    t.advance(3_500)
    await t.finish()
    await t.tick()
    expect(t.drops).toEqual([{ reason: 'stale', age: 3_500 }])
  })

  it('a clip that arrives long after the speaker stopped is NOT stale: only its own wait counts', async () => {
    const t = setup(3_000)
    t.advance(60_000) // a minute of "age" since speech end means nothing: arrival is now
    t.queues.enqueue(t.clip('a'))
    await t.tick()
    expect(t.events).toEqual(['play:a'])
    expect(t.drops).toEqual([])
  })

  it('a missing seq blocks later clips for at most 400 ms (the clip after the gap still plays)', async () => {
    const played: number[] = []
    const queues = new PlaybackQueues<Clip>({
      now: () => performance.now(),
      prepare: async (c) => c,
      play: (c) => (played.push(c.seq!), Promise.resolve()),
      setOriginalVolume: () => {},
      mode: () => 'off',
      onPlayingChange: () => {},
    })
    const at = performance.now()
    queues.enqueue({ speakerId: 's', utteranceId: 'u', url: '', seq: 0, receivedAt: at })
    queues.enqueue({ speakerId: 's', utteranceId: 'u', url: '', seq: 2, receivedAt: at }) // seq 1 never comes
    await new Promise((r) => setTimeout(r, 150))
    expect(played).toEqual([0]) // 2 is still waiting for 1
    await new Promise((r) => setTimeout(r, 450))
    expect(played).toEqual([0, 2]) // …but not longer than 400 ms
  })
})

describe('clip trace (debug overlay)', () => {
  it('keeps the last 20 steps, only while the overlay is on', async () => {
    const { enableTranslationDebug, getTranslationDebug, traceClip } =
      await import('@/features/translation/debug-store')
    traceClip({ stage: 'received', utteranceId: 'off' })
    expect(getTranslationDebug().clipTrace).toEqual([])
    enableTranslationDebug(true)
    for (let i = 0; i < 25; i++) traceClip({ stage: 'enqueued', utteranceId: `u${i}`, seq: i })
    const trace = getTranslationDebug().clipTrace
    expect(trace).toHaveLength(20)
    expect(trace[0]!.utteranceId).toBe('u5')
    expect(trace.at(-1)!.utteranceId).toBe('u24')
    enableTranslationDebug(false)
  })
})
