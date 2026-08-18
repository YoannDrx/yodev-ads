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

function foreignExportId() {
  return process.env.PLAYWRIGHT_FOREIGN_EXPORT_ID
}

async function authenticatedPage(browser: Browser, role: Role) {
  const storageState = storageStateFor(role)
  const requireMatrix = process.env.PLAYWRIGHT_REQUIRE_AUTH_MATRIX === '1'
  if (requireMatrix) expect(storageState, `${role} storage state is required`).toBeTruthy()
  test.skip(!storageState, `PLAYWRIGHT_${role.toUpperCase()}_STORAGE_STATE is not configured`)
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'
  const context = await browser.newContext({ storageState, baseURL })
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

  for (const roleCase of roleCases) {
    test(`${roleCase.role} cannot cross the direct export API boundary`, async ({ browser }) => {
      const { context } = await authenticatedPage(browser, roleCase.role)
      try {
        const exportId = foreignExportId()
        const requireMatrix = process.env.PLAYWRIGHT_REQUIRE_AUTH_MATRIX === '1'
        if (requireMatrix) expect(exportId, 'PLAYWRIGHT_FOREIGN_EXPORT_ID is required').toBeTruthy()
        test.skip(!exportId, 'PLAYWRIGHT_FOREIGN_EXPORT_ID is not configured')
        const response = await context.request.get(`/api/exports/${exportId}`)
        expect(response.status()).toBe(roleCase.role === 'owner' ? 404 : 403)
        expect(await response.json()).toEqual({ error: roleCase.role === 'owner' ? 'Export unavailable' : 'Forbidden' })
      } finally {
        await context.close()
      }
    })
  }
})
