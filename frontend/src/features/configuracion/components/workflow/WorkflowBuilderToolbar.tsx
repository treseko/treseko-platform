import { Badge, Button, Dropdown, Form } from 'react-bootstrap'
import { Archive, Blocks, CheckCircle2, Copy, Download, MoreHorizontal, Network, PlayCircle, RotateCcw, Save, Upload } from 'lucide-react'
import type { AiWorkflow } from '../../types/configuracion'

export const WORKFLOW_PORTABLE_EXPORT_LABEL = 'Exportar workflow portable'
export const WORKFLOW_PORTABLE_IMPORT_LABEL = 'Importar workflow portable'
export const canExportPortableWorkflow = (workflow?: AiWorkflow | null) => workflow?.workflow_format === 'universal_v2'

type Props = {
  workflowDraft: AiWorkflow | null
  workflowLoading: boolean
  canEditAi: boolean
  onOpenIaScheduler?: () => void
  autoLayoutEnabled: boolean
  workflowStatusColor: (status?: string) => string
  saveWorkflowDraft: () => void
  validateWorkflow: () => void
  publishWorkflowVersion: () => void
  executeCurrentWorkflow: () => void
  switchToAutoLayoutMode: () => void
  switchToManualMode: () => void
  reorderWorkflow: () => void
  postWorkflowAction: (action: 'duplicate' | 'archive' | 'restore-default') => void
  copyWorkflowAsBlocks: () => void
  copyWorkflowAsUniversal: () => void
  exportUniversalWorkflow: () => void
  importUniversalWorkflow: (file?: File) => void
  closeWorkflowBuilder: () => void
}

