import { useState } from 'react'
import { API_BASE } from '../../../app/constants'
import {
  aiProviderOptions,
  defaultModelCapabilities,
  getActiveModelCapabilities,
  getModelCatalog,
  inferAiRuntimeProvider,
} from '../mappers/configuracionMappers'

type UseAiModelConfigParams = {
  aiEngineConfig: any
  setAiEngineConfig: (config: any) => void
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
}

export function useAiModelConfig({
  aiEngineConfig,
  setAiEngineConfig,
  fetchWithAuth,
  showFeedback,
}: UseAiModelConfigParams) {
  const [modelScanLoading, setModelScanLoading] = useState(false)
  const [modelScanError, setModelScanError] = useState('')
  const selectedRuntimeProvider = inferAiRuntimeProvider(aiEngineConfig)
  const selectedProviderMeta = aiProviderOptions.find(option => option.value === selectedRuntimeProvider) || aiProviderOptions[1]
  const modelCatalog = getModelCatalog(aiEngineConfig)
  const activeModelCapabilities = getActiveModelCapabilities(aiEngineConfig)

  const updateAiRuntimeProvider = (provider: string) => {
    const option = aiProviderOptions.find(item => item.value === provider) || aiProviderOptions[1]
    const currentEndpoint = String(aiEngineConfig.llm_endpoint || '')
    const shouldReplaceEndpoint = !currentEndpoint || aiProviderOptions.some(item => item.defaultEndpoint === currentEndpoint)
    setAiEngineConfig({
      ...aiEngineConfig,
      provider,
      provider_label: option.label,
      llm_endpoint: shouldReplaceEndpoint ? option.defaultEndpoint : aiEngineConfig.llm_endpoint,
      last_model_scan_status: null,
    })
  }

  const updateActiveModelCapability = (key: string, value: any) => {
    const modelId = aiEngineConfig.model || 'default'
    const currentCapabilities = getActiveModelCapabilities(aiEngineConfig)
    setAiEngineConfig({
      ...aiEngineConfig,
      model_capabilities: {
        ...(aiEngineConfig.model_capabilities || {}),
        [modelId]: {
          ...currentCapabilities,
          [key]: value,
          source: currentCapabilities.source || 'manual',
        },
      },
    })
  }

  const scanAiModels = async () => {
    setModelScanLoading(true)
    setModelScanError('')
    try {
      const response = await fetchWithAuth(`${API_BASE}/ai-engine/models/scan`, {
        method: 'POST',
        body: JSON.stringify({
          provider: selectedRuntimeProvider,
          llm_endpoint: aiEngineConfig.llm_endpoint,
        }),
      })
      if (!response.ok) throw new Error(`Backend respondio ${response.status}`)
      const result = await response.json()
      const scannedModels = Array.isArray(result.models) ? result.models : []
      const nextModel = aiEngineConfig.model || scannedModels[0]?.id || ''
      const nextCapabilities = scannedModels.reduce((acc: any, item: any) => {
        if (item?.id) acc[item.id] = item.capabilities || defaultModelCapabilities
        return acc
      }, { ...(aiEngineConfig.model_capabilities || {}) })
      setAiEngineConfig({
        ...aiEngineConfig,
        provider: result.provider || selectedRuntimeProvider,
        provider_label: selectedProviderMeta.label,
        llm_endpoint: result.llm_endpoint || aiEngineConfig.llm_endpoint,
        model: nextModel,
        model_catalog: scannedModels,
        model_capabilities: nextCapabilities,
        auto_scan_enabled: true,
        last_model_scan_at: result.scanned_at,
        last_model_scan_status: result.status,
      })
      if (result.status === 'ok' || result.status === 'empty') {
        showFeedback('Modelos IA', result.detail || `${scannedModels.length} modelos detectados.`, result.status === 'ok' ? 'success' : 'warning')
      } else {
        setModelScanError(result.detail || 'No se pudo escanear modelos.')
        showFeedback('Modelos IA', result.detail || 'No se pudo escanear modelos.', 'warning')
      }
    } catch (error: any) {
      const message = error?.message || 'No se pudo escanear modelos.'
      setModelScanError(message)
      showFeedback('Modelos IA', message, 'warning')
    } finally {
      setModelScanLoading(false)
    }
  }

  return {
    aiProviderOptions,
    modelScanLoading,
    modelScanError,
    selectedRuntimeProvider,
    selectedProviderMeta,
    modelCatalog,
    activeModelCapabilities,
    updateAiRuntimeProvider,
    updateActiveModelCapability,
    scanAiModels,
  }
}
