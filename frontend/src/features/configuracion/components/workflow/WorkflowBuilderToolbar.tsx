import { Badge, Button, Dropdown, Form } from 'react-bootstrap'
import { Archive, Copy, Download, MoreHorizontal, Network, PlayCircle, RotateCcw, Save, Upload } from 'lucide-react'
import type { AiWorkflow } from '../../types/configuracion'

type Props = {
  workflowDraft: AiWorkflow | null
  workflowLoading: boolean
  canEditAi: boolean
  onOpenIaScheduler?: () => void
  autoLayoutEnabled: boolean
  workflowStatusColor: (status?: string) => string
  saveWorkflowDraft: () => void
  publishWorkflowVersion: () => void
  executeCurrentWorkflow: () => void
  switchToAutoLayoutMode: () => void
  switchToManualMode: () => void
  reorderWorkflow: () => void
  postWorkflowAction: (action: 'duplicate' | 'archive' | 'restore-default') => void
  exportWorkflow: () => void
  importWorkflow: (file?: File) => void
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
  publishWorkflowVersion,
  executeCurrentWorkflow,
  switchToAutoLayoutMode,
  switchToManualMode,
  reorderWorkflow,
  postWorkflowAction,
  exportWorkflow,
  importWorkflow,
  closeWorkflowBuilder,
}: Props) {
  return (
    <div className="workflow-engine-toolbar">
      <div>
        <h6 className="fw-bold mb-1">QA Agent Workflow Engine</h6>
        <div className="workflow-toolbar-meta">
          <span>{workflowDraft?.name || 'Sin workflow'}</span>
          <span>v{workflowDraft?.version || 1}</span>
          <Badge bg={workflowStatusColor(workflowDraft?.status)}>{workflowDraft?.status || 'DRAFT'}</Badge>
        </div>
      </div>
      <div className="workflow-main-actions">
        {canEditAi && (
          <Button size="sm" variant="light" className="workflow-action-btn" type="button" disabled={!workflowDraft || workflowLoading} onClick={saveWorkflowDraft}>
            <Save size={15} /> Guardar draft
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
          <Dropdown.Toggle size="sm" variant="light" className="workflow-more-btn">
            <MoreHorizontal size={18} />
          </Dropdown.Toggle>
          <Dropdown.Menu>
            {canEditAi && <Dropdown.Item onClick={() => postWorkflowAction('duplicate')} disabled={!workflowDraft}><Copy size={14} className="me-2" />Duplicar</Dropdown.Item>}
            {canEditAi && <Dropdown.Item onClick={() => postWorkflowAction('archive')} disabled={!workflowDraft?.id || workflowDraft?.is_default}><Archive size={14} className="me-2" />Archivar</Dropdown.Item>}
            {canEditAi && <Dropdown.Item onClick={() => postWorkflowAction('restore-default')} disabled={!workflowDraft}><RotateCcw size={14} className="me-2" />Restaurar default</Dropdown.Item>}
            {canEditAi && <Dropdown.Divider />}
            <Dropdown.Item onClick={exportWorkflow} disabled={!workflowDraft}><Download size={14} className="me-2" />Exportar JSON</Dropdown.Item>
            {canEditAi && <Dropdown.Item as="label" className="mb-0">
              <Upload size={14} className="me-2" />Importar JSON
              <Form.Control type="file" accept="application/json" className="d-none" onChange={(event) => importWorkflow((event.currentTarget as HTMLInputElement).files?.[0])} />
            </Dropdown.Item>}
          </Dropdown.Menu>
        </Dropdown>
        <button type="button" className="workflow-builder-close" aria-label="Cerrar builder" onClick={closeWorkflowBuilder}>×</button>
      </div>
    </div>
  )
}
