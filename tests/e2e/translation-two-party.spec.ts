import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { AccessToken, DataPacket_Kind, RoomServiceClient } from 'livekit-server-sdk'
import { captionMessage, encodeMessage, TOPICS } from '../../lib/translation/messages'
import { encodeWav } from '../../lib/translation/wav'

/**
 * Live translation across three real browsers in one real LiveKit room:
 *
 *   speaker (host, speaks Bangla, fake microphone plays a recorded sentence)
 *   listener "en"  hears English      → must receive a caption + a TTS URL and START playing it
 *   listener "bn"  hears Bangla too   → must receive nothing (same language)
 *
 * Needs a LiveKit server reachable from the test machine (a local `livekit-server --dev` or a
 * separate test project, never production):
 *   E2E_LIVEKIT_URL=ws://127.0.0.1:7880 E2E_LIVEKIT_API_KEY=devkey E2E_LIVEKIT_API_SECRET=secret
 * and a speech recording (tests/fixtures/README.md): tests/fixtures/bangla-utterance.wav or
 * VAD_SPEECH_WAV=/path/to/any-speech.wav.
 *
 * The app's server routes are replaced in the browsers by a stand-in that does what
 * /api/translate does with the mocked TransVoice answer — delivery goes through the real
 * LiveKit server (RoomServiceClient.sendData with destinationIdentities, the same topics and
 * message shapes as lib/translation) — so this test covers the CLIENT pipeline: VAD → WAV upload
 * → data messages → caption bar → playback queue. The server side (grouping, fan-out, auth,
 * beta gate, cache) is covered by the unit tests against the msw TransVoice mock.
 */
const LK_URL = process.env.E2E_LIVEKIT_URL
const LK_KEY = process.env.E2E_LIVEKIT_API_KEY
const LK_SECRET = process.env.E2E_LIVEKIT_API_SECRET
const SPEECH =
  process.env.VAD_SPEECH_WAV ?? join(process.cwd(), 'tests', 'fixtures', 'bangla-utterance.wav')

const ids = {
  host: '00000000-0000-4000-8000-0000000000a1',
  en: '00000000-0000-4000-8000-0000000000b2',
  bn: '00000000-0000-4000-8000-0000000000c3',
}
const ORIGINAL = 'হ্যালো, আপনি কেমন আছেন?'
const TRANSLATED = 'Hello, how are you?'

