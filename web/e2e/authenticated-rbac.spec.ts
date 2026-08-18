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

async function authenticatedContext(browser: Browser, role: Role) {
  const storageState = storageStateFor(role)
  const requireMatrix = process.env.PLAYWRIGHT_REQUIRE_AUTH_MATRIX === '1'
  if (requireMatrix) expect(storageState, `${role} storage state is required`).toBeTruthy()
  test.skip(!storageState, `PLAYWRIGHT_${role.toUpperCase()}_STORAGE_STATE is not configured`)
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'
  return browser.newContext({ storageState, baseURL })
}

async function authenticatedPage(browser: Browser, role: Role) {
  const context = await authenticatedContext(browser, role)
  return { context, page: await context.newPage() }
}

const replayableActionHeaders = new Set([
  'accept',
  'content-type',
  'next-action',
  'next-router-state-tree',
  'next-url',
  'origin',
  'x-deployment-id',
])

function actionReplayHeaders(headers: Record<string, string>) {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => replayableActionHeaders.has(name)))
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

test.describe.serial('authenticated Server Action authorization matrix', () => {
  test('re-authorizes workspace administration for every session', async ({ browser }) => {
    const { context: ownerContext, page } = await authenticatedPage(browser, 'owner')
    let actionUrl: string
    let actionBody: Buffer
    let actionHeaders: Record<string, string>
    try {
      await page.goto('/settings')
      const locale = page.getByRole('combobox', { name: /Workspace language|Langue de l’espace/ })
      const currentLocale = await locale.inputValue()
      await locale.selectOption(currentLocale)
      const actionRequestPromise = page.waitForRequest((request) => (
        request.method() === 'POST' && Boolean(request.headers()['next-action'])
      ))
      const [actionRequest] = await Promise.all([
        actionRequestPromise,
        page.getByRole('button', { name: /Apply language|Appliquer la langue/ }).click(),
      ])
      await expect(page).toHaveURL(/\/settings\?notice=/)
      const body = actionRequest.postDataBuffer()
      expect(body, 'The captured Server Action must have a replayable request body').toBeTruthy()
      actionUrl = actionRequest.url()
      actionBody = body!
      actionHeaders = actionReplayHeaders(actionRequest.headers())
      expect(actionHeaders['next-action']).toBeTruthy()
      expect(actionHeaders.cookie, 'The owner cookie must never be copied into a role replay').toBeUndefined()
    } finally {
      await ownerContext.close()
    }

    for (const roleCase of roleCases) {
      const context = await authenticatedContext(browser, roleCase.role)
      try {
        const response = await context.request.fetch(actionUrl, {
          method: 'POST',
          headers: actionHeaders,
          data: actionBody,
          maxRedirects: 0,
          failOnStatusCode: false,
        })
        expect(response.status(), `${roleCase.role} Server Action response`).toBe(200)
        const redirectHeader = response.headers()['x-action-redirect']
        expect(redirectHeader, `${roleCase.role} Server Action redirect`).toBeTruthy()
        const redirectTarget = new URL(redirectHeader!.split(';')[0], actionUrl)
        expect(redirectTarget.pathname).toBe('/settings')
        if (roleCase.role === 'owner' || roleCase.role === 'admin') {
          expect(redirectTarget.searchParams.get('notice'), `${roleCase.role} should be authorized`).toBeTruthy()
          expect(redirectTarget.searchParams.get('error')).toBeNull()
        } else {
          expect(redirectTarget.searchParams.get('notice')).toBeNull()
          expect(redirectTarget.searchParams.get('error'), `${roleCase.role} should be denied`)
            .toContain('Permission required: workspace:admin')
        }
      } finally {
        await context.close()
      }
    }
  })
})
