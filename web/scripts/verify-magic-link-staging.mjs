import { chromium } from 'playwright'

const baseUrl = process.env.PLAYWRIGHT_BASE_URL
const magicLink = process.env.TEST_MAGIC_LINK

if (!baseUrl || !magicLink) {
  throw new Error('PLAYWRIGHT_BASE_URL and TEST_MAGIC_LINK are required')
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

try {
  await page.goto(magicLink, { waitUntil: 'networkidle' })
  const checks = {
    dashboard: page.url().startsWith(`${baseUrl}/dashboard`),
  }

  await page.goto(`${baseUrl}/settings/accounts`, { waitUntil: 'networkidle' })
  checks.accounts = page.url().startsWith(`${baseUrl}/settings/accounts`)

  await page.goto(`${baseUrl}/settings/billing`, { waitUntil: 'networkidle' })
  checks.billing = page.url().startsWith(`${baseUrl}/settings/billing`)

  process.stdout.write(`${JSON.stringify(checks)}\n`)
  if (Object.values(checks).some((passed) => !passed)) process.exitCode = 1
} finally {
  await browser.close()
}
