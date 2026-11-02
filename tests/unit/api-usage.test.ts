import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeWav } from '@/lib/translation/wav'

vi.mock('server-only', () => ({}))
const upsert = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ upsert }) }),
}))
const { recordApiUsage, usageRows } = await import('@/lib/translation/usage')

const UTTERANCE = '44444444-4444-4444-8444-444444444444'
const base = {
  sessionId: 'session-1',
  speakerId: 'speaker-1',
  utteranceId: UTTERANCE,
  languages: ['en-US', 'es-ES'],
}
const wav = (seconds: number) => encodeWav(new Float32Array(Math.round(seconds * 16_000)))

beforeEach(() => {
  upsert.mockReset().mockResolvedValue({ error: null })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('api_usage_events rows', () => {
  it('one row per successful target language with the WAV length (2.5 s → 2.5 in each)', () => {
    const rows = usageRows({ ...base, audio: wav(2.5), format: 'wav' })
    expect(rows).toEqual([
      {
        request_id: `${UTTERANCE}:0:en-US`,
        session_id: 'session-1',
        speaker_id: 'speaker-1',
        target_lang: 'en-US',
        speech_seconds: 2.5,
      },
      expect.objectContaining({ target_lang: 'es-ES', speech_seconds: 2.5 }),
    ])
  })

  it('the request id includes the chunk sequence, so pieces of one utterance are distinct', () => {
    const a = usageRows({ ...base, seq: 0, audio: wav(1), format: 'wav' })
    const b = usageRows({ ...base, seq: 1, audio: wav(1), format: 'wav' })
    expect(a[0]!.request_id).not.toBe(b[0]!.request_id)
  })

  it('records nothing for Opus uploads (no duration to measure) or when no call succeeded', () => {
    expect(usageRows({ ...base, audio: new Uint8Array(500), format: 'opus' })).toEqual([])
    expect(usageRows({ ...base, languages: [], audio: wav(1), format: 'wav' })).toEqual([])
  })
})

describe('recordApiUsage', () => {
  it('upserts on request_id ignoring duplicates', async () => {
    recordApiUsage({ ...base, audio: wav(1), format: 'wav' })
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1))
    expect(upsert.mock.calls[0]![1]).toEqual({ onConflict: 'request_id', ignoreDuplicates: true })
    expect(upsert.mock.calls[0]![0]).toHaveLength(2)
  })

  it('a database error is logged (counts only) and never thrown', async () => {
    upsert.mockResolvedValue({ error: { message: 'down' } })
    expect(() => recordApiUsage({ ...base, audio: wav(1), format: 'wav' })).not.toThrow()
    const warn = vi.mocked(console.warn)
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    const line = String(warn.mock.calls[0]![0])
    expect(JSON.parse(line)).toMatchObject({ event: 'api_usage_failed', rows: 2 })
    expect(line).not.toContain('session-1')
  })
})
