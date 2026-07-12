import { useState } from 'react'
import {
  fetchAiEngineConfig,
  fetchAiEngineHealth,
  updateAiEngineConfig,
  type FetchWithAuth,
} from '../api/configuracionApi'

type UseAiEngineConfigParams = {
  isAuthenticated: boolean
  fetchWithAuth: FetchWithAuth
  defaultConfig: any
  normalizeAiAgentWorkflow: (workflow: any[]) => any[]
  setIaProvider: (provider: string) => void
  setIaTemp: (temperature: number) => void
  setIaLogs: (updater: any) => void
  showFeedback: (title: string, message: string, variant?: string) => void
}

export function useAiEngineConfig({
  isAuthenticated,
  fetchWithAuth,
  defaultConfig,
  normalizeAiAgentWorkflow,
  setIaProvider,
  setIaTemp,
  setIaLogs,
  showFeedback,
}: UseAiEngineConfigParams) {
  const [aiEngineConfig, setAiEngineConfig] = useState(defaultConfig)
  const [aiEngineConfigLoading, setAiEngineConfigLoading] = useState(false)
  const [aiEngineHealth, setAiEngineHealth] = useState<any>(null)

  const normalizeConfig = (config: any) => ({
    ...config,
    provider_label: config.provider_label || null,
    headless: config.headless ?? true,
    max_parallel_ai_runs: Number(config.max_parallel_ai_runs ?? 1),
    model_capabilities: config.model_capabilities || {},
    model_catalog: Array.isArray(config.model_catalog) ? config.model_catalog : [],
    auto_scan_enabled: Boolean(config.auto_scan_enabled),
    last_model_scan_at: config.last_model_scan_at || null,
    last_model_scan_status: config.last_model_scan_status || null,
    active_workflow_id: config.active_workflow_id || null,
    agent_workflow: normalizeAiAgentWorkflow(Array.isArray(config.agent_workflow) ? config.agent_workflow : []),
  })

  const loadAiEngineConfig = async () => {
    if (!isAuthenticated) return
    setAiEngineConfigLoading(true)
    try {
      const config = await fetchAiEngineConfig(fetchWithAuth)
      const normalized = normalizeConfig(config)
      setAiEngineConfig(normalized)
      setIaProvider(normalized.provider || 'openai-compatible')
      setIaTemp(Number(normalized.temperature ?? 0.1))
    } catch (error: any) {
      showFeedback('Motor IA', error.message || 'No se pudo cargar la configuracion IA.', 'danger')
    } finally {
      setAiEngineConfigLoading(false)
    }
  }

  const saveAiEngineConfig = async (config: any) => {
    setAiEngineConfigLoading(true)
    try {
      const saved = await updateAiEngineConfig(fetchWithAuth, config)
      setAiEngineConfig(saved)
      setIaProvider(saved.provider || 'openai-compatible')
      setIaTemp(Number(saved.temperature ?? 0.1))
      showFeedback('Motor IA', 'Configuración de pruebas con IA guardada.', 'success')
    } catch (error: any) {
      showFeedback('Motor IA', error.message || 'No se pudo guardar la configuracion IA.', 'danger')
    } finally {
      setAiEngineConfigLoading(false)
    }
  }

  const checkAiEngineHealth = async () => {
    try {
      const health = await fetchAiEngineHealth(fetchWithAuth)
      setAiEngineHealth(health)
      setIaLogs((prev: any[]) => [...prev, {
        ts: new Date().toISOString(),
        level: 'engine',
        source: 'ENGINE',
        message: `Motor IA -> ${health.status}${health.detail ? ` (${health.detail})` : ''}`,
      }])
      return health
    } catch (error: any) {
      const health = { status: 'error', detail: error.message || 'Motor IA no disponible' }
      setAiEngineHealth(health)
      showFeedback('Motor IA', health.detail, 'danger')
      return health
    }
  }

  return {
    aiEngineConfig,
    setAiEngineConfig,
    aiEngineConfigLoading,
    aiEngineHealth,
    loadAiEngineConfig,
    saveAiEngineConfig,
    checkAiEngineHealth,
  }
}

export type AiEngineConfigState = ReturnType<typeof useAiEngineConfig>
