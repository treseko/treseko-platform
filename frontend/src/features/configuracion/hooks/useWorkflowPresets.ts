import { useState } from 'react'
import { fetchAiAgentDefinitions, fetchAiAgentPresets, fetchAiUniversalAgents } from '../api/aiWorkflowApi'
import type { AiAgentPreset } from '../types/configuracion'
import type { FetchWithAuth } from '../api/configuracionApi'

type UseWorkflowPresetsParams = {
  fetchWithAuth: FetchWithAuth
}

export function useWorkflowPresets({ fetchWithAuth }: UseWorkflowPresetsParams) {
  const [agentPresets, setAgentPresets] = useState<AiAgentPreset[]>([])
  const [agentPresetsError, setAgentPresetsError] = useState('')

  const loadAgentPresets = async () => {
    try {
      setAgentPresetsError('')
      const [definitions, presets, universalAgents] = await Promise.all([
        fetchAiAgentDefinitions(fetchWithAuth),
        fetchAiAgentPresets(fetchWithAuth),
        fetchAiUniversalAgents(fetchWithAuth),
      ])
      const catalog = (definitions || []).map((definition: any) => ({
        id: definition.id,
        key: definition.key,
        agent_definition_id: definition.id,
        name: definition.name,
        type: definition.runtime_handler || definition.kind,
        kind: definition.kind,
        category: definition.category,
        description: definition.description,
        config_json: definition.default_retry_policy || {},
        config_schema_json: definition.config_schema_json || {},
        capabilities_json: definition.capabilities_json || {},
        ui_metadata_json: definition.ui_metadata_json || {},
        requires_secret_reference: Boolean(definition.requires_secret_reference),
        status: definition.status,
        runtime_handler: definition.runtime_handler,
      }))
      const universal = (universalAgents || []).flatMap((agent: any) => (agent.versions || [])
        .filter((version: any) => ['DRAFT', 'PUBLISHED'].includes(version.status))
        .map((version: any) => ({
          id: `universal:${version.id}`,
          key: `UNIVERSAL_${agent.key}`,
          universal_agent_version_id: version.id,
          name: `${agent.name} v${version.version}`,
          type: 'universal_agent',
          kind: 'universal',
          category: agent.category,
          description: agent.description,
          status: version.status.toLowerCase(),
          universal_contract: version.contract_json,
        })))
      setAgentPresets([...catalog, ...universal, ...(presets || [])])
    } catch (error: any) {
      setAgentPresets([])
      setAgentPresetsError(error?.message || 'No se pudieron cargar los presets.')
    }
  }

  return {
    agentPresets,
    agentPresetsError,
    loadAgentPresets,
  }
}
