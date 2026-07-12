import { Badge } from 'react-bootstrap'
import { Bot, GitBranch } from 'lucide-react'
import { getAgentUiMeta } from '../../../../modules/ai-workflow/config/agent-ui.config'
import type { AiAgentPreset, AiWorkflow } from '../../types/configuracion'

type Props = {
  activeWorkflows: AiWorkflow[]
  workflowDraft: AiWorkflow | null
  agentPresets: AiAgentPreset[]
  canEditAi: boolean
  workflowStatusColor: (status?: string) => string
  selectWorkflow: (workflow: AiWorkflow) => void
  addPresetToWorkflow: (preset: AiAgentPreset) => void
}

export function WorkflowSidebar({
  activeWorkflows,
  workflowDraft,
  agentPresets,
  canEditAi,
  workflowStatusColor,
  selectWorkflow,
  addPresetToWorkflow,
}: Props) {
  return (
    <aside className="workflow-sidebar">
      <div className="workflow-panel-title"><GitBranch size={14} /> Workflows activos</div>
      <div className="workflow-list">
        {activeWorkflows.map(workflow => (
          <button
            key={workflow.id}
            type="button"
            className={`workflow-list-item ${workflowDraft?.id === workflow.id ? 'is-selected' : ''}`}
            onClick={() => selectWorkflow(workflow)}
          >
            <span className="fw-bold small">{workflow.name}</span>
            <span className="d-flex align-items-center gap-2 x-small text-muted">
              <Badge bg={workflowStatusColor(workflow.status)}>{workflow.status}</Badge>
              {workflow.is_default && <Badge bg="light" text="dark" className="border">default</Badge>}
            </span>
          </button>
        ))}
        {activeWorkflows.length === 0 && <div className="small text-muted border rounded-3 p-3">Sin workflows activos.</div>}
      </div>

      {canEditAi && (
        <>
          <div className="workflow-panel-title mt-3"><Bot size={14} /> Agregar agente</div>
          <div className="workflow-agent-library">
            {agentPresets.map(preset => {
              const meta = getAgentUiMeta(preset)
              const Icon = meta.icon

              return (
                <button key={preset.id} type="button" className="workflow-agent-card" onClick={() => addPresetToWorkflow(preset)} disabled={!workflowDraft}>
                  <span className={`workflow-agent-icon ${meta.bgClass} ${meta.textClass}`}>
                    <Icon size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="workflow-agent-name">{preset.name}</span>
                    <span className="workflow-agent-type">{preset.type}</span>
                  </span>
                </button>
              )
            })}
            {agentPresets.length === 0 && <div className="small text-muted border rounded-3 p-3">Sin presets cargados.</div>}
          </div>
        </>
      )}
    </aside>
  )
}
