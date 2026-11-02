import { mkdtempSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeWav } from '@/lib/translation/wav'

const ALICE = '11111111-1111-4111-8111-111111111111'
const BOB = '22222222-2222-4222-8222-222222222222'
const CAROL = '44444444-4444-4444-8444-444444444444'
const SESSION = '33333333-3333-4333-8333-333333333333'
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const env = {
  DEBUG_CAPTURE_DROPPED: true,
  DEBUG_CAPTURE_DIR: '',
  TRANSLATION_BETA_ALLOWLIST: 'alice@example.com, carol@example.com',
}
const emails: Record<string, string> = {
  [ALICE]: 'Alice@Example.com',
  [BOB]: 'bob@example.com',
  [CAROL]: 'carol@example.com', // on the allowlist too
}
vi.mock('@/lib/env', () => ({ serverEnv: () => env }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: { email: emails[id] } } }),
      },
    },
  }),
}))
const getSessionUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ getSessionUser }))

const capture = await import('@/lib/translation/dropped-capture')
const listRoute = await import('@/app/api/debug/dropped/route')
const fileRoute = await import('@/app/api/debug/dropped/[id]/route')

/** 1 s tone, peak 0.5 -> seconds 1, peak 0.5, rms 0.354 (peak / sqrt 2). */
function wav(): Uint8Array {
  const samples = new Float32Array(16_000)
  for (let i = 0; i < samples.length; i++)
    samples[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / 16_000)
  return encodeWav(samples)
}

const args = (user: string, utteranceId: string, audio: Uint8Array = wav()) => ({
  userId: user,
  sessionId: SESSION,
  utteranceId,
  audio,
  sttClass: 'filtered_phantom',
  lang: 'bn-BD',
})

beforeEach(() => {
  env.DEBUG_CAPTURE_DROPPED = true
  env.DEBUG_CAPTURE_DIR = mkdtempSync(join(tmpdir(), 'dropped-test-'))
  env.TRANSLATION_BETA_ALLOWLIST = 'alice@example.com, carol@example.com'
  getSessionUser.mockReset()
})

describe('DEBUG_CAPTURE_DROPPED = false (the default)', () => {
  it('writes nothing, lists nothing, serves nothing', async () => {
    env.DEBUG_CAPTURE_DROPPED = false
    expect(await capture.captureDropped(args(ALICE, U1))).toBe(false)
    expect(readdirSync(env.DEBUG_CAPTURE_DIR)).toEqual([])
    expect(await capture.listDropped(ALICE)).toEqual([])
    expect(await capture.readDropped(ALICE, U1)).toBeNull()
  })

  it('both routes answer 404 before even looking at the user', async () => {
    env.DEBUG_CAPTURE_DROPPED = false
    expect((await listRoute.GET(new Request('https://x/api/debug/dropped'))).status).toBe(404)
    const res = await fileRoute.GET(new Request('https://x/api/debug/dropped/x'), {
      params: Promise.resolve({ id: U1 }),
    })
    expect(res.status).toBe(404)
    expect(getSessionUser).not.toHaveBeenCalled()
  })

  it("boot removes this feature's files and nothing else in the folder", async () => {
    await capture.captureDropped(args(ALICE, U1))
    writeFileSync(join(env.DEBUG_CAPTURE_DIR, 'notes.txt'), 'keep me')
    expect(readdirSync(env.DEBUG_CAPTURE_DIR).sort()).toEqual([
      `${ALICE}.${U1}.json`,
      `${ALICE}.${U1}.wav`,
      'notes.txt',
    ])
    env.DEBUG_CAPTURE_DROPPED = false
    await capture.startDroppedCapture()
    expect(readdirSync(env.DEBUG_CAPTURE_DIR)).toEqual(['notes.txt'])
  })
})

describe('who may use it', () => {
  it('only users named by email in TRANSLATION_BETA_ALLOWLIST (case-insensitive)', async () => {
    expect(await capture.captureAllowed(ALICE)).toBe(true) // Alice@Example.com
    expect(await capture.captureAllowed(BOB)).toBe(false)
    expect(await capture.captureDropped(args(BOB, U1))).toBe(false)
    expect(readdirSync(env.DEBUG_CAPTURE_DIR)).toEqual([])
  })

  it('"*" and an empty allowlist allow nobody', async () => {
    env.TRANSLATION_BETA_ALLOWLIST = '*'
    expect(capture.capturePeople('*')).toEqual([])
    expect(await capture.captureAllowed(ALICE)).toBe(false)
    env.TRANSLATION_BETA_ALLOWLIST = ''
    expect(await capture.captureAllowed(ALICE)).toBe(false)
  })
})

