/**
 * Copies the voice-activity-detection assets from the pinned npm packages into public/vad/ so
 * they are served by this app (no CDN). Runs before `next build` and `next dev`.
 *   @ricky0123/vad-web: AudioWorklet bundle + Silero VAD v5 model
 *   onnxruntime-web:    WASM runtime (SIMD, threaded) and its loader
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const OUT = join(process.cwd(), 'public', 'vad')
// Both are direct dependencies, so pnpm links them at node_modules/<name>.
const pkgDir = (name: string) => join(process.cwd(), 'node_modules', name)
const vadDist = join(pkgDir('@ricky0123/vad-web'), 'dist')
const ortDist = join(pkgDir('onnxruntime-web'), 'dist')

const FILES: [string, string][] = [
  [join(vadDist, 'vad.worklet.bundle.min.js'), 'vad.worklet.bundle.min.js'],
  [join(vadDist, 'silero_vad_v5.onnx'), 'silero_vad_v5.onnx'],
  [join(ortDist, 'ort-wasm-simd-threaded.wasm'), 'ort-wasm-simd-threaded.wasm'],
  [join(ortDist, 'ort-wasm-simd-threaded.mjs'), 'ort-wasm-simd-threaded.mjs'],
]

async function version(pkg: string): Promise<string> {
  const json = JSON.parse(await readFile(join(pkgDir(pkg), 'package.json'), 'utf8'))
  return json.version as string
}

await mkdir(OUT, { recursive: true })
for (const [from, to] of FILES) await copyFile(from, join(OUT, to))
await writeFile(
  join(OUT, 'VERSIONS.json'),
  JSON.stringify(
    {
      '@ricky0123/vad-web': await version('@ricky0123/vad-web'),
      'onnxruntime-web': await version('onnxruntime-web'),
    },
    null,
    2,
  ) + '\n',
)
console.log(`✓ VAD assets → public/vad (${FILES.length} files)`)