test.describe('three-browser translation', () => {
  test.skip(!LK_URL || !LK_KEY || !LK_SECRET, 'set E2E_LIVEKIT_URL / _API_KEY / _API_SECRET')
  test.skip(
    !existsSync(SPEECH),
    'add tests/fixtures/bangla-utterance.wav (see tests/fixtures/README.md)',
  )
  test.skip(({ isMobile }) => isMobile, 'desktop project only')
  test.setTimeout(120_000)

  const session = randomUUID()
  const room = `tv-${session}`
  const lk = () => new RoomServiceClient(LK_URL!.replace(/^ws/, 'http'), LK_KEY!, LK_SECRET!)
  const ttsWav = Buffer.from(encodeWav(new Float32Array(4800).fill(0.1))) // 0.3 s

  async function token(identity: string, name: string) {
    const at = new AccessToken(LK_KEY!, LK_SECRET!, { identity, name, ttl: '10m' })
    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    })
    return at.toJwt()
  }

  async function browserFor(micFile?: string): Promise<Browser> {
    return chromium.launch({
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required', // headless: no click to unlock audio
        ...(micFile ? [`--use-file-for-fake-audio-capture=${micFile}`] : []),
      ],
    })
  }

  async function joinRoom(
    browser: Browser,
    who: 'host' | 'en' | 'bn',
    options: { spoken: string; listen: string; role: 'host' | 'guest'; mic: boolean },
  ): Promise<Page> {
    const context = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      permissions: ['camera', 'microphone'],
    })
    const page = await context.newPage()
    const name = who === 'host' ? 'Speaker' : who === 'en' ? 'English Listener' : 'Bangla Listener'
    const jwt = await token(ids[who], name)
    await page.route('**/api/livekit/token**', (route) =>
      route.fulfill({
        json: { token: jwt, url: LK_URL, room, role: options.role, status: 'ready' },
      }),
    )
    await page.route(`**/api/calls/${session}/start`, async (route) => {
      const state = { status: 'live', startedAt: new Date().toISOString(), hostId: ids.host }
      await lk().updateRoomMetadata(room, JSON.stringify(state))
      await route.fulfill({ json: { ...state, published: true } })
    })
    const query = new URLSearchParams({
      role: options.role,
      session,
      user: ids[who],
      name,
      spoken: options.spoken,
      listen: options.listen,
      ...(options.mic ? {} : { mic: 'off' }),
    })
    await page.goto(`/dev/meeting?${query}`)
    return page
  }

  test('English listener gets caption + audio and playback starts; same-language listener gets nothing', async () => {
    await lk().createRoom({
      name: room,
      emptyTimeout: 120,
      metadata: JSON.stringify({ status: 'ready', startedAt: null, hostId: ids.host }),
    })
    const browsers = [await browserFor(SPEECH), await browserFor(), await browserFor()]
    try {
      const speaker = await joinRoom(browsers[0]!, 'host', {
        spoken: 'bn-BD',
        listen: 'bn-BD',
        role: 'host',
        mic: true,
      })
      const english = await joinRoom(browsers[1]!, 'en', {
        spoken: 'en-US',
        listen: 'en-US',
        role: 'guest',
        mic: false,
      })
      const bangla = await joinRoom(browsers[2]!, 'bn', {
        spoken: 'bn-BD',
        listen: 'bn-BD',
        role: 'guest',
        mic: false,
      })

      // Stand-in for GET /api/tts/<id>: clips are only fetched by the page that was addressed.
      const clipsFetched = { en: 0, bn: 0 }
      for (const [key, page] of [
        ['en', english],
        ['bn', bangla],
      ] as const) {
        await page.route('**/api/tts/*', async (route) => {
          clipsFetched[key] += 1
          await route.fulfill({
            body: ttsWav,
            contentType: 'audio/wav',
            headers: { 'Cache-Control': 'no-store' },
          })
        })
      }
      // Stand-in for POST /api/translate on every page: translate for the English listener only.
      const uploads: { page: string; bytes: number }[] = []
      for (const [key, page] of [
        ['speaker', speaker],
        ['en', english],
        ['bn', bangla],
      ] as const) {
        await page.route('**/api/translate', async (route) => {
          const request = route.request()
          const body = request.postDataBuffer()
          uploads.push({ page: key, bytes: body?.length ?? 0 })
          expect(await request.headerValue('content-type')).toContain('multipart/form-data')
          if (key !== 'speaker') return route.fulfill({ status: 200, json: { languages: [] } })

          const utteranceId = /name="utteranceId"\r\n\r\n([0-9a-f-]{36})/.exec(
            body!.toString('latin1'),
          )![1]!
          const clientTs = Number(/name="clientTs"\r\n\r\n(\d+)/.exec(body!.toString('latin1'))![1])
          const audioId = randomBytes(18).toString('base64url')
          const send = (data: object, topic: string) =>
            lk().sendData(room, encodeMessage(data), DataPacket_Kind.RELIABLE, {
              destinationIdentities: [ids.en], // the Bangla listener shares the speaker's language
              topic,
            })
          const base = { utteranceId, speakerId: ids.host, lang: 'en-US', speechEndedAt: clientTs }
          await send(
            captionMessage({ ...base, original: ORIGINAL, translated: TRANSLATED }),
            TOPICS.caption,
          )
          await send({ ...base, url: `/api/tts/${audioId}` }, TOPICS.audio)
          await route.fulfill({
            json: {
              utteranceId,
              original: ORIGINAL,
              silence: false,
              languages: [{ lang: 'en-US', result: 'speech' }],
            },
          })
        })
      }

      // Everyone is connected: the host presses Start.
      for (const page of [speaker, english, bangla]) {
        await expect(page.getByTestId('video-tile').first()).toBeVisible({ timeout: 30_000 })
      }
      await expect(speaker.getByRole('button', { name: 'Start' })).toBeVisible({ timeout: 30_000 })
      await speaker.getByRole('button', { name: 'Start' }).click()
      for (const page of [speaker, english, bangla]) {
        await expect(page.getByTestId('room-status')).toHaveText(/^Live \d\d:\d\d$/, {
          timeout: 15_000,
        })
      }

      // The fake microphone "speaks": the VAD cuts the sentence and the upload happens.
      await expect
        .poll(() => uploads.filter((u) => u.page === 'speaker').length, { timeout: 60_000 })
        .toBeGreaterThan(0)
      expect(uploads.filter((u) => u.page === 'speaker')[0]!.bytes).toBeLessThan(2 * 1024 * 1024)

      // English listener: caption in the caption bar, then the clip is fetched and starts playing.
      await expect(english.getByTestId('caption-bar')).toContainText(TRANSLATED, {
        timeout: 30_000,
      })
      await expect.poll(() => clipsFetched.en, { timeout: 30_000 }).toBeGreaterThan(0)
      await expect(english.getByTestId('latency-badge')).toContainText(/audio \d+ ms/, {
        timeout: 30_000,
      })

      // The speaker sees their own original transcript.
      await expect(speaker.getByTestId('caption-bar')).toContainText(ORIGINAL, { timeout: 30_000 })

      // Same-language listener: nothing arrived — no caption, no clip, no latency sample.
      await bangla.waitForTimeout(3000)
      expect(clipsFetched.bn).toBe(0)
      await expect(bangla.getByTestId('caption-bar')).not.toContainText(TRANSLATED)
      await expect(bangla.getByTestId('latency-badge')).toHaveCount(0)
      expect(uploads.filter((u) => u.page !== 'speaker')).toEqual([]) // listeners muted: no uploads
    } finally {
      for (const browser of browsers) await browser.close()
      await lk()
        .deleteRoom(room)
        .catch(() => {})
    }
  })
})
