import { useEffect, useRef } from 'react'

type UseConfigurationPreloadParams = {
  activeTab: string
  configTab: string
  isAuthenticated: boolean
  canAccessCapability: (capabilityId: any, level?: any) => boolean
  hasSystemFeature: (featureId: string) => boolean
  loadApiKeys: () => void
  loadSessionConfig: () => void
  loadAiEngineConfig: () => void
  loadAttachmentConfig: () => void
}

export function useConfigurationPreload({
  activeTab,
  configTab,
  isAuthenticated,
  canAccessCapability,
  hasSystemFeature,
  loadApiKeys,
  loadSessionConfig,
  loadAiEngineConfig,
  loadAttachmentConfig,
}: UseConfigurationPreloadParams) {
  const attachmentConfigPreloadedRef = useRef(false)

  useEffect(() => {
    if (activeTab === 'configuracion' && ['api_keys', 'mcp', 'security'].includes(configTab)) {
      // API keys and session settings are loaded only inside their own sections.
      if (['api_keys', 'mcp'].includes(configTab) && canAccessCapability(configTab === 'mcp' ? 'mcp.usar' : 'configuracion.api_keys', 'read')) {
        loadApiKeys()
      }
      if (configTab === 'security' && canAccessCapability('configuracion.sesion', 'read')) {
        loadSessionConfig()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, configTab, isAuthenticated, canAccessCapability])

  useEffect(() => {
    if (
      activeTab === 'configuracion' &&
      configTab === 'ai' &&
      hasSystemFeature('ai.engine') &&
      canAccessCapability('configuracion.pruebas_ia', 'read')
    ) {
      loadAiEngineConfig()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, configTab, isAuthenticated, canAccessCapability, hasSystemFeature])

  useEffect(() => {
    if (!isAuthenticated) {
      attachmentConfigPreloadedRef.current = false
      return
    }
    if (attachmentConfigPreloadedRef.current) return
    if (!canAccessCapability('configuracion.adjuntos', 'read')) return
    attachmentConfigPreloadedRef.current = true
    loadAttachmentConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, canAccessCapability])
}
