/**
 * Synthetic speech-to-text self-test: separates the Speech API from real-world conditions.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/stt-selftest.ts \
 *     [--env .env.production] [--work <dir>] [--out docs/stt-selftest.md] [--voices both|first]
 *
 * For English and Bangla it makes 10 sentences (0.5 s to ~6 s) with /v1/tts in both voices of the
 * language, converts them to 16 kHz mono 16-bit WAV with ffmpeg, and sends every clip through
 * /v1/stt (lang `en` / `bn`, the codes the app uses) in four variants:
 *   a  clean
 *   b  300 ms of silence added on both sides
 *   c  white noise mixed in at -35 dBFS RMS
 *   d  the first 150 ms cut off (clipped onset)
 * and counts how often the answer is empty / one character / a phantom phrase the app drops
 * (the same classifyStt() the server uses). Needs TRANSVOICE_API_URL and
 * TRANSVOICE_MASTER_API_KEY (read from the env file; never printed) and ffmpeg. It spends a few
 * minutes of API credit: 2 languages x 10 sentences x 2 voices x (1 tts + 4 stt).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { classifyStt, type SttClass } from '../lib/translation/split/hallucination.ts'

export const VARIANTS = ['a_clean', 'b_padded', 'c_noise', 'd_clipped'] as const
export type Variant = (typeof VARIANTS)[number]
export const VARIANT_LABEL: Record<Variant, string> = {
  a_clean: 'a clean',
  b_padded: 'b +300 ms silence both sides',
  c_noise: 'c white noise -35 dBFS rms',
  d_clipped: 'd first 150 ms cut',
}

export interface Language {
  name: 'English' | 'Bangla'
  stt: 'en' | 'bn'
  voices: string[]
  sentences: string[]
}

export const LANGUAGES: Language[] = [
  {
    name: 'English',
    stt: 'en',
    voices: ['en-US-AvaNeural', 'en-US-AndrewNeural'],
    sentences: [
      'Hello.',
      'Thank you.',
      'Can you hear me?',
      'Okay, I understand.',
      "Let's start the meeting now.",
      'Yes, I can hear you very well.',
      'Can you share your screen, please?',
      'Please send me the report by tomorrow afternoon.',
      'I think we should move the deadline to next Friday, because the team needs more time.',
      'The weather is lovely today, so after the call I am going to walk to the market.',
    ],
  },
  {
    name: 'Bangla',
    stt: 'bn',
    voices: ['bn-BD-NabanitaNeural', 'bn-BD-PradeepNeural'],
    sentences: [
      'হ্যালো।',
      'ধন্যবাদ।',
      'আপনি কি আমার কথা শুনতে পাচ্ছেন?',
      'ঠিক আছে, আমি বুঝতে পেরেছি।',
      'চলুন, এখন মিটিং শুরু করি।',
      'হ্যাঁ, আমি আপনার কথা ভালো করে শুনতে পাচ্ছি।',
      'আপনি কি দয়া করে আপনার স্ক্রিন শেয়ার করতে পারবেন?',
      'দয়া করে কাল দুপুরের মধ্যে রিপোর্টটি আমাকে পাঠিয়ে দিন।',
      'আমার মনে হয় আমাদের সময়সীমা আগামী শুক্রবার পর্যন্ত বাড়ানো উচিত, কারণ দলের আরও সময় দরকার।',
      'আজ আবহাওয়া খুব সুন্দর, তাই কলের পর আমি বাজারে হেঁটে যাব।',
    ],
  },
]

/** ffmpeg arguments (after `-i clean.wav`) that make each variant from the clean WAV. */
export function variantArgs(variant: Variant): { pre: string[]; filter?: string; noise?: boolean } {
  switch (variant) {
    case 'a_clean':
      return { pre: [] }
    case 'b_padded':
      return { pre: [], filter: 'adelay=300:all=1,apad=pad_dur=0.3' }
    case 'c_noise':
      // anoisesrc white noise is uniform: rms = amplitude / sqrt(3); -35 dBFS rms -> amplitude 0.0308
      return { pre: [], noise: true }
    case 'd_clipped':
      return { pre: ['-ss', '0.15'] }
  }
}

export interface Row {
  language: string
  voice: string
  sentence: number
  variant: Variant
  seconds: number
  cls: SttClass | 'error'
  text: string
  ms: number
}

/** Share of rows (0..1) whose class is not 'text', i.e. the app would drop them. */
export function dropRate(rows: Row[]): number {
  return rows.length === 0 ? 0 : rows.filter((r) => r.cls !== 'text').length / rows.length
}

