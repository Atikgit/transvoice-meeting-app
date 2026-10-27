import { TONE_WAV_BASE64 } from '../mocks/transvoice'
import { http, HttpResponse } from 'msw'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeWav } from '@/lib/translation/wav'
import { server } from '../mocks/server'
import { TEST_ENV } from '../mocks/env'

/**
 * One fake database (meeting_participants rows) behind ALL the routes involved: the room's
 * Languages menu (POST /api/calls/[id]/languages), what the room shows (GET /api/translate/status)
 * and what actually gets translated (POST /api/translate). Whatever order the two people change
 * languages in, the three must agree with the last server-confirmed values.
 */
const SESSION = '22222222-2222-4222-8222-222222222222'
const HOST = 'host-1'
const GUEST = 'guest-1'

type Row = {
  user_id: string
  role: 'host' | 'guest'
  spoken_lang: string
  listen_lang: string
  payer_id: string
  name: string
}
let rows: Row[] = []
let me = HOST
let connected = [HOST, GUEST]

const rpc = vi.fn(async (fn: string, args: Record<string, string | undefined>) => {
  if (fn === 'set_participant_langs') {
    const row = rows.find((r) => r.user_id === args.p_user)
    if (!row) return { data: null, error: { message: 'NOT_A_PARTICIPANT' } }
    row.spoken_lang = args.p_spoken ?? row.spoken_lang
    row.listen_lang = args.p_listen ?? row.listen_lang
    return {
      data: [
        {
          display_name: row.name,
          role: row.role,
          spoken_lang: row.spoken_lang,
          listen_lang: row.listen_lang,
        },
      ],
      error: null,
    }
  }
  if (fn === 'translation_context') {
    const speaker = rows.find((r) => r.user_id === args.p_speaker)!
    return {
      data: {
        hostId: HOST,
        hostEmail: 'host@example.com',
        speaker: {
          userId: speaker.user_id,
          spokenLang: speaker.spoken_lang,
          payerId: speaker.payer_id,
          payerHasMinutes: true,
          voiceGender: 'female',
        },
        participants: rows
          .filter((r) => r.user_id !== speaker.user_id)
          .map((r) => ({ userId: r.user_id, listenLang: r.listen_lang })),
      },
      error: null,
    }
  }
  if (fn === 'has_available_minutes') return { data: true, error: null }
  throw new Error(`unexpected rpc ${fn}`)
})
const from = (table: string) => {
  if (table === 'call_sessions') {
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { status: 'live', host_id: HOST } }) }),
      }),
    }
  }
  return {
    select: () => ({
      eq: async () => ({
        data: rows.map((r) => ({ ...r, profiles: { full_name: r.name } })),
      }),
    }),
  }
}
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc,
    from,
    auth: {
      admin: { getUserById: async () => ({ data: { user: { email: 'host@example.com' } } }) },
    },
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ getSessionUser: async () => ({ id: me }) }))
vi.mock('@/lib/livekit/connected', () => ({
  connectedIdentities: async () => new Set(connected),
}))
vi.mock('@/lib/translation/deliver', () => ({ deliverResult: async () => null }))
vi.mock('@/lib/transvoice/probe', () => ({ probeApiAuth: async () => 'ok' }))
vi.mock('livekit-server-sdk', async (original) => ({
  ...(await original<typeof import('livekit-server-sdk')>()),
  RoomServiceClient: class {
    listParticipants = async () => connected.map((identity) => ({ identity }))
    updateParticipant = async () => ({})
  },
}))

const { POST: translate } = await import('@/app/api/translate/route')
const { POST: setLanguages } = await import('@/app/api/calls/[id]/languages/route')
const { GET: status } = await import('@/app/api/translate/status/route')

let apiTargets: string[] = []
let n = 0
beforeEach(() => {
  rows = [
    {
      user_id: HOST,
      role: 'host',
      spoken_lang: 'en-US',
      listen_lang: 'en-US',
      payer_id: HOST,
      name: 'Mohammad',
    },
    {
      user_id: GUEST,
      role: 'guest',
      spoken_lang: 'en-US',
      listen_lang: 'en-US',
      payer_id: HOST,
      name: 'Atikul',
    },
  ]
  connected = [HOST, GUEST]
  apiTargets = []
  server.use(
    http.post(`${TEST_ENV.TRANSVOICE_API_URL}/`, async ({ request }) => {
      const body = (await request.json()) as { tgt_lang: string; src_lang: string }
      apiTargets.push(`${body.src_lang}>${body.tgt_lang}`)
      return HttpResponse.json({
        original_text: 'o',
        translated_text: 't',
        tts_audio: TONE_WAV_BASE64,
      })
    }),
  )
  me = HOST
})

const as = (user: string) => {
  me = user
}
const change = (user: string, body: { spokenLang?: string; listenLang?: string }) => {
  as(user)
  return setLanguages(
    new NextRequest(`https://x/api/calls/${SESSION}/languages`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: SESSION }) },
  )
}
const getStatus = async (user: string) => {
  as(user)
  const res = await status(new NextRequest(`https://x/api/translate/status?sessionId=${SESSION}`))
  return res.json() as Promise<{
    me: { spokenLang: string; listenLang: string }
    fanout: { reason: string; targets: { lang: string }[] }
    incoming: { translated: boolean }[]
    swapped: boolean
    decision: { allowed: boolean }
  }>
}
const speak = async (user: string) => {
  as(user)
  // A fresh user id per call: the per-user rate limiter is process-wide.
  const form = new FormData()
  form.set(
    'audio',
    new Blob([encodeWav(new Float32Array(16_000).fill(0.3))], { type: 'audio/wav' }),
    'u.wav',
  )
  form.set('sessionId', SESSION)
  form.set('utteranceId', '33333333-3333-4333-8333-33333333333' + (n++ % 10))
  form.set('clientTs', '1761300000000')
  apiTargets = []
  const res = await translate(
    new NextRequest('https://x/api/translate', { method: 'POST', body: form }),
  )
  return {
    body: (await res.json()) as { reason?: string; languages: { lang: string }[] },
    targets: [...apiTargets],
  }
}