export function WorkflowBuilderToolbar({
  workflowDraft,
  workflowLoading,
  canEditAi,
  onOpenIaScheduler,
  autoLayoutEnabled,
  workflowStatusColor,
  saveWorkflowDraft,
  validateWorkflow,
  publishWorkflowVersion,
  executeCurrentWorkflow,
  switchToAutoLayoutMode,
  switchToManualMode,
  reorderWorkflow,
  postWorkflowAction,
  copyWorkflowAsBlocks,
  copyWorkflowAsUniversal,
  exportUniversalWorkflow,
  importUniversalWorkflow,
  closeWorkflowBuilder,
}: Props) {
  return (
    <div className="workflow-engine-toolbar">
      <div>
        <h6 className="fw-bold mb-1">QA Agent Workflow Engine</h6>
        <div className="workflow-toolbar-meta">
          <span>{workflowDraft?.name || 'Sin workflow'}</span>
          <span>v{workflowDraft?.version || 1}</span>
          <Badge bg={workflowDraft?.workflow_format === 'universal_v2' ? 'success' : workflowDraft?.workflow_format === 'block_v2' ? 'primary' : 'secondary'}>{workflowDraft?.workflow_format === 'universal_v2' ? 'UNIVERSAL V2' : workflowDraft?.workflow_format === 'block_v2' ? 'BLOQUES V2' : 'CLASICO V1'}</Badge>
          <Badge bg={workflowStatusColor(workflowDraft?.status)}>{workflowDraft?.status || 'DRAFT'}</Badge>
        </div>
      </div>
      <div className="workflow-main-actions">
        {workflowDraft?.workflow_format === 'block_v2' && workflowDraft.source_workflow_id && (
          <span className="small text-warning-emphasis fw-semibold">Copia V2: revisa los bloques heredados antes de publicar.</span>
        )}
        {canEditAi && (
          <Button size="sm" variant="light" className="workflow-action-btn" type="button" disabled={!workflowDraft || workflowLoading} onClick={saveWorkflowDraft}>
            <Save size={15} /> Guardar draft
          </Button>
        )}
        {canEditAi && (
          <Button size="sm" variant="outline-success" className="workflow-action-btn" type="button" disabled={!workflowDraft || workflowLoading} onClick={validateWorkflow}>
            <CheckCircle2 size={15} /> Validar
          </Button>
        )}
        {canEditAi && (
          <Button size="sm" variant="primary" className="workflow-action-btn" type="button" disabled={!workflowDraft || workflowLoading} onClick={publishWorkflowVersion}>
            <Upload size={15} /> Publicar
          </Button>
        )}
        {canEditAi && (
          <Button
            size="sm"
            variant="outline-primary"
            className="workflow-action-btn"
            type="button"
            disabled={!onOpenIaScheduler || workflowLoading}
            onClick={executeCurrentWorkflow}
            title="Configurar y lanzar una ejecución IA"
          >
            <PlayCircle size={15} /> Ejecutar
          </Button>
        )}
        {canEditAi && (
          <div className="workflow-mode-toggle" role="group" aria-label="Modo de layout">
            <Button
              size="sm"
              variant={autoLayoutEnabled ? 'primary' : 'light'}
              className="workflow-action-btn"
              type="button"
              onClick={switchToAutoLayoutMode}
            >
              Auto-layout
            </Button>
            <Button
              size="sm"
              variant={!autoLayoutEnabled ? 'primary' : 'light'}
              className="workflow-action-btn"
              type="button"
              onClick={switchToManualMode}
            >
              Modo manual
            </Button>
          </div>
        )}
        <Badge bg={autoLayoutEnabled ? 'primary' : 'secondary'} className="workflow-mode-badge">
          {autoLayoutEnabled ? 'Auto-layout activo' : 'Modo manual'}
        </Badge>
        {canEditAi && (
          <Button size="sm" variant="light" className="workflow-action-btn" type="button" disabled={!workflowDraft} onClick={reorderWorkflow}>
            <Network size={14} /> Reordenar
          </Button>
        )}
        <Dropdown align="end">
          <Dropdown.Toggle size="sm" variant="light" className="workflow-more-btn" aria-label="Más acciones del workflow">
            <MoreHorizontal size={18} />
          </Dropdown.Toggle>
          <Dropdown.Menu>
            {canEditAi && <Dropdown.Item onClick={() => postWorkflowAction('duplicate')} disabled={!workflowDraft}><Copy size={14} className="me-2" />Duplicar</Dropdown.Item>}
            {canEditAi && workflowDraft?.workflow_format !== 'block_v2' && <Dropdown.Item onClick={copyWorkflowAsBlocks} disabled={!workflowDraft}><Blocks size={14} className="me-2" />Crear copia por bloques</Dropdown.Item>}
            {canEditAi && workflowDraft?.workflow_format !== 'universal_v2' && <Dropdown.Item onClick={copyWorkflowAsUniversal} disabled={!workflowDraft}><Blocks size={14} className="me-2" />Crear copia universal</Dropdown.Item>}
            {canEditAi && <Dropdown.Item onClick={() => postWorkflowAction('archive')} disabled={!workflowDraft?.id || workflowDraft?.is_default}><Archive size={14} className="me-2" />Archivar</Dropdown.Item>}
            {canEditAi && <Dropdown.Item onClick={() => postWorkflowAction('restore-default')} disabled={!workflowDraft}><RotateCcw size={14} className="me-2" />Restaurar default</Dropdown.Item>}
            {canEditAi && <Dropdown.Divider />}
            <Dropdown.Item onClick={exportUniversalWorkflow} disabled={!canExportPortableWorkflow(workflowDraft)}>
              <Download size={14} className="me-2" />{WORKFLOW_PORTABLE_EXPORT_LABEL}
            </Dropdown.Item>
            {canEditAi && <Dropdown.Item as="label" className="mb-0">
              <Upload size={14} className="me-2" />{WORKFLOW_PORTABLE_IMPORT_LABEL}
              <Form.Control
                type="file"
                accept="application/zip,.zip,.treseko-workflow.zip"
                className="d-none"
                onChange={(event) => {
                  const input = event.currentTarget as HTMLInputElement
                  importUniversalWorkflow(input.files?.[0])
                  input.value = ''
                }}
              />
            </Dropdown.Item>}
          </Dropdown.Menu>
        </Dropdown>
        <button type="button" className="workflow-builder-close" aria-label="Cerrar builder" onClick={closeWorkflowBuilder}>×</button>
      </div>
    </div>
  )
}
