// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
vi.mock('@/app/actions', () => ({ reviewWorkspaceAlertQuality: vi.fn() }))
import { AlertQualityPanel, AlertQualitySummary } from './alert-quality-panel'

afterEach(cleanup)
const incident = { id: 'fixture', qualityLabel: 'useful', qualityVersion: 4, qualityOccurrence: 2, qualityReviewedAt: new Date('2026-09-01'), occurrenceCount: 3 }

it('marks a review stale and retains observation/version tokens for the explicit next review', () => {
  const { container } = render(<AlertQualityPanel incident={incident} canManage english />)
  expect(screen.getByRole('region', { name: 'Alert quality review' })).toHaveAttribute('data-alert-quality-state', 'stale')
  expect(screen.getByText(/observation 2.*new observation needs review/)).toBeVisible()
  expect(screen.getByRole('combobox', { name: 'Your assessment' })).toHaveValue('useful')
  expect(container.querySelector('input[name="expectedOccurrence"]')).toHaveValue('3')
  expect(container.querySelector('input[name="expectedVersion"]')).toHaveValue('4')
})

it('keeps the quality readable without a management control', () => {
  render(<AlertQualityPanel incident={incident} canManage={false} english={false} />)
  expect(screen.getByText('Pertinence : Utile')).toBeVisible()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('excludes unreviewed and older observations from the useful rate', () => {
  const view = render(<AlertQualitySummary counts={{ useful: 1, noise: 1, falsePositive: 0, staleReviews: 20, unreviewed: 50 }} total={72} english />)
  expect(screen.getByText(/Useful among 2 reviews of the current observation: 50 %/)).toBeVisible()
  view.rerender(<AlertQualitySummary counts={{ useful: 0, noise: 0, falsePositive: 0, staleReviews: 20, unreviewed: 50 }} total={70} english />)
  expect(screen.getByText(/Useful among 0 reviews of the current observation: —/)).toBeVisible()
})
