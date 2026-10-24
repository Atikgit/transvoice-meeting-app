import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * The real voice activity detector (Silero v5 via onnxruntime-web, AudioWorklet, assets served
 * from /vad, the app's CSP) in Chromium with a fake microphone that plays a WAV file.
 *
 *   tone-3s.wav            a synthetic tone: proves the stack starts and ignores non-speech
 *   bangla-utterance.wav   YOU provide a 3–6 s, 16 kHz mono recording of someone speaking
 *                          Bangla, with silence around it: proves speech is cut into an utterance
 */
const FIXTURES = join(process.cwd(), 'tests', 'fixtures')
const SPEECH = process.env.VAD_SPEECH_WAV ?? join(FIXTURES, 'bangla-utterance.wav')

/** A page in its own Chromium whose fake microphone loops `file` (launch args are per browser). */
async function withFakeMic(file: string, run: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${file}`,
    ],
  })
  try {
    const context = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      permissions: ['microphone'],
    })
    await run(await context.newPage())
  } finally {
    await browser.close()
  }
}

test.describe('VAD with a fake microphone', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop project only')

  test('starts with the self-hosted assets under the CSP and does not treat a tone as speech', async () => {
    await withFakeMic(join(FIXTURES, 'tone-3s.wav'), async (page) => {
      const problems: string[] = []
      page.on('console', (m: ConsoleMessage) => {
        if (/Content Security Policy|Refused to|Failed to load|404/.test(m.text()))
          problems.push(m.text())
      })
      page.on('pageerror', (e) => problems.push(e.message))
      const assets: string[] = []
      page.on('response', (r) => {
        if (r.url().includes('/vad/')) assets.push(`${r.status()} ${new URL(r.url()).pathname}`)
      })

      await page.goto('/dev/vad')
      await expect(page.getByTestId('vad-state')).toHaveText('ready', { timeout: 60_000 })
      await page.waitForTimeout(4000) // a full loop of the tone
      await expect(page.getByTestId('vad-utterances')).toHaveText('0')
      expect(problems).toEqual([])
      expect(assets.some((a) => a.includes('silero_vad_v5.onnx'))).toBe(true)
      expect(assets.some((a) => a.includes('ort-wasm-simd-threaded.wasm'))).toBe(true)
      expect(assets.every((a) => a.startsWith('200') || a.startsWith('304'))).toBe(true)
    })
  })

  test('cuts a spoken sentence into a valid 16 kHz WAV utterance', async () => {
    test.skip(
      !existsSync(SPEECH),
      'add tests/fixtures/bangla-utterance.wav (see tests/fixtures/README.md)',
    )
    await withFakeMic(SPEECH, async (page) => {
      await page.goto('/dev/vad')
      await expect(page.getByTestId('vad-state')).toHaveText('ready', { timeout: 60_000 })
      await expect(page.getByTestId('vad-utterances')).not.toHaveText('0', { timeout: 30_000 })
      const last = JSON.parse((await page.getByTestId('vad-last').textContent()) ?? 'null')
      expect(last.valid).toBe(true)
      expect(last.seconds).toBeGreaterThan(0.3)
      expect(last.seconds).toBeLessThanOrEqual(12.5)
    })
  })
})
