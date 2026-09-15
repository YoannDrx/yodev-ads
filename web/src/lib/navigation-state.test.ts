import { describe, expect, it } from 'vitest'
import { navigationLinkActive } from './navigation-state'

describe('navigation ownership', () => {
  it.each([
    ['/dashboard', '/dashboard'], ['/insights/devices', '/insights'], ['/settings/members', '/settings'],
    ['/discussions/tasks/123', '/tasks'], ['/discussions/alerts/123', '/alerts'],
    ['/discussions/approvals/123', '/approvals'], ['/discussions/support/123', '/support'], ['/operations', '/operations'],
  ])('selects %s under %s', (pathname, href) => expect(navigationLinkActive(pathname, href)).toBe(true))
  it.each([
    ['/insights-other', '/insights'], ['/discussions/tasks-extra/123', '/tasks'],
    ['/discussions/alerts/123', '/tasks'], ['/dashboard', '/analysis'], ['/status', '/operations'],
  ])('does not select a different section for %s', (pathname, href) => expect(navigationLinkActive(pathname, href)).toBe(false))
})
