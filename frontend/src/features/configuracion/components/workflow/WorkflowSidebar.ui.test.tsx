// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../i18n'
import { WorkflowSidebar } from './WorkflowSidebar'
import type { AiWorkflow } from '../../types/configuracion'

afterEach(cleanup)

const active = { id: 'active', name: 'Workflow operativo', status: 'ACTIVE', version: 2, workflow_format: 'universal_v2', nodes: [], edges: [] } as AiWorkflow
const draft = { id: 'draft', name: 'Borrador Universal V3', status: 'DRAFT', version: 1, workflow_format: 'universal_v3', nodes: [], edges: [] } as AiWorkflow

describe('WorkflowSidebar', () => {
  it('mantiene seleccionable un borrador V3 junto a los workflows operativos', () => {
    const selectWorkflow = vi.fn()
    render(
      <I18nProvider>
        <WorkflowSidebar
          workflows={[active, draft]}
          workflowDraft={active}
          agentPresets={[]}
          canEditAi={false}
          workflowStatusColor={() => 'secondary'}
          selectWorkflow={selectWorkflow}
          createWorkflow={vi.fn()}
          createBlockWorkflow={vi.fn()}
          createUniversalWorkflow={vi.fn()}
          openUniversalAgentCreator={vi.fn()}
          cloneWorkflow={vi.fn()}
          onBeginPresetPlacement={vi.fn()}
        />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Workflows/i }))
    fireEvent.click(screen.getByRole('button', { name: /Borrador Universal V3/i }))
    expect(selectWorkflow).toHaveBeenCalledWith(draft)
  })
})
