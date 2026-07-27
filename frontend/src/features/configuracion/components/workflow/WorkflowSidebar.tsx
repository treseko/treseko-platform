import { Badge, Button, Dropdown, Form } from 'react-bootstrap'
import { Bot, ChevronDown, ChevronRight, Copy, GitBranch, Plus, Search } from 'lucide-react'
import { useState, type PointerEvent } from 'react'
import { getAgentUiMeta } from '../../../../modules/ai-workflow/config/agent-ui.config'
import type { AiAgentPreset, AiWorkflow } from '../../types/configuracion'

type Props = {
  activeWorkflows: AiWorkflow[]
  workflowDraft: AiWorkflow | null
  agentPresets: AiAgentPreset[]
  canEditAi: boolean
  workflowStatusColor: (status?: string) => string
  selectWorkflow: (workflow: AiWorkflow) => void
  createWorkflow: () => void
  createBlockWorkflow: () => void
  createUniversalWorkflow: () => void
  openUniversalAgentCreator: () => void
  cloneWorkflow: () => void
  onBeginPresetPlacement: (preset: AiAgentPreset, event: PointerEvent<HTMLButtonElement>) => void
}

export function WorkflowSidebar({
  activeWorkflows,
  workflowDraft,
  agentPresets,
  canEditAi,
  workflowStatusColor,
  selectWorkflow,
  createWorkflow,
  createBlockWorkflow,
  createUniversalWorkflow,
  openUniversalAgentCreator,
  cloneWorkflow,
  onBeginPresetPlacement,
}: Props) {
  const [query, setQuery] = useState('')
  const [workflowsExpanded, setWorkflowsExpanded] = useState(false)
  const normalizedQuery = query.trim().toLowerCase()
  const visibleWorkflows = activeWorkflows.filter(workflow => `${workflow.name} ${workflow.status} v${workflow.version}`.toLowerCase().includes(normalizedQuery))
  const displayedWorkflows = normalizedQuery || workflowsExpanded
    ? visibleWorkflows
    : workflowDraft ? [workflowDraft] : visibleWorkflows.slice(0, 1)
  const visibleAgentPresets = agentPresets.filter(preset => {
    const isBlock = String(preset.key || '').startsWith('BLOCK_')
    return workflowDraft?.workflow_format === 'block_v2'
      ? isBlock
      : workflowDraft?.workflow_format === 'universal_v2'
        ? Boolean(preset.universal_agent_version_id)
        : !isBlock && !preset.universal_agent_version_id
  })
  return (
    <aside className="workflow-sidebar">
      <div className="workflow-panel-title d-flex align-items-center justify-content-between gap-1">
        <button
          type="button"
          className="btn btn-link p-0 border-0 text-decoration-none text-reset d-flex align-items-center gap-1 fw-semibold"
          onClick={() => setWorkflowsExpanded(value => !value)}
          aria-expanded={workflowsExpanded}
          title={workflowsExpanded ? 'Contraer workflows' : 'Mostrar workflows'}
        >
          {workflowsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <GitBranch size={14} /> Workflows <Badge bg="light" text="dark" className="border">{activeWorkflows.length}</Badge>
        </button>
        {canEditAi && (
          <span className="d-flex gap-1">
            <Dropdown>
              <Dropdown.Toggle size="sm" variant="outline-primary" title="Crear workflow"><Plus size={14} /></Dropdown.Toggle>
              <Dropdown.Menu align="end">
                <Dropdown.Item onClick={createWorkflow}>Workflow clásico</Dropdown.Item>
                <Dropdown.Item onClick={createBlockWorkflow} disabled={!workflowDraft}>Workflow por bloques</Dropdown.Item>
                <Dropdown.Item onClick={createUniversalWorkflow} disabled={!workflowDraft}>Workflow universal portable</Dropdown.Item>
                <Dropdown.Item onClick={openUniversalAgentCreator}>Crear agente universal</Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
            <Button size="sm" variant="outline-secondary" title="Clonar workflow seleccionado" aria-label="Clonar workflow seleccionado" disabled={!workflowDraft} onClick={cloneWorkflow}><Copy size={14} /></Button>
          </span>
        )}
      </div>
      <Form.Group className="px-2 pb-2">
        <Form.Label visuallyHidden htmlFor="workflow-filter">Buscar workflow</Form.Label>
        <div className="position-relative">
          <Search size={13} className="position-absolute text-muted" style={{ left: 9, top: 10 }} />
          <Form.Control id="workflow-filter" size="sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar workflow..." style={{ paddingLeft: 29 }} />
        </div>
      </Form.Group>
      <div className="workflow-list">
        {displayedWorkflows.map(workflow => (
          <button
            key={workflow.id}
            type="button"
            className={`workflow-list-item ${workflowDraft?.id === workflow.id ? 'is-selected' : ''}`}
            onClick={() => selectWorkflow(workflow)}
          >
            <span className="fw-bold small">{workflow.name}</span>
              <span className="d-flex align-items-center gap-2 x-small text-muted">
              <Badge bg={workflowStatusColor(workflow.status)}>{workflow.status}</Badge>
              <span>v{workflow.version}</span>
              <Badge bg={workflow.workflow_format === 'universal_v2' ? 'success' : workflow.workflow_format === 'block_v2' ? 'primary' : 'secondary'}>{workflow.workflow_format === 'universal_v2' ? 'UNIVERSAL' : workflow.workflow_format === 'block_v2' ? 'V2' : 'V1'}</Badge>
              {workflow.is_default && <Badge bg="light" text="dark" className="border">default</Badge>}
            </span>
          </button>
        ))}
        {activeWorkflows.length === 0 && <div className="small text-muted border rounded-3 p-3">Sin workflows disponibles.</div>}
        {activeWorkflows.length > 0 && visibleWorkflows.length === 0 && <div className="small text-muted border rounded-3 p-3">No hay coincidencias.</div>}
      </div>
      {!normalizedQuery && !workflowsExpanded && activeWorkflows.length > 1 && <div className="px-2 pb-2 x-small text-muted">Clic en Workflows para desplegar la lista.</div>}
      {normalizedQuery && <div className="px-2 pb-2 x-small text-muted">{visibleWorkflows.length} resultado(s) encontrados.</div>}

      {canEditAi && (
        <>
          <div className="workflow-panel-title mt-3"><Bot size={14} /> Agregar agente</div>
          <div className="workflow-agent-library">
            {visibleAgentPresets.map(preset => {
              const meta = getAgentUiMeta(preset)
              const Icon = meta.icon

              return (
                <button
                  key={preset.id}
                  type="button"
                  className="workflow-agent-card"
                  disabled={!workflowDraft || workflowDraft.status === 'ACTIVE'}
                  title={workflowDraft?.status === 'ACTIVE' ? 'Duplica el workflow activo para editarlo.' : `Arrastra ${preset.name} al diagrama para insertarlo.`}
                  onPointerDown={(event) => onBeginPresetPlacement(preset, event)}
                >
                  <span className={`workflow-agent-icon ${meta.bgClass} ${meta.textClass}`}>
                    <Icon size={18} />
                  </span>
                  <span className="min-w-0">
                  <span className="workflow-agent-name">{preset.name}</span>
                    <span className="workflow-agent-type">{preset.status || preset.type}</span>
                  </span>
                </button>
              )
            })}
            {visibleAgentPresets.length === 0 && <div className="small text-muted border rounded-3 p-3">Sin bloques compatibles para este formato.</div>}
          </div>
          <div className="workflow-pending-agent">Mantené presionado un agente, arrastralo al diagrama y soltalo donde querés insertarlo.</div>
        </>
      )}
    </aside>
  )
}
