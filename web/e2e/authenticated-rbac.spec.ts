import { expect, test, type Browser } from '@playwright/test'

type Role = 'owner' | 'admin' | 'strategist' | 'analyst' | 'client'

const roleCases: Array<{
  role: Role
  allowed: string[]
  denied: string[]
}> = [
  { role: 'owner', allowed: ['/dashboard', '/settings', '/billing', '/support'], denied: [] },
  { role: 'admin', allowed: ['/dashboard', '/settings', '/support'], denied: ['/billing'] },
  { role: 'strategist', allowed: ['/dashboard', '/tasks', '/support'], denied: ['/settings', '/billing'] },
  { role: 'analyst', allowed: ['/dashboard', '/reports', '/support'], denied: ['/settings', '/billing'] },
  { role: 'client', allowed: ['/support'], denied: ['/dashboard', '/settings', '/billing'] },
]

function storageStateFor(role: Role) {
  return process.env[`PLAYWRIGHT_${role.toUpperCase()}_STORAGE_STATE`]
}

async function authenticatedPage(browser: Browser, role: Role) {
  const storageState = storageStateFor(role)
  const requireMatrix = process.env.PLAYWRIGHT_REQUIRE_AUTH_MATRIX === '1'
  if (requireMatrix) expect(storageState, `${role} storage state is required`).toBeTruthy()
  test.skip(!storageState, `PLAYWRIGHT_${role.toUpperCase()}_STORAGE_STATE is not configured`)
  const context = await browser.newContext({ storageState })
  return { context, page: await context.newPage() }
}

test.describe('authenticated five-role route matrix', () => {
  for (const roleCase of roleCases) {
    test(`${roleCase.role} has only its server-authorized product surface`, async ({ browser }) => {
      const { context, page } = await authenticatedPage(browser, roleCase.role)
      try {
        for (const pathname of roleCase.allowed) {
          await page.goto(pathname)
          await expect(page).toHaveURL(new RegExp(`${pathname.replace('/', '\\/')}(?:\\?|$)`))
          await expect(page.locator('main')).toBeVisible()
        }
        for (const pathname of roleCase.denied) {
          await page.goto(pathname)
          await expect(page).toHaveURL(/\/support\?error=/)
          await expect(page.locator('main')).toBeVisible()
        }
      } finally {
        await context.close()
      }
    })
  }
})
