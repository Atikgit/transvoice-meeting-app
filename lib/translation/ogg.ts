/**
 * Minimal Ogg Opus writer (RFC 3533 / RFC 7845): wraps Opus packets from the browser's WebCodecs
 * AudioEncoder in a file the TransVoice API's decoder reads like any .opus file. Mono, one stream.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let r = i << 24
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1
    table[i] = r >>> 0
  }
  return table
})()

export function oggCrc(bytes: Uint8Array): number {
  let crc = 0
  for (const byte of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) & 0xff) ^ byte]!) >>> 0
  return crc
}

function page(
  packets: Uint8Array[],
  {
    serial,
    sequence,
    granule,
    type,
  }: { serial: number; sequence: number; granule: number; type: number },
): Uint8Array {
  // Lacing: each packet is a run of 255-byte segments ended by a shorter one (0 if exact).
  const lacing: number[] = []
  for (const p of packets) {
    for (let left = p.length; ; left -= 255) {
      lacing.push(Math.min(left, 255))
      if (left < 255) break
    }
  }
  const body = packets.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(27 + lacing.length + body)
  const view = new DataView(out.buffer)
  out.set([0x4f, 0x67, 0x67, 0x53, 0, type]) // "OggS", version 0, header type
  view.setBigUint64(6, BigInt(granule), true)
  view.setUint32(14, serial, true)
  view.setUint32(18, sequence, true)
  out[26] = lacing.length
  out.set(lacing, 27)
  let at = 27 + lacing.length
  for (const p of packets) {
    out.set(p, at)
    at += p.length
  }
  view.setUint32(22, oggCrc(out), true) // CRC field is zero while computing
  return out
}

/** Opus always counts granule positions in 48 kHz samples. */
const GRANULE_RATE = 48_000
const PRE_SKIP = 312
const MAX_SEGMENTS_PER_PAGE = 250

export function muxOggOpus(
  packets: { data: Uint8Array; durationUs: number }[],
  inputSampleRate: number,
  serial = 0x7a5e1e,
): Uint8Array {
  const head = new Uint8Array(19)
  head.set(new TextEncoder().encode('OpusHead'))
  head[8] = 1 // version
  head[9] = 1 // channels
  new DataView(head.buffer).setUint16(10, PRE_SKIP, true)
  new DataView(head.buffer).setUint32(12, inputSampleRate, true)
  const vendor = new TextEncoder().encode('transvoice')
  const tags = new Uint8Array(8 + 4 + vendor.length + 4)
  tags.set(new TextEncoder().encode('OpusTags'))
  new DataView(tags.buffer).setUint32(8, vendor.length, true)
  tags.set(vendor, 12)

  const pages: Uint8Array[] = [
    page([head], { serial, sequence: 0, granule: 0, type: 0x02 }),
    page([tags], { serial, sequence: 1, granule: 0, type: 0 }),
  ]
  let sequence = 2
  let granule = PRE_SKIP
  let batch: Uint8Array[] = []
  let segments = 0
  const flush = (last: boolean) => {
    pages.push(page(batch, { serial, sequence: sequence++, granule, type: last ? 0x04 : 0 }))
    batch = []
    segments = 0
  }
  packets.forEach((p, i) => {
    const need = Math.floor(p.data.length / 255) + 1
    if (batch.length > 0 && segments + need > MAX_SEGMENTS_PER_PAGE) flush(false)
    batch.push(p.data)
    segments += need
    granule += Math.round((p.durationUs * GRANULE_RATE) / 1_000_000)
    if (i === packets.length - 1) flush(true)
  })
  const total = pages.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of pages) {
    out.set(p, at)
    at += p.length
  }
  return out
}
