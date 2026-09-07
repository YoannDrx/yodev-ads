// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { ActivationOverview } from './activation-overview'
import { activationCohorts } from '@/lib/activation-analytics'

afterEach(cleanup)

it('renders empty denominators as unavailable and makes the wide table keyboard accessible', () => {
  render(<ActivationOverview totalCommercial={0} funnel={{}} cohorts={activationCohorts([], [], new Date('2026-08-12'))} />)
  expect(screen.getByRole('region', { name: 'Cohortes d’activation par semaine' })).toHaveAttribute('tabindex', '0')
  expect(screen.getAllByRole('columnheader')).toHaveLength(10)
  expect(screen.getAllByRole('progressbar')).toHaveLength(8)
  expect(screen.getAllByText('non disponible')).toHaveLength(8)
  expect(screen.queryByText('0 %', { exact: true })).not.toBeInTheDocument()
  expect(screen.getByText(/semaine courante est incomplète/)).toBeVisible()
})

it('shows intermediate stage counts over the signup cohort and qualifies median selection', () => {
  const cohorts = activationCohorts([{ id: 'a', createdAt: new Date('2026-08-03') }, { id: 'b', createdAt: new Date('2026-08-03') }], [
    { workspaceId: 'a', milestone: 'accounts_selected', occurredAt: new Date('2026-08-04') },
    { workspaceId: 'a', milestone: 'first_qualified_analysis', occurredAt: new Date('2026-08-05') },
  ], new Date('2026-08-12'))
  render(<ActivationOverview totalCommercial={2} funnel={{ accounts_selected: 1, first_qualified_analysis: 1 }} cohorts={cohorts} />)
  const row = screen.getByRole('rowheader', { name: '2026-08-03' }).closest('tr')!
  expect(within(row).getAllByText('(50 %)')).toHaveLength(2)
  expect(screen.getByText('2 j', { exact: true })).toBeVisible()
  expect(screen.getByText(/uniquement parmi les espaces des 12 semaines ayant atteint le jalon/)).toBeVisible()
  expect(screen.getByRole('progressbar', { name: 'Première analyse qualifiée' })).toHaveAttribute('value', '1')
})
