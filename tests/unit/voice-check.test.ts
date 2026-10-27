import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../mocks/server'
import { TEST_ENV } from '../mocks/env'
import { checkLocaleVoices, checkVoice, staticVoiceReport } from '@/lib/translation/voice-check'
import { languageOptions } from '@/lib/transvoice/languages'
import { findVoice } from '@/lib/transvoice/voices'

describe('voice mapping', () => {
  it('has a male and a female voice matching the locale for every listed language', () => {
    const report = staticVoiceReport()
    expect(report.problems).toEqual([])
    expect(report.languages).toBe(languageOptions.length)
  })

  it('maps both Bangla locales, both genders', () => {
    expect(findVoice('bn-BD', 'male')).toBe('bn-BD-PradeepNeural')
    expect(findVoice('bn-BD', 'female')).toBe('bn-BD-NabanitaNeural')
    expect(findVoice('bn-IN', 'male')).toBe('bn-IN-BashkarNeural')
    expect(findVoice('bn-IN', 'female')).toBe('bn-IN-TanishaaNeural')
  })
})

describe('live voice check (/v1/tts)', () => {
  const tts = `${TEST_ENV.TRANSVOICE_API_URL}/v1/tts`

  it('asks one voice at a time and judges the answer by status and size', async () => {
    const asked: string[] = []
    server.use(
      http.post(tts, async ({ request }) => {
        const { voice } = (await request.json()) as { voice: string }
        asked.push(voice)
        return voice.startsWith('bn-BD-Pradeep')
          ? new HttpResponse(new Uint8Array(40), { status: 200 }) // empty answer
          : new HttpResponse(new Uint8Array(6000), { status: 200 })
      }),
    )
    const results = await checkLocaleVoices('bn-BD')
    expect(asked).toEqual(['bn-BD-PradeepNeural', 'bn-BD-NabanitaNeural'])
    expect(results.map((r) => [r.voice, r.ok])).toEqual([
      ['bn-BD-PradeepNeural', false],
      ['bn-BD-NabanitaNeural', true],
    ])
  })

  it('reports a rejected or unreachable API as not ok', async () => {
    server.use(http.post(tts, () => HttpResponse.json({ error: 'x' }, { status: 400 })))
    expect(await checkVoice('bn-BD-NabanitaNeural', 'female')).toMatchObject({
      ok: false,
      status: 400,
    })
    server.use(http.post(tts, () => HttpResponse.error()))
    expect(await checkVoice('bn-BD-NabanitaNeural', 'female')).toMatchObject({
      ok: false,
      status: null,
    })
  })
})
