import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk'

/**
 * Two browsers (host + guest) with fake camera/mic in one real LiveKit room.
 *
 * Needs a LiveKit server reachable from the test machine (a local `livekit-server --dev` or a
 * test project in LiveKit Cloud — never production):
 *   E2E_LIVEKIT_URL=ws://127.0.0.1:7880 E2E_LIVEKIT_API_KEY=devkey E2E_LIVEKIT_API_SECRET=secret
 * Skipped otherwise. The app's own token/start endpoints are intercepted in the browser: the
 * test mints real tokens and sets real room metadata, so media and RoomMetadataChanged go
 * through LiveKit. Authorization of the real token route is covered by unit + DB tests.
 */
const LK_URL = process.env.E2E_LIVEKIT_URL
const LK_KEY = process.env.E2E_LIVEKIT_API_KEY
const LK_SECRET = process.env.E2E_LIVEKIT_API_SECRET
const HOST_ID = '00000000-0000-4000-8000-00000000000a'
const GUEST_ID = '00000000-0000-4000-8000-00000000000b'

test.describe('two-party LiveKit call', () => {
  test.skip(!LK_URL || !LK_KEY || !LK_SECRET, 'set E2E_LIVEKIT_URL / _API_KEY / _API_SECRET')
  test.skip(({ isMobile }) => isMobile, 'desktop project only')

  const session = randomUUID()
  const room = `tv-${session}`
  const api = () => new RoomServiceClient(LK_URL!.replace(/^ws/, 'http'), LK_KEY!, LK_SECRET!)

  async function token(identity: string, name: string, role: 'host' | 'guest') {
    const at = new AccessToken(LK_KEY!, LK_SECRET!, {
      identity,
      name,
      metadata: JSON.stringify({ name, spokenLang: 'en-US', listenLang: 'bn-BD', role }),
      ttl: '10m',
    })
    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    })
    return at.toJwt()
  }

  async function open(page: Page, role: 'host' | 'guest') {
    const identity = role === 'host' ? HOST_ID : GUEST_ID
    const name = role === 'host' ? 'Host Person' : 'Guest Person'
    const jwt = await token(identity, name, role)
    await page.route('**/api/livekit/token**', (route) =>
      route.fulfill({ json: { token: jwt, url: LK_URL, room, role, status: 'ready' } }),
    )
    await page.route(`**/api/calls/${session}/start`, async (route) => {
      const state = { status: 'live', startedAt: new Date().toISOString(), hostId: HOST_ID }
      await api().updateRoomMetadata(room, JSON.stringify(state))
      await route.fulfill({ json: { ...state, published: true } })
    })
    await page.goto(
      `/dev/meeting?role=${role}&session=${session}&user=${identity}&name=${encodeURIComponent(name)}`,
    )
  }

  async function remoteVideoPlaying(page: Page) {
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              [...document.querySelectorAll('[data-testid="video-tile"] video')].filter(
                (v) =>
                  !(v as HTMLVideoElement).style.transform.includes('scaleX(-1)') &&
                  (v as HTMLVideoElement).readyState >= 2 &&
                  (v as HTMLVideoElement).videoWidth > 0,
              ).length,
          ),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0)
  }

  test('host Start → both live and each sees the other’s video', async ({ browser }) => {
    await api().createRoom({
      name: room,
      emptyTimeout: 120,
      metadata: JSON.stringify({ status: 'ready', startedAt: null, hostId: HOST_ID }),
    })
    const options = { permissions: ['camera', 'microphone'] }
    const hostCtx = await browser.newContext(options)
    const guestCtx = await browser.newContext(options)
    const host = await hostCtx.newPage()
    const guest = await guestCtx.newPage()
    await open(host, 'host')
    await open(guest, 'guest')

    await expect(guest.getByText('Waiting for host to start…')).toBeVisible({ timeout: 30_000 })
    await expect(host.getByText('Guest Person', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(guest.getByText('Host Person', { exact: true })).toBeVisible({ timeout: 30_000 })

    await host.getByRole('button', { name: 'Start' }).click()
    for (const page of [host, guest]) {
      await expect(page.getByTestId('room-status')).toHaveText(/^Live \d\d:\d\d$/, {
        timeout: 15_000,
      })
    }
    await expect(guest.getByText('Waiting for host to start…')).toHaveCount(0)
    await remoteVideoPlaying(host)
    await remoteVideoPlaying(guest)

    await hostCtx.close()
    await guestCtx.close()
    await api()
      .deleteRoom(room)
      .catch(() => {})
  })
})

test('the token route refuses requests without a signed-in user', async ({ request }) => {
  const res = await request.get(`/api/livekit/token?sessionId=${randomUUID()}`)
  expect(res.status()).toBe(401)
  expect(await res.json()).not.toHaveProperty('token')
})

test('webhooks without a valid LiveKit signature are rejected', async ({ request }) => {
  const res = await request.post('/api/livekit/webhook', {
    data: { id: 'EV_1', event: 'participant_joined', room: { name: `tv-${randomUUID()}` } },
    headers: { authorization: 'forged' },
  })
  expect(res.status()).toBe(401)
})
