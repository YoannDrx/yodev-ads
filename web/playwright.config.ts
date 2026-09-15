import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Disposable fixtures use a development server; compilation is not a
  // production performance measurement. Remote release checks keep defaults.
  ...(process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1' ? { timeout: 120_000, expect: { timeout: 15_000 } } : {}),
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3017',
    trace: 'on-first-retry',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'BETTER_AUTH_SECRET=playwright-only-secret-at-least-32-characters npm run dev -- --port 3017',
        url: 'http://localhost:3017',
        reuseExistingServer: !process.env.CI,
      },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
