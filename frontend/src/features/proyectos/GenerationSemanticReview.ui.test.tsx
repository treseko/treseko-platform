import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { GenerationSemanticReview } from './GenerationSemanticReview'

vi.mock('../../i18n', () => ({ useI18n: () => ({
  t: (key: string, values?: { scenario?: string }) => key === 'proyectos.generationScenarioCoverage'
    ? `Assigned scenario ${values?.scenario}` : key,
}) }))
afterEach(cleanup)

it('shows assigned-scenario coverage, informational parent findings and review conflicts', () => {
  render(<GenerationSemanticReview review={{
    version: 1,
    coverage: [{ criterion_id: 'AC-1', status: 'PARTIAL', reason: 'This case covers one boundary.', step_numbers: [1] }],
    scenario_coverage: [{ scenario_id: 'SC-LOWER', status: 'COVERED', reason: 'The assigned lower-bound scenario is verified.', step_numbers: [1] }],
    findings: [
      { severity: 'WARN', scope: 'PARENT_CRITERION', criterion_id: 'AC-1', message: 'The upper boundary belongs to another case.' },
      { severity: 'WARN', scope: 'SCENARIO', criterion_id: 'AC-1', review_consistency: 'SCENARIO_COVERAGE_CONFLICT', message: 'Scenario coverage and finding disagree.' },
    ],
  }} />)

  fireEvent.click(screen.getByText('proyectos.generationSemanticReview'))
  expect(screen.getByText('Assigned scenario SC-LOWER')).toBeInTheDocument()
  expect(screen.getByText(/proyectos\.generationReviewScopePARENT_CRITERION/)).toBeInTheDocument()
  expect(screen.getByText('The upper boundary belongs to another case.')).toBeInTheDocument()
  expect(screen.getByText(/proyectos\.generationReviewConsistencyConflict/)).toBeInTheDocument()
  expect(screen.getByText('Scenario coverage and finding disagree.')).toBeInTheDocument()
})
