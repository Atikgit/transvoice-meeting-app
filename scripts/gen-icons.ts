/**
 * Generates the app icons from public/brand/logo-source.png (dev only; outputs are committed).
 *
 *   pnpm icons
 *
 * Use a square source of at least 512×512 for sharp results; smaller sources are upscaled.
 */
import { writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const SOURCE = 'public/brand/logo-source.png'
const BACKGROUND = '#0b0e16'

const PNG_OUTPUTS: { file: string; size: number }[] = [
  { file: 'app/icon.png', size: 32 },
  { file: 'app/apple-icon.png', size: 180 },
  { file: 'public/brand/logo-192.png', size: 192 },
  { file: 'public/brand/logo-512.png', size: 512 },
]
const ICO_SIZES = [16, 32, 48]

function resized(size: number): Promise<Buffer> {
  return (
    sharp(SOURCE)
      .resize(size, size, { fit: 'contain', background: BACKGROUND, kernel: 'lanczos3' })
      // Apple touch icons must be opaque; flattening keeps every output consistent.
      .flatten({ background: BACKGROUND })
      // …but ICO decoders require RGBA PNGs, so add back an (opaque) alpha channel.
      .ensureAlpha()
      .png({ compressionLevel: 9 })
      .toBuffer()
  )
}

/** ICO container with embedded PNG images (supported by every current browser). */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)

  let offset = header.length + images.length * 16
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1) // height
    entry.writeUInt8(0, 2) // palette colours
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    return entry
  })
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)])
}

async function main() {
  const { width, height } = await sharp(SOURCE).metadata()
  if (width !== height) console.warn(`! ${SOURCE} is ${width}×${height}; it will be letterboxed.`)
  if (Math.min(width ?? 0, height ?? 0) < 512) {
    console.warn(`! ${SOURCE} is ${width}×${height}; provide 512×512 or larger for crisp icons.`)
  }

  for (const { file, size } of PNG_OUTPUTS) {
    await writeFile(file, await resized(size))
    console.log(`✓ ${file} (${size}×${size})`)
  }

  const images = await Promise.all(
    ICO_SIZES.map(async (size) => ({ size, png: await resized(size) })),
  )
  await writeFile('app/favicon.ico', ico(images))
  console.log(`✓ app/favicon.ico (${ICO_SIZES.join(', ')})`)
}

await main()
