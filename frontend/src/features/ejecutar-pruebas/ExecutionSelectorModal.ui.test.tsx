// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { ExecutionSelectorModal } from './ExecutionSelectorModal'

afterEach(cleanup)

const candidates = [
  { id: 'api-1', code: 'TC-API-001', title: 'Health check', format: 'API' },
  { id: 'api-2', code: 'TC-API-002', title: 'Create item', format: 'API' },
  { id: 'classic-1', code: 'TC-001', title: 'Open catalog', format: 'CLASICA' },
]

function SelectionHarness() {
  const [selectedIds, setSelectedIds] = useState(candidates.map(test => test.id))
  const selectedTests = candidates.filter(test => selectedIds.includes(test.id))

  return (
    <I18nProvider>
      <ExecutionSelectorModal
        show
        onHide={vi.fn()}
        executionModalTests={selectedTests}
        executionModalCandidateTests={candidates}
        executionModalDiscardedCount={0}
        executionLoading={false}
        environments={[]}
        selectedEnvironmentId=""
        setSelectedEnvironmentId={vi.fn()}
        selectedDatasetId=""
        setSelectedDatasetId={vi.fn()}
        datasetPreview={null}
        datasetPreviewLoading={false}
        getExecutionCaseLabel={test => test.code}
        isOutdatedExecutionCase={() => false}
        removeExecutionModalCase={id => setSelectedIds(previous => previous.filter(testId => testId !== id))}
        restoreExecutionModalCases={ids => setSelectedIds(previous => Array.from(new Set([...previous, ...ids])))}
        onShowDatasetHelp={vi.fn()}
        onStart={vi.fn()}
        canStartManualExecution
        canUseAutomatedExecution
        canUseIaExecution
        onScheduleIa={vi.fn()}
      />
    </I18nProvider>
  )
}

describe('ExecutionSelectorModal', () => {
  it('keeps deselected format cases visible and allows selecting the format again', async () => {
    render(<SelectionHarness />)

    const apiCheckbox = await screen.findByRole('checkbox', { name: /API/ })
    expect(apiCheckbox).toBeChecked()
    expect(screen.getByText('TC-API-001')).toBeTruthy()

    fireEvent.click(apiCheckbox)

    expect(apiCheckbox).not.toBeChecked()
    expect(screen.getByText('TC-API-001')).toBeTruthy()
    expect(screen.getAllByText('No se ejecutará')).toHaveLength(2)
    expect(screen.getByText('Casos para ejecutar: 1 de 3')).toBeTruthy()

    fireEvent.click(apiCheckbox)

    expect(apiCheckbox).toBeChecked()
    expect(screen.queryByText('No se ejecutará')).toBeNull()
    expect(screen.getByText('Casos para ejecutar: 3 de 3')).toBeTruthy()
  })
})
