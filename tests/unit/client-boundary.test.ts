import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `next build` refuses a client component that (indirectly) imports a `server-only` module, but
 * Vitest aliases `server-only` to a no-op, so unit tests never notice. This walks the imports of
 * every 'use client' file and fails with the chain, before a Docker build does.
 */
const ROOT = process.cwd()
const SOURCE_DIRS = ['app', 'components', 'features', 'lib']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/')
    ? join(ROOT, spec.slice(2))
    : spec.startsWith('.')
      ? resolve(from, '..', spec)
      : null
  if (!base) return null
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

const importsOf = (file: string) =>
  [
    ...readFileSync(file, 'utf8').matchAll(
      /^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm,
    ),
  ]
    .map((m) => m[1]!)
    // `import type` is erased at build time.
    .filter(() => true)

function typeOnly(file: string, spec: string): boolean {
  const re = new RegExp(
    `^\\s*(?:import|export)\\s+type\\s[^'"]*?from\\s+['"]${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`,
    'm',
  )
  return re.test(readFileSync(file, 'utf8'))
}

function serverOnlyChain(entry: string): string[] | null {
  const seen = new Set<string>()
  const walk = (file: string, chain: string[]): string[] | null => {
    if (seen.has(file)) return null
    seen.add(file)
    const text = readFileSync(file, 'utf8')
    // A 'use server' module is called over the network from the client, never bundled into it.
    if (/^\s*(['"])use server\1/.test(text)) return null
    if (/^\s*import\s+['"]server-only['"]/m.test(text)) return [...chain, file]
    for (const spec of importsOf(file)) {
      if (typeOnly(file, spec)) continue
      const target = resolveImport(file, spec)
      if (target) {
        const found = walk(target, [...chain, file])
        if (found) return found
      }
    }
    return null
  }
  return walk(entry, [])
}

describe('client components', () => {
  const clientFiles = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir))).filter((file) =>
    /^\s*(['"])use client\1/.test(readFileSync(file, 'utf8')),
  )

  it('found the client components', () => {
    expect(clientFiles.length).toBeGreaterThan(30)
  })

  it('never reach a server-only module through their imports', () => {
    const offenders = clientFiles
      .map((file) => ({ file, chain: serverOnlyChain(file) }))
      .filter((o) => o.chain)
      .map((o) => o.chain!.map((f) => f.replace(`${ROOT}/`, '')).join('  →  '))
    expect(offenders).toEqual([])
  })
})
