import { chromium } from 'playwright'

const baseUrl = process.env.PLAYWRIGHT_BASE_URL
const email = process.env.TEST_AUTH_EMAIL
const password = process.env.TEST_AUTH_PASSWORD

if (!baseUrl || !email || !password) {
  throw new Error('PLAYWRIGHT_BASE_URL, TEST_AUTH_EMAIL and TEST_AUTH_PASSWORD are required')
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

try {
  const checks = {}

  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'networkidle' })
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await Promise.all([
    page.waitForURL(/\/(dashboard|onboarding)(?:\?|$)/, { timeout: 30_000 }),
    page.getByRole('button', { name: /Se connecter|Sign in/i }).click(),
  ])
  checks.login = /\/(dashboard|onboarding)/.test(new URL(page.url()).pathname)

  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' })
  checks.dashboard = page.url().includes('/dashboard')

  await page.goto(`${baseUrl}/accounts`, { waitUntil: 'networkidle' })
  checks.accounts = page.url().includes('/accounts')

  await page.goto(`${baseUrl}/billing`, { waitUntil: 'networkidle' })
  checks.billing = page.url().includes('/billing')

  process.stdout.write(`${JSON.stringify(checks)}\n`)
  if (Object.values(checks).some((passed) => !passed)) process.exitCode = 1
} finally {
  await browser.close()
}
