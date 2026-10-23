import { expect, test, type Page } from '@playwright/test'

/**
 * Meeting room layout at common screen sizes, on the development preview /dev/room (fake data,
 * no sign-in). The control bar and Start must be visible without scrolling.
 */

async function expectNoPageScroll(page: Page) {
  const { scrollHeight, innerHeight, scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(scrollHeight).toBeLessThanOrEqual(innerHeight)
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth)
}

async function expectRoomFitsViewport(page: Page) {
  await expect(page.getByTestId('control-bar')).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole('button', { name: 'Start' })).toBeInViewport({ ratio: 1 })
  await expect(page.getByTestId('caption-bar')).toBeInViewport({ ratio: 1 })
  await expect(page.getByTestId('room-status')).toBeVisible()
  await expectNoPageScroll(page)
}

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
]) {
  test.describe(`desktop ${viewport.width}×${viewport.height}`, () => {
    test.skip(({ isMobile }) => isMobile, 'desktop sizes run in the desktop project')
    test.use({ viewport })

    test('host room: controls and Start visible without scrolling', async ({ page }) => {
      await page.goto('/dev/room?role=host')
      await expectRoomFitsViewport(page)
      await expect(page.getByTestId('room-status')).toHaveText('Waiting for partner…')

      // Two 16:9 tiles side by side, inside the video row.
      const tiles = page.getByTestId('video-tile')
      await expect(tiles).toHaveCount(2)
      const [a, b] = [await tiles.nth(0).boundingBox(), await tiles.nth(1).boundingBox()]
      expect(a && b).toBeTruthy()
      expect(Math.abs(a!.y - b!.y)).toBeLessThan(2)
      expect(a!.width / a!.height).toBeCloseTo(16 / 9, 1)
      const controls = await page.getByTestId('control-bar').boundingBox()
      expect(a!.y + a!.height).toBeLessThan(controls!.y)
    })

    test('live host room shows the timer and End meeting', async ({ page }) => {
      await page.goto('/dev/room?role=host&state=live')
      await expect(page.getByTestId('room-status')).toHaveText(/^Live \d\d:\d\d$/)
      await expect(page.getByRole('button', { name: 'End meeting' })).toBeInViewport({ ratio: 1 })
      await expectNoPageScroll(page)
    })

    test('guest room: waiting for the host, no Start', async ({ page }) => {
      await page.goto('/dev/room?role=guest')
      await expect(page.getByText('Waiting for host to start…')).toBeInViewport({ ratio: 1 })
      await expect(page.getByRole('button', { name: 'Start' })).toHaveCount(0)
      await expectNoPageScroll(page)
    })
  })
}

test.describe('mobile (Pixel 7)', () => {
  test.skip(({ isMobile }) => !isMobile, 'runs in the mobile project')

  test('partner on stage, self picture-in-picture, captions and controls visible', async ({
    page,
  }) => {
    await page.goto('/dev/room?role=host')
    await expectRoomFitsViewport(page)

    const stage = await page.getByTestId('stage-tile').boundingBox()
    const pip = await page.getByTestId('pip-tile').boundingBox()
    expect(stage && pip).toBeTruthy()
    // PiP is small and inside the stage's bottom-right corner.
    expect(pip!.width).toBeLessThan(stage!.width / 2)
    expect(pip!.x + pip!.width).toBeLessThanOrEqual(stage!.x + stage!.width + 1)
    expect(pip!.y + pip!.height).toBeLessThanOrEqual(stage!.y + stage!.height + 1)

    // Icon-only controls keep their accessible names.
    for (const name of ['Mute microphone', 'Turn off camera', 'Invite Partner', 'Chat', 'Leave']) {
      await expect(page.getByRole('button', { name })).toBeInViewport({ ratio: 1 })
    }
  })
})

test('the room preview does not exist in production builds', async ({ request }) => {
  test.skip(process.env.E2E_PRODUCTION !== '1', 'only against `next start`')
  expect((await request.get('/dev/room')).status()).toBe(404)
})
