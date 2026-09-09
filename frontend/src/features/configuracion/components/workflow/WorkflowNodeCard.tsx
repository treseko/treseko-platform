import { memo, type CSSProperties } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { MoreHorizontal } from 'lucide-react'
import { getAgentUiMeta } from '../../../../modules/ai-workflow/config/agent-ui.config'
import { getNodeStatusUiMeta } from '../../../../modules/ai-workflow/config/node-status-ui.config'
import { useI18n } from '../../../../i18n'
import type { AiWorkflowNode } from '../../types/configuracion'
import { workflowStatusLabel } from './workflowStatusPresentation'

export const WorkflowNodeCard = memo(({ data, selected }: NodeProps) => {
  const node = (data as any).node as AiWorkflowNode
  const index = (data as any).index as number
  const runtimeStatus = (data as any).status as string | undefined
  const { t } = useI18n()
  const agentMeta = getAgentUiMeta(node)
  const statusMeta = getNodeStatusUiMeta(runtimeStatus || (node.enabled === false ? 'SKIPPED' : 'PENDING'))
  const Icon = agentMeta.icon
  const ports = node.universal_agent?.contract?.ports || {}
  const inputPorts = Array.isArray(ports.control_inputs) ? ports.control_inputs.map(String).filter(Boolean) : []
  const outputPorts = Array.isArray(ports.control_outputs) ? ports.control_outputs.map(String).filter(Boolean) : []
  const hasSemanticPorts = inputPorts.length > 0 || outputPorts.length > 0
  const portStyle = (portIndex: number, count: number): CSSProperties => ({ top: `${((portIndex + 1) / (count + 1)) * 100}%` })
  return (
    <div
      className={`workflow-node-card ${agentMeta.borderClass} ${statusMeta.borderClass} ${selected ? 'is-selected' : ''} ${node.enabled === false ? 'is-disabled' : ''}`}
      style={{ '--workflow-agent-color': agentMeta.color } as CSSProperties}
    >
      {!hasSemanticPorts && <>
        <Handle id="left" type="target" position={Position.Left} className="workflow-handle workflow-handle-in" />
        <Handle id="target-left" type="target" position={Position.Left} className="workflow-handle workflow-handle-left" />
        <Handle id="target-top" type="target" position={Position.Top} className="workflow-handle workflow-handle-top" />
        <Handle id="source-top" type="source" position={Position.Top} className="workflow-handle workflow-handle-top" />
      </>}
      <div className="workflow-node-topline">
        <span className="workflow-node-index">{index + 1}</span>
        <span className={`workflow-status-dot ${statusMeta.dotClass}`} title={`${t('configuracion.workflowStatus')}: ${workflowStatusLabel(runtimeStatus || (node.enabled === false ? 'SKIPPED' : 'PENDING'), t)}`} />
        <MoreHorizontal size={16} className="text-muted ms-auto" />
      </div>
      <div className="workflow-node-main">
        <span className={`workflow-node-icon ${agentMeta.bgClass} ${agentMeta.textClass}`}><Icon size={28} /></span>
        <div className="min-w-0">
          <div className="workflow-node-name">{node.name}</div>
          <div className="workflow-node-type">{node.type}</div>
        </div>
      </div>
      <div className="workflow-node-meta">
        <span className="workflow-node-model">{node.model_override || node.config_json?.model || `${node.timeout_sec || 60}s`}</span>
        <span className={`workflow-node-status ${node.enabled === false ? 'is-off' : 'is-on'}`}>{node.enabled === false ? t('configuracion.inactive').toUpperCase() : t('configuracion.active').toUpperCase()}</span>
      </div>
      {!hasSemanticPorts && <>
        <Handle id="target-bottom" type="target" position={Position.Bottom} className="workflow-handle workflow-handle-bottom" />
        <Handle id="source-bottom" type="source" position={Position.Bottom} className="workflow-handle workflow-handle-bottom" />
        <Handle id="source-right" type="source" position={Position.Right} className="workflow-handle workflow-handle-right" />
        <Handle id="right" type="source" position={Position.Right} className="workflow-handle workflow-handle-out" />
      </>}
      {inputPorts.map((port, portIndex) => (
        <span key={`input-${port}`} className="workflow-control-port workflow-control-port-in" style={portStyle(portIndex, inputPorts.length)}>
          <span className="workflow-control-port-label">{port}</span>
          <Handle id={port} type="target" position={Position.Left} className="workflow-handle workflow-handle-semantic" title={`${t('configuracion.workflowPropertiesControlPorts')}: ${port}`} />
        </span>
      ))}
      {outputPorts.map((port, portIndex) => (
        <span key={`output-${port}`} className="workflow-control-port workflow-control-port-out" style={portStyle(portIndex, outputPorts.length)}>
          <Handle id={port} type="source" position={Position.Right} className="workflow-handle workflow-handle-semantic" title={`${t('configuracion.workflowPropertiesOutputPort')}: ${port}`} />
          <span className="workflow-control-port-label">{port}</span>
        </span>
      ))}
    </div>
  )
})
