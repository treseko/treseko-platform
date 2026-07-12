import { defaultAgentWorkflow } from '../mappers/configuracionMappers'

type UseAgentWorkflowConfigParams = {
  aiEngineConfig: any
  setAiEngineConfig: (config: any) => void
  promptAgentIndex: number | null
}

function createCustomAgent(nextNumber: number) {
  return {
    id: `CUSTOM_${nextNumber}`,
    name: `Agente custom ${nextNumber}`,
    enabled: true,
    locked: false,
    action: 'custom_review',
    retry_limit: 0,
    prompt: 'Describe aqui el rol, criterio de decision y salida esperada de este agente.',
  }
}

export function useAgentWorkflowConfig({
  aiEngineConfig,
  setAiEngineConfig,
  promptAgentIndex,
}: UseAgentWorkflowConfigParams) {
  const agentWorkflow = Array.isArray(aiEngineConfig.agent_workflow) && aiEngineConfig.agent_workflow.length > 0
    ? aiEngineConfig.agent_workflow
    : defaultAgentWorkflow

  const setAgentWorkflow = (nextWorkflow: any[]) => {
    setAiEngineConfig({ ...aiEngineConfig, agent_workflow: nextWorkflow })
  }

  const updateAgentWorkflowItem = (index: number, patch: Record<string, any>) => {
    setAgentWorkflow(agentWorkflow.map((agent: any, idx: number) => idx === index ? { ...agent, ...patch } : agent))
  }

  const moveAgentWorkflowItem = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= agentWorkflow.length) return
    if (agentWorkflow[index]?.locked || agentWorkflow[target]?.locked) return
    const copy = [...agentWorkflow]
    const [item] = copy.splice(index, 1)
    copy.splice(target, 0, item)
    setAgentWorkflow(copy)
  }

  const restoreAgentPrompt = (index: number) => {
    const agent = agentWorkflow[index]
    const preset = defaultAgentWorkflow.find(item => item.id === agent.id)
    updateAgentWorkflowItem(index, { prompt: preset?.prompt || '', enabled: agent.enabled !== false })
  }

  const addCustomAgent = () => {
    const nextNumber = agentWorkflow.filter((agent: any) => String(agent.id).startsWith('CUSTOM_')).length + 1
    setAgentWorkflow([
      ...agentWorkflow,
      createCustomAgent(nextNumber),
    ])
  }

  const insertCustomAgentAfter = (index: number) => {
    const nextNumber = agentWorkflow.filter((agent: any) => String(agent.id).startsWith('CUSTOM_')).length + 1
    const copy = [...agentWorkflow]
    copy.splice(index + 1, 0, createCustomAgent(nextNumber))
    setAgentWorkflow(copy)
  }

  const removeAgentWorkflowItem = (index: number) => {
    if (agentWorkflow[index]?.locked) return
    setAgentWorkflow(agentWorkflow.filter((_: any, idx: number) => idx !== index))
  }

  const resetAgentWorkflow = () => {
    setAgentWorkflow(defaultAgentWorkflow)
  }

  const promptAgent = promptAgentIndex !== null ? agentWorkflow[promptAgentIndex] : null

  return {
    agentWorkflow,
    setAgentWorkflow,
    updateAgentWorkflowItem,
    moveAgentWorkflowItem,
    restoreAgentPrompt,
    addCustomAgent,
    insertCustomAgentAfter,
    removeAgentWorkflowItem,
    resetAgentWorkflow,
    promptAgent,
  }
}