describe('keeping and serving a dropped utterance', () => {
  it('stores the WAV privately (0600) with duration, peak and rms, never the text', async () => {
    expect(await capture.captureDropped(args(ALICE, U1))).toBe(true)
    const file = join(env.DEBUG_CAPTURE_DIR, `${ALICE}.${U1}.wav`)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    const [meta] = await capture.listDropped(ALICE, SESSION)
    expect(meta).toMatchObject({
      utteranceId: U1,
      sessionId: SESSION,
      seconds: 1,
      peak: 0.5,
      rms: 0.354,
      sttClass: 'filtered_phantom',
      lang: 'bn-BD',
    })
    expect(meta!.expiresAt - meta!.createdAt).toBe(60 * 60_000)
    expect(Object.keys(meta!).sort()).toEqual([
      'createdAt',
      'expiresAt',
      'lang',
      'peak',
      'rms',
      'seconds',
      'sessionId',
      'sttClass',
      'utteranceId',
    ])
    expect(await capture.readDropped(ALICE, U1)).toEqual(wav())
  })

  it('keeps only WAV audio', async () => {
    expect(await capture.captureDropped(args(ALICE, U1, Uint8Array.from([1, 2, 3])))).toBe(false)
    expect(readdirSync(env.DEBUG_CAPTURE_DIR)).toEqual([])
  })

  it("nobody can list or read another user's audio; ids that are not UUIDs are refused", async () => {
    await capture.captureDropped(args(ALICE, U1))
    expect(await capture.listDropped(BOB)).toEqual([])
    expect(await capture.readDropped(BOB, U1)).toBeNull()
    expect(await capture.readDropped(ALICE, '../../etc/passwd')).toBeNull()
    expect(await capture.readDropped(ALICE, `${U1}.wav`)).toBeNull()
  })

  it('lists newest first and filters by session', async () => {
    await capture.captureDropped(args(ALICE, U1))
    await new Promise((r) => setTimeout(r, 5))
    await capture.captureDropped({ ...args(ALICE, U2), sessionId: BOB })
    expect((await capture.listDropped(ALICE)).map((m) => m.utteranceId)).toEqual([U2, U1])
    expect((await capture.listDropped(ALICE, SESSION)).map((m) => m.utteranceId)).toEqual([U1])
  })
})

describe('deleted after 1 hour', () => {
  it('59 minutes old stays, 61 minutes old is deleted (both files) by the next list or write', async () => {
    await capture.captureDropped(args(ALICE, U1))
    await capture.captureDropped(args(ALICE, U2))
    const ago = (name: string, minutes: number) => {
      const t = new Date(Date.now() - minutes * 60_000)
      utimesSync(join(env.DEBUG_CAPTURE_DIR, name), t, t)
    }
    for (const ext of ['wav', 'json']) {
      ago(`${ALICE}.${U1}.${ext}`, 61)
      ago(`${ALICE}.${U2}.${ext}`, 59)
    }
    expect((await capture.listDropped(ALICE)).map((m) => m.utteranceId)).toEqual([U2])
    expect(readdirSync(env.DEBUG_CAPTURE_DIR).sort()).toEqual([
      `${ALICE}.${U2}.json`,
      `${ALICE}.${U2}.wav`,
    ])
    expect(await capture.readDropped(ALICE, U1)).toBeNull()
  })

  it('sweepDropped never touches files that are not its own', async () => {
    const stranger = join(env.DEBUG_CAPTURE_DIR, 'old.txt')
    writeFileSync(stranger, 'x')
    const t = new Date(Date.now() - 5 * 3_600_000)
    utimesSync(stranger, t, t)
    expect(await capture.sweepDropped()).toBe(0)
    expect(readdirSync(env.DEBUG_CAPTURE_DIR)).toEqual(['old.txt'])
  })
})

describe("the routes serve only the signed-in user's own audio", () => {
  const list = (query = '') => listRoute.GET(new Request(`https://x/api/debug/dropped${query}`))
  const file = (id: string, query = '') =>
    fileRoute.GET(new Request(`https://x/api/debug/dropped/${id}${query}`), {
      params: Promise.resolve({ id }),
    })

  it('401 without a session', async () => {
    getSessionUser.mockResolvedValue(null)
    expect((await list()).status).toBe(401)
    expect((await file(U1)).status).toBe(401)
  })

  it('a user who is not on the allowlist gets an empty list and 404 for files', async () => {
    await capture.captureDropped(args(ALICE, U1))
    getSessionUser.mockResolvedValue({ id: BOB })
    expect(await (await list()).json()).toEqual({ allowed: false, items: [] })
    expect((await file(U1)).status).toBe(404)
  })

  it('the owner can list, play (inline) and download (attachment) the WAV', async () => {
    await capture.captureDropped(args(ALICE, U1))
    getSessionUser.mockResolvedValue({ id: ALICE })
    const body = (await (await list(`?sessionId=${SESSION}`)).json()) as {
      allowed: boolean
      items: { utteranceId: string; seconds: number }[]
    }
    expect(body.allowed).toBe(true)
    expect(body.items.map((i) => [i.utteranceId, i.seconds])).toEqual([[U1, 1]])

    const play = await file(U1)
    expect(play.status).toBe(200)
    expect(play.headers.get('content-type')).toBe('audio/wav')
    expect(play.headers.get('content-disposition')).toMatch(/^inline;/)
    expect(play.headers.get('cache-control')).toBe('private, no-store')
    expect(new Uint8Array(await play.arrayBuffer())).toEqual(wav())

    const download = await file(U1, '?download=1')
    expect(download.headers.get('content-disposition')).toMatch(
      /^attachment; filename="dropped-aaaaaaaa\.wav"/,
    )
  })

  it("another allow-listed user still cannot fetch Alice's clip", async () => {
    await capture.captureDropped(args(ALICE, U1))
    getSessionUser.mockResolvedValue({ id: CAROL })
    expect(await capture.captureAllowed(CAROL)).toBe(true)
    expect(await (await list()).json()).toEqual({ allowed: true, items: [] })
    expect((await file(U1)).status).toBe(404)
  })
})
