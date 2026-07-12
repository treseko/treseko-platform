import { Badge, Button } from 'react-bootstrap'
import { Network } from 'lucide-react'
import type { AiWorkflow } from '../../types/configuracion'

type Props = {
  workflowDraft: AiWorkflow | null
  workflowLoadError: string
  agentPresetsError: string
  workflowStatusColor: (status?: string) => string
  formatWorkflowDate: (value?: string) => string
  canEditAi: boolean
  onOpenWorkflowBuilder: () => void
}

export function WorkflowSummaryCard({
  workflowDraft,
  workflowLoadError,
  agentPresetsError,
  workflowStatusColor,
  formatWorkflowDate,
  canEditAi,
  onOpenWorkflowBuilder,
}: Props) {
  return (
    <div className="workflow-summary-card border-top pt-3 mt-3">
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-3">
        <div>
          <h6 className="fw-bold mb-1">Flujo de agentes del motor</h6>
          <div className="small text-muted">Workflow activo que define el orden y comportamiento de los agentes IA.</div>
        </div>
        <Button
          size="sm"
          variant="primary"
          className="fw-bold"
          type="button"
          disabled={!workflowDraft}
          onClick={onOpenWorkflowBuilder}
        >
          <Network size={15} className="me-1" /> {canEditAi ? 'Editar Workflow' : 'Ver Workflow'}
        </Button>
      </div>
      <div className="workflow-summary-grid mt-3">
        <div>
          <span className="workflow-summary-label">Workflow</span>
          <strong>{workflowDraft?.name || 'Sin workflow cargado'}</strong>
        </div>
        <div>
          <span className="workflow-summary-label">Version</span>
          <strong>v{workflowDraft?.version || 1}</strong>
        </div>
        <div>
          <span className="workflow-summary-label">Estado</span>
          <Badge bg={workflowStatusColor(workflowDraft?.status)}>{workflowDraft?.status || 'DRAFT'}</Badge>
        </div>
        <div>
          <span className="workflow-summary-label">Nodos</span>
          <strong>{workflowDraft?.nodes.length || 0}</strong>
        </div>
        <div>
          <span className="workflow-summary-label">Edges</span>
          <strong>{workflowDraft?.edges.length || 0}</strong>
        </div>
        <div>
          <span className="workflow-summary-label">Actualizado</span>
          <strong>{formatWorkflowDate(workflowDraft?.updated_at || workflowDraft?.created_at)}</strong>
        </div>
      </div>
      {(workflowLoadError || agentPresetsError) && (
        <div className="workflow-load-warnings mt-3">
          {workflowLoadError && (
            <div className="workflow-load-warning">
              <span className="fw-bold">Workflows IA:</span> {workflowLoadError}
            </div>
          )}
          {agentPresetsError && (
            <div className="workflow-load-warning">
              <span className="fw-bold">Presets IA:</span> {agentPresetsError}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
