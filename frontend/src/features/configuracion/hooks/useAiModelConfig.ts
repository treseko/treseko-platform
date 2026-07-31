import { useState } from 'react'
import { API_BASE } from '../../../app/constants'
import type { TranslationKey } from '../../../i18n'
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
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

export function useAiModelConfig({
  aiEngineConfig,
  setAiEngineConfig,
  fetchWithAuth,
  showFeedback,
  t,
}: UseAiModelConfigParams) {
  const [modelScanLoading, setModelScanLoading] = useState(false)
  const [modelScanError, setModelScanError] = useState('')
  const selectedRuntimeProvider = inferAiRuntimeProvider(aiEngineConfig)
  const defaultProviderMeta = aiProviderOptions.find(option => option.value === 'openai-compatible') || aiProviderOptions[0]
  const selectedProviderMeta = aiProviderOptions.find(option => option.value === selectedRuntimeProvider) || defaultProviderMeta
  const modelCatalog = getModelCatalog(aiEngineConfig)
  const activeModelCapabilities = getActiveModelCapabilities(aiEngineConfig)

  const updateAiRuntimeProvider = (provider: string) => {
    const option = aiProviderOptions.find(item => item.value === provider) || defaultProviderMeta
    const currentEndpoint = String(aiEngineConfig.llm_endpoint || '')
    const shouldReplaceEndpoint = !currentEndpoint || aiProviderOptions.some(item => item.defaultEndpoint === currentEndpoint)
    const providerKeyEntry = aiEngineConfig.provider_api_keys?.[provider]
    const providerKeyConfigured = Boolean(providerKeyEntry?.api_key) || (aiEngineConfig.provider === provider && Boolean(aiEngineConfig.provider_api_key_configured))
    setAiEngineConfig({
      ...aiEngineConfig,
      provider,
      provider_label: option.label,
      llm_endpoint: provider === 'opencode' ? option.defaultEndpoint : (shouldReplaceEndpoint ? option.defaultEndpoint : aiEngineConfig.llm_endpoint),
      model: option.defaultModel || (provider === 'opencode' ? '' : aiEngineConfig.model),
      ai_execution_driver: provider === 'opencode' ? 'opencode' : 'treseko_engine',
      model_catalog: [],
      last_model_scan_status: null,
      last_model_scan_requires_api_key: option.requiresApiKey,
      last_model_scan_api_key_env: option.apiKeyEnv || null,
      last_model_scan_api_key_configured: providerKeyConfigured,
      provider_api_key_configured: providerKeyConfigured,
      provider_api_key_source: providerKeyConfigured ? 'stored' : null,
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
          llm_endpoint: selectedRuntimeProvider === 'opencode' ? 'http://127.0.0.1:4096' : aiEngineConfig.llm_endpoint,
        }),
      })
      if (!response.ok) throw new Error(t('configuracion.backendResponded', { status: response.status }))
      const result = await response.json()
      const scannedModels = Array.isArray(result.models) ? result.models : []
      const currentModel = String(aiEngineConfig.model || '')
      const currentModelExists = scannedModels.some((item: any) => item?.id === currentModel || item?.name === currentModel)
      const nextModel = currentModelExists ? currentModel : (scannedModels[0]?.id || selectedProviderMeta.defaultModel || currentModel || '')
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
        last_model_scan_requires_api_key: Boolean(result.requires_api_key),
        last_model_scan_api_key_env: result.api_key_env || selectedProviderMeta.apiKeyEnv || null,
        last_model_scan_api_key_configured: Boolean(result.api_key_configured),
        provider_api_key_configured: Boolean(result.api_key_configured),
        provider_api_key_source: result.api_key_source || aiEngineConfig.provider_api_key_source || null,
        ai_execution_driver: selectedRuntimeProvider === 'opencode' ? 'opencode' : aiEngineConfig.ai_execution_driver,
      })
      if (result.status === 'ok' || result.status === 'empty') {
        showFeedback(t('configuracion.aiModelsTitle'), result.detail || t('configuracion.aiModelsDetected', { count: scannedModels.length }), result.status === 'ok' ? 'success' : 'warning')
      } else {
        setModelScanError(result.detail || t('configuracion.aiModelsScanError'))
        showFeedback(t('configuracion.aiModelsTitle'), result.detail || t('configuracion.aiModelsScanError'), 'warning')
      }
      return { status: String(result.status || 'error'), models: scannedModels.length }
    } catch (error: any) {
      const message = error?.message || t('configuracion.aiModelsScanError')
      setModelScanError(message)
      showFeedback(t('configuracion.aiModelsTitle'), message, 'warning')
      return { status: 'error', models: 0 }
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