export function renderReport(rows: Row[], meta: { date: string; voices: string }): string {
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`
  const out: string[] = []
  out.push('# STT self-test (synthetic speech)', '')
  out.push(
    `Run ${meta.date}. Speech API /v1/stt, lang en / bn, 16 kHz mono WAV, voices: ${meta.voices}. ` +
      'Clips were made with /v1/tts. "Dropped" = the answer the app would throw away as silence ' +
      '(empty, one character, or a phantom phrase: you / thank you / i / am i).',
    '',
  )
  out.push(
    '| Language | Variant | Clips | Dropped | Rate | empty | single_char | filtered_phantom | error | p50 ms | max ms |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  )
  for (const lang of LANGUAGES) {
    for (const variant of VARIANTS) {
      const r = rows.filter((x) => x.language === lang.name && x.variant === variant)
      if (r.length === 0) continue
      const n = (c: Row['cls']) => r.filter((x) => x.cls === c).length
      const ms = r.map((x) => x.ms).sort((a, b) => a - b)
      out.push(
        `| ${lang.name} | ${VARIANT_LABEL[variant]} | ${r.length} | ${r.filter((x) => x.cls !== 'text').length} | ${pct(dropRate(r))} | ${n('empty')} | ${n('single_char')} | ${n('filtered_phantom')} | ${n('error')} | ${ms[Math.floor(ms.length / 2)]} | ${ms[ms.length - 1]} |`,
      )
    }
  }
  const failures = rows.filter((r) => r.cls !== 'text')
  out.push('', '## Dropped clips: what the API returned', '')
  if (failures.length === 0) out.push('None.')
  else {
    out.push(
      '| Language | Variant | Voice | Sentence | Seconds | Class | Returned |',
      '|---|---|---|---|---|---|---|',
    )
    for (const f of failures)
      out.push(
        `| ${f.language} | ${f.variant} | ${f.voice} | ${f.sentence + 1} | ${f.seconds.toFixed(2)} | ${f.cls} | ${JSON.stringify(f.text)} |`,
      )
  }
  const slow = rows.filter((r) => r.ms > 4000)
  out.push(
    '',
    `STT calls slower than the app's 4000 ms step limit: ${slow.length} of ${rows.length}.`,
    '',
  )
  return out.join('\n')
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback
}

const ffmpeg = (args: string[]) =>
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' })

/** Duration in seconds of a 16 kHz mono 16-bit WAV (44-byte header). */
const wavSeconds = (bytes: Buffer) => Math.max(0, bytes.length - 44) / 2 / 16000

async function main() {
  process.loadEnvFile(arg('env', '.env.production'))
  const base = (process.env.TRANSVOICE_API_URL ?? '').replace(/\/+$/, '')
  const key = process.env.TRANSVOICE_MASTER_API_KEY ?? ''
  if (!base || !key) throw new Error('TRANSVOICE_API_URL / TRANSVOICE_MASTER_API_KEY missing')
  const work = arg('work', join(tmpdir(), 'stt-selftest'))
  mkdirSync(work, { recursive: true })
  const bothVoices = arg('voices', 'both') === 'both'
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
  const rows: Row[] = []

  for (const lang of LANGUAGES) {
    const voices = bothVoices ? lang.voices : lang.voices.slice(0, 1)
    for (const voice of voices) {
      for (const [index, text] of lang.sentences.entries()) {
        const stem = join(work, `${lang.stt}-${voice}-${index}`)
        const tts = await fetch(`${base}/v1/tts`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text, voice }),
          signal: AbortSignal.timeout(30_000),
        })
        const mp3 = Buffer.from(await tts.arrayBuffer())
        if (!tts.ok || mp3.length < 1000) {
          console.error(
            `tts failed: ${voice} #${index + 1} status ${tts.status} bytes ${mp3.length}`,
          )
          continue
        }
        writeFileSync(`${stem}.mp3`, mp3)
        ffmpeg([
          '-i',
          `${stem}.mp3`,
          '-ar',
          '16000',
          '-ac',
          '1',
          '-c:a',
          'pcm_s16le',
          `${stem}.clean.wav`,
        ])
        for (const variant of VARIANTS) {
          const v = variantArgs(variant)
          const file = `${stem}.${variant}.wav`
          const input = ['-i', `${stem}.clean.wav`]
          if (variant === 'a_clean') ffmpeg([...input, '-c:a', 'pcm_s16le', file])
          else if (v.noise)
            ffmpeg([
              ...input,
              '-f',
              'lavfi',
              '-i',
              'anoisesrc=color=white:amplitude=0.0308:sample_rate=16000',
              '-filter_complex',
              '[0:a][1:a]amix=inputs=2:duration=first:normalize=0',
              '-ar',
              '16000',
              '-ac',
              '1',
              '-c:a',
              'pcm_s16le',
              file,
            ])
          else if (v.filter)
            ffmpeg([
              ...input,
              '-af',
              v.filter,
              '-ar',
              '16000',
              '-ac',
              '1',
              '-c:a',
              'pcm_s16le',
              file,
            ])
          else ffmpeg([...v.pre, ...input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', file])
          const wav = readFileSync(file)
          const started = performance.now()
          let cls: Row['cls'] = 'error'
          let returned = ''
          try {
            const res = await fetch(`${base}/v1/stt`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ audio: wav.toString('base64'), ext: 'wav', lang: lang.stt }),
              signal: AbortSignal.timeout(30_000),
            })
            if (res.ok) {
              const body = (await res.json()) as { text?: string }
              returned = typeof body.text === 'string' ? body.text : ''
              cls = classifyStt(returned)
            } else returned = `HTTP ${res.status}`
          } catch (error) {
            returned = error instanceof Error ? error.message : 'error'
          }
          rows.push({
            language: lang.name,
            voice,
            sentence: index,
            variant,
            seconds: wavSeconds(wav),
            cls,
            text: returned,
            ms: Math.round(performance.now() - started),
          })
        }
        process.stderr.write('.')
      }
    }
  }
  process.stderr.write('\n')
  const report = renderReport(rows, {
    date: new Date().toISOString().slice(0, 10),
    voices: LANGUAGES.map((l) => (bothVoices ? l.voices : l.voices.slice(0, 1)).join(' + ')).join(
      '; ',
    ),
  })
  writeFileSync(arg('out', 'docs/stt-selftest.md'), report)
  writeFileSync(join(work, 'rows.json'), JSON.stringify(rows))
  console.log(report)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
