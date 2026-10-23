import { defineConfig, devices } from '@playwright/test'
import { TEST_ENV } from './tests/mocks/env'

const PORT = Number(process.env.E2E_PORT ?? 3100)

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    permissions: ['camera', 'microphone'],
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // Loopback only: never expose the dev server on a public interface.
    command: `pnpm dev --hostname 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Fake credentials (tests/mocks/env.ts) unless the environment provides real ones.
    env: Object.fromEntries(
      Object.entries(TEST_ENV).map(([key, value]) => [key, process.env[key] ?? value]),
    ),
  },
})
