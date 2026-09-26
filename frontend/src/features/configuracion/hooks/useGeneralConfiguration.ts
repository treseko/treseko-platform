import { useCallback, useEffect, useRef, useState } from 'react'
import { createConfigurationActions } from '../configurationActions'
import { useMcpConfiguration } from './useMcpConfiguration'

type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'
type ConfirmAction = (options: { title: string; message: string; variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string; cancelLabel?: string | null }) => Promise<boolean>

type UseGeneralConfigurationParams = {
  t: (key: `configuracion.${string}`, params?: Record<string, string | number>) => string
  isAuthenticated: boolean
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  defaultAttachmentConfig: any
  showFeedback: (title: string, message: string, variant?: FeedbackVariant) => void
  confirmAction: ConfirmAction
  canAccessCapability: (capabilityId: string, level?: string) => boolean
}

export function useGeneralConfiguration({
  t,
  isAuthenticated,
  fetchWithAuth,
  defaultAttachmentConfig,
  showFeedback,
  confirmAction,
  canAccessCapability,
}: UseGeneralConfigurationParams) {
  const [apiKeys, setApiKeys] = useState<any[]>([])
  const [apiKeysLoading, setApiKeysLoading] = useState(false)
  const [newApiKeyValue, setNewApiKeyValue] = useState('')
  const [apiKeyName, setApiKeyName] = useState('CI / Automatización externa')
  const [attachmentConfig, setAttachmentConfig] = useState(defaultAttachmentConfig)
  const [attachmentConfigLoading, setAttachmentConfigLoading] = useState(false)
  const attachmentConfigLoadedRef = useRef(false)
  const attachmentConfigLoadingRef = useRef(false)

  const {
    copyToClipboard,
    loadAttachmentConfig: loadAttachmentConfigRequest,
    saveAttachmentConfig,
    loadApiKeys,
    createUserApiKey,
    revokeUserApiKey,
    setUserApiKeyState,
    handleApiKeyEnabledChange,
  } = createConfigurationActions({
    t,
    isAuthenticated,
    apiKeys,
    apiKeyName,
    fetchWithAuth,
    setApiKeys,
    setApiKeysLoading,
    setNewApiKeyValue,
    setAttachmentConfig,
    setAttachmentConfigLoading,
    showFeedback,
    confirmAction,
  })

  const mcpConfiguration = useMcpConfiguration({
    isAuthenticated,
    fetchWithAuth,
    canRead: canAccessCapability('mcp.usar', 'read'),
    canEdit: canAccessCapability('mcp.usar', 'edit'),
    confirmAction,
    showFeedback,
    t,
  })

  const loadAttachmentConfig = useCallback(async () => {
    if (!isAuthenticated) return
    if (attachmentConfigLoadedRef.current || attachmentConfigLoadingRef.current) return
    attachmentConfigLoadingRef.current = true
    try {
      await loadAttachmentConfigRequest()
      attachmentConfigLoadedRef.current = true
    } finally {
      attachmentConfigLoadingRef.current = false
    }
  }, [isAuthenticated, loadAttachmentConfigRequest])

  useEffect(() => {
    if (isAuthenticated) return
    attachmentConfigLoadedRef.current = false
    attachmentConfigLoadingRef.current = false
  }, [isAuthenticated])

  return {
    apiKeys,
    apiKeysLoading,
    apiKeyName,
    newApiKeyValue,
    setApiKeyName,
    attachmentConfig,
    setAttachmentConfig,
    attachmentConfigLoading,
    copyToClipboard,
    loadAttachmentConfig,
    saveAttachmentConfig,
    loadApiKeys,
    createUserApiKey,
    revokeUserApiKey,
    setUserApiKeyState,
    handleApiKeyEnabledChange,
    ...mcpConfiguration,
  }
}

export type GeneralConfigurationState = ReturnType<typeof useGeneralConfiguration>
