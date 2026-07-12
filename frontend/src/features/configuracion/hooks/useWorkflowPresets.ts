import { useState } from 'react'
import { fetchAiAgentPresets } from '../api/aiWorkflowApi'
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
      setAgentPresets(await fetchAiAgentPresets(fetchWithAuth))
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
