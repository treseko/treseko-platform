// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../i18n'
import { WorkflowBuilderToolbar } from './WorkflowBuilderToolbar'
import type { AiWorkflow, AiWorkflowVersion } from '../../types/configuracion'
import type { WorkflowActionPermissions } from '../../workflowPermissions'

afterEach(cleanup)

const workflow = { id: 'draft', name: 'Universal V3', version: 1, status: 'DRAFT', workflow_format: 'universal_v3', nodes: [], edges: [] } as AiWorkflow
const none: WorkflowActionPermissions = { view: true, drafts: false, publish: false, activate: false, archive: false, execute: false }

function renderToolbar(permissions: WorkflowActionPermissions, canEditAi: boolean, versions: AiWorkflowVersion[] = [], activateWorkflowVersion = vi.fn()) {
  return render(
    <I18nProvider>
      <WorkflowBuilderToolbar
        workflowDraft={workflow}
        workflowLoading={false}
        canEditAi={canEditAi}
        workflowPermissions={permissions}
        onOpenIaScheduler={vi.fn()}
        autoLayoutEnabled
        workflowStatusColor={() => 'secondary'}
        saveWorkflowDraft={vi.fn()}
        validateWorkflow={vi.fn()}
        publishWorkflowVersion={vi.fn()}
        workflowVersions={versions}
        activateWorkflowVersion={activateWorkflowVersion}
        executeCurrentWorkflow={vi.fn()}
        switchToAutoLayoutMode={vi.fn()}
        switchToManualMode={vi.fn()}
        reorderWorkflow={vi.fn()}
        postWorkflowAction={vi.fn()}
        copyWorkflowAsBlocks={vi.fn()}
        copyWorkflowAsUniversal={vi.fn()}
        copyWorkflowAsUniversalV3={vi.fn()}
        exportUniversalWorkflow={vi.fn()}
        importUniversalWorkflow={vi.fn()}
        closeWorkflowBuilder={vi.fn()}
      />
    </I18nProvider>,
  )
}

describe('WorkflowBuilderToolbar RBAC', () => {
  it('muestra validación de lectura pero oculta mutaciones sin sus capabilities', () => {
    renderToolbar(none, false)
    expect(screen.getByRole('button', { name: /Validar/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Guardar borrador/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Publicar/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Ejecutar/i })).toBeNull()
  })

  it('muestra cada acción cuando existe su capability granular', () => {
    renderToolbar({ ...none, drafts: true, publish: true, execute: true }, true)
    expect(screen.getByRole('button', { name: /Guardar borrador/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Publicar/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Ejecutar/i })).toBeTruthy()
  })

  it('mantiene publicar deshabilitado cuando el workflow no está en modo editable', () => {
    renderToolbar({ ...none, publish: true }, false)
    expect(screen.getByRole('button', { name: /Publicar/i })).toBeDisabled()
  })

  it('muestra activar para la última versión cuando el workflow está en borrador', () => {
    const activate = vi.fn()
    const version = { id: 'version-1', workflow_id: 'draft', version: 1, snapshot_json: {}, changelog: 'V3' } as AiWorkflowVersion
    renderToolbar({ ...none, activate: true }, true, [version], activate)

    screen.getByRole('button', { name: /Activar v1/i }).click()
    expect(activate).toHaveBeenCalledWith(version)
  })
})