/** The hint ("same language") must be exactly what the server did with the next sentence. */
async function expectAgreement(user: string) {
  const s = await getStatus(user)
  const spoke = await speak(user)
  expect(s.fanout.reason).toBe(spoke.body.reason ?? 'ok')
  expect(s.fanout.targets.map((t) => t.lang).sort()).toEqual(
    spoke.body.languages.map((l) => l.lang).sort(),
  )
  expect(spoke.targets.length).toBe(s.fanout.targets.length) // API called once per target, nothing else
  return s
}

describe('the session row is the one truth: menu, status line and translation agree', () => {
  it('both on the same language: nothing is translated and both say so', async () => {
    for (const user of [HOST, GUEST]) {
      const s = await expectAgreement(user)
      expect(s.fanout.reason).toBe('same_language')
    }
  })

  it('the corrected setup (each hears their own language) translates both ways', async () => {
    await change(HOST, { spokenLang: 'bn-BD', listenLang: 'bn-BD' })
    await change(GUEST, { spokenLang: 'en-US', listenLang: 'en-US' })
    const host = await expectAgreement(HOST)
    expect(host.fanout.targets.map((t) => t.lang)).toEqual(['en-US'])
    const guest = await expectAgreement(GUEST)
    expect(guest.fanout.targets.map((t) => t.lang)).toEqual(['bn-BD'])
    expect(host.incoming[0]!.translated).toBe(true)
    expect(guest.incoming[0]!.translated).toBe(true)
  })

  it('the swapped setup from the field report: nothing to translate, the status line says it looks swapped', async () => {
    // host: speak bn / hear en; guest: speak en / hear bn
    await change(HOST, { spokenLang: 'bn-BD', listenLang: 'en-US' })
    await change(GUEST, { spokenLang: 'en-US', listenLang: 'bn-BD' })
    for (const user of [HOST, GUEST]) {
      const s = await expectAgreement(user)
      expect(s.fanout.reason).toBe('same_language')
      expect(s.swapped).toBe(true)
    }
  })

  it.each([
    ['host first', [HOST, GUEST]],
    ['guest first', [GUEST, HOST]],
  ])(
    'changes in any order (%s) end up identical for status and translation',
    async (_name, order) => {
      const settings = {
        [HOST]: { spokenLang: 'bn-BD', listenLang: 'bn-BD' },
        [GUEST]: { spokenLang: 'es-ES', listenLang: 'es-ES' },
      } as const
      for (const user of order) {
        await change(user, settings[user as typeof HOST])
        await expectAgreement(HOST)
        await expectAgreement(GUEST)
      }
      expect((await getStatus(HOST)).fanout.targets.map((t) => t.lang)).toEqual(['es-ES'])
      expect((await getStatus(GUEST)).fanout.targets.map((t) => t.lang)).toEqual(['bn-BD'])
    },
  )

  it('the last change wins: switching back and forth never leaves a stale target', async () => {
    await change(HOST, { spokenLang: 'bn-BD' })
    await change(GUEST, { listenLang: 'en-US' })
    await change(GUEST, { listenLang: 'bn_BD' }) // spelled differently: the same language as the host speaks
    await expectAgreement(HOST)
    expect((await getStatus(HOST)).fanout.reason).toBe('same_language')
    await change(GUEST, { listenLang: 'es-ES' })
    const s = await expectAgreement(HOST)
    expect(s.fanout.targets.map((t) => t.lang)).toEqual(['es-ES'])
  })

  it('after a reconnect or page reload the values are the stored ones, not the profile', async () => {
    await change(HOST, { spokenLang: 'bn-BD', listenLang: 'bn-BD' })
    await change(GUEST, { spokenLang: 'en-US', listenLang: 'en-US' })
    // "Reload": a brand new status request (the page rebuilds its state from it).
    expect((await getStatus(HOST)).me).toEqual({ spokenLang: 'bn-BD', listenLang: 'bn-BD' })
    expect((await getStatus(GUEST)).me).toEqual({ spokenLang: 'en-US', listenLang: 'en-US' })
    connected = [HOST] // the guest's tab dropped...
    expect((await expectAgreement(HOST)).fanout.reason).toBe('no_listeners')
    connected = [HOST, GUEST] // ...and came back
    expect((await expectAgreement(HOST)).fanout.targets.map((t) => t.lang)).toEqual(['en-US'])
  })

  it('the menu answer is the stored value, so the client shows what the server confirmed', async () => {
    const res = await change(GUEST, { listenLang: 'fr-FR' })
    expect(await res.json()).toMatchObject({ spokenLang: 'en-US', listenLang: 'fr-FR' })
    expect((await getStatus(GUEST)).me.listenLang).toBe('fr-FR')
  })

  it('the status endpoint exposes display names and languages only: no ids, emails or payers', async () => {
    as(HOST)
    const res = await status(new NextRequest(`https://x/api/translate/status?sessionId=${SESSION}`))
    const text = JSON.stringify(await res.json())
    expect(text).toContain('Atikul')
    for (const secret of [HOST, GUEST, 'host@example.com', 'payer'])
      expect(text).not.toContain(secret)
  })

  it('a stranger gets nothing from the status endpoint', async () => {
    as('stranger')
    const res = await status(new NextRequest(`https://x/api/translate/status?sessionId=${SESSION}`))
    expect(res.status).toBe(403)
  })
})
