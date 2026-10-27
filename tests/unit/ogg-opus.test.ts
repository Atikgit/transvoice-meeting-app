import { describe, expect, it } from 'vitest'
import { muxOggOpus, oggCrc } from '@/lib/translation/ogg'
import { parseTranslateUpload } from '@/lib/translation/request'

const ascii = (b: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...b.subarray(at, at + n))

/** Splits an Ogg file into its pages, checking each CRC the way a decoder does. */
function readPages(file: Uint8Array) {
  const pages: {
    type: number
    granule: bigint
    sequence: number
    packets: number[]
    crcOk: boolean
  }[] = []
  let at = 0
  while (at < file.length) {
    expect(ascii(file, at, 4)).toBe('OggS')
    const view = new DataView(file.buffer, file.byteOffset + at)
    const segments = file[at + 26]!
    const lacing = [...file.subarray(at + 27, at + 27 + segments)]
    const size = 27 + segments + lacing.reduce((a, b) => a + b, 0)
    const copy = file.slice(at, at + size)
    const stored = view.getUint32(22, true)
    new DataView(copy.buffer).setUint32(22, 0, true)
    // packet sizes from lacing
    const packets: number[] = []
    let run = 0
    for (const l of lacing) {
      run += l
      if (l < 255) {
        packets.push(run)
        run = 0
      }
    }
    pages.push({
      type: file[at + 5]!,
      granule: view.getBigUint64(6, true),
      sequence: view.getUint32(18, true),
      packets,
      crcOk: oggCrc(copy) === stored,
    })
    at += size
  }
  return pages
}

describe('Ogg Opus writer', () => {
  const packets = Array.from({ length: 120 }, (_, i) => ({
    data: new Uint8Array(i === 5 ? 600 : 40).fill(i), // one packet needs multi-segment lacing
    durationUs: 20_000,
  }))
  const file = muxOggOpus(packets, 16_000)
  const pages = readPages(file)

  it('starts with OpusHead and OpusTags, then carries every packet in order', () => {
    expect(ascii(file, 28, 8)).toBe('OpusHead')
    expect(pages[0]).toMatchObject({ type: 0x02, sequence: 0, packets: [19] })
    expect(pages[1]).toMatchObject({ sequence: 1 })
    const audio = pages.slice(2)
    expect(audio.flatMap((p) => p.packets)).toEqual(packets.map((p) => p.data.length))
    expect(audio.map((p) => p.sequence)).toEqual(audio.map((_, i) => i + 2))
  })

  it('has valid CRCs, an end-of-stream page and a granule of pre-skip + 48 kHz samples', () => {
    expect(pages.every((p) => p.crcOk)).toBe(true)
    expect(pages.at(-1)!.type & 0x04).toBe(0x04)
    expect(pages.at(-1)!.granule).toBe(BigInt(312 + 120 * 960))
  })

  it('matches the standard Ogg CRC test value', () => {
    expect(oggCrc(new TextEncoder().encode('123456789'))).toBe(0x89a1897f)
  })
})

describe('POST /api/translate upload: Opus', () => {
  const form = (blob: Blob) => {
    const f = new FormData()
    f.set('audio', blob)
    f.set('sessionId', crypto.randomUUID())
    f.set('utteranceId', crypto.randomUUID())
    f.set('clientTs', '1')
    return f
  }
  const ogg = muxOggOpus([{ data: new Uint8Array(30), durationUs: 20_000 }], 16_000)

  it('accepts an Ogg Opus upload and says its format', async () => {
    const result = await parseTranslateUpload(
      form(new Blob([ogg as Uint8Array<ArrayBuffer>], { type: 'audio/ogg' })),
    )
    expect(result).toMatchObject({ format: 'opus' })
  })

  it('rejects audio/ogg that is not an Ogg file, and unknown types', async () => {
    const junk = new Uint8Array(100).fill(7)
    expect(await parseTranslateUpload(form(new Blob([junk], { type: 'audio/ogg' })))).toMatchObject(
      { status: 415 },
    )
    expect(
      await parseTranslateUpload(form(new Blob([junk], { type: 'audio/mpeg' }))),
    ).toMatchObject({ status: 415 })
  })
})
