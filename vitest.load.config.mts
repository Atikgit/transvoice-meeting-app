import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** `pnpm load:translate`: load test of the translation fan-out against a local TransVoice mock. */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      'server-only': fileURLToPath(new URL('./tests/mocks/server-only.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/load/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/load/setup.ts'], // no msw: the mock is a real HTTP server
    testTimeout: 300_000,
  },
})
