import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSessionUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ getSessionUser }))
const { POST } = await import('@/app/api/latency/route')

const ID = '22222222-2222-4222-8222-222222222222'
const post = (body: unknown) =>
  POST(
    new NextRequest('https://meet.transvoice.ai/api/latency', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  )

let n = 0
beforeEach(() => {
  vi.restoreAllMocks()
  getSessionUser.mockResolvedValue({ id: `user-${++n}`, email: 'secret@example.com' })
})

describe('POST /api/latency', () => {
  it('logs the measurement as one JSON line without any user data', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const res = await post({
      sessionId: ID,
      utteranceId: ID,
      kind: 'listen',
      lang: 'en-US',
      captionMs: 1200,
      audioMs: 1700,
      fetchMs: 90,
      via: 'url',
    })
    expect(res.status).toBe(204)
    const line = String(info.mock.calls[0]![0])
    expect(JSON.parse(line)).toMatchObject({ event: 'latency', kind: 'listen', audioMs: 1700 })
    expect(line).not.toContain('secret@example.com')
    expect(line).not.toContain('user-')
  })

  it('rejects signed-out users, junk, absurd numbers and unknown fields are dropped', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    expect((await post({ sessionId: 'x' })).status).toBe(400)
    expect(
      (await post({ sessionId: ID, utteranceId: ID, kind: 'listen', audioMs: -1 })).status,
    ).toBe(400)
    expect(
      (await post({ sessionId: ID, utteranceId: ID, kind: 'listen', audioMs: 9e9 })).status,
    ).toBe(400)
    getSessionUser.mockResolvedValue(null)
    expect((await post({ sessionId: ID, utteranceId: ID, kind: 'speak' })).status).toBe(401)
  })
})
