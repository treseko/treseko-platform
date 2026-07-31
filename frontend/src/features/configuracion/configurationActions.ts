import type { Dispatch, SetStateAction } from 'react'
import {
  createUserApiKey as createUserApiKeyRequest,
  fetchAttachmentConfig,
  fetchUserApiKeys,
  revokeUserApiKey as revokeUserApiKeyRequest,
  updateAttachmentConfig,
} from './api/configuracionApi'

type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'
type ConfirmAction = (options: { title: string; message: string; variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string; cancelLabel?: string | null }) => Promise<boolean>

type CreateConfigurationActionsParams = {
  t: (key: `configuracion.${string}`, params?: Record<string, string | number>) => string
  isAuthenticated: boolean
  apiKeys: any[]
  apiKeyName: string
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setApiKeys: Dispatch<SetStateAction<any[]>>
  setApiKeysLoading: (loading: boolean) => void
  setNewApiKeyValue: (value: string) => void
  setAttachmentConfig: Dispatch<SetStateAction<any>>
  setAttachmentConfigLoading: (loading: boolean) => void
  showFeedback: (title: string, message: string, variant?: FeedbackVariant) => void
  confirmAction: ConfirmAction
}

export function createConfigurationActions({
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
}: CreateConfigurationActionsParams) {
  const copyToClipboard = async (value: string, label = 'Valor') => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      showFeedback(t('configuracion.copied'), t('configuracion.copiedMessage', { label }), 'success')
    } catch {
      showFeedback(t('configuracion.copyFailed'), t('configuracion.copyFailedMessage'), 'warning')
    }
  }

  const loadAttachmentConfig = async () => {
    setAttachmentConfigLoading(true)
    try {
      setAttachmentConfig(await fetchAttachmentConfig(fetchWithAuth))
    } catch (error: any) {
      showFeedback(t('configuracion.attachmentsUnavailable'), error.message || t('configuracion.loadAttachmentsError'), 'warning')
    } finally {
      setAttachmentConfigLoading(false)
    }
  }

  const saveAttachmentConfig = async (config: any) => {
    setAttachmentConfigLoading(true)
    try {
      const saved = await updateAttachmentConfig(fetchWithAuth, config)
      setAttachmentConfig(saved)
      showFeedback(t('configuracion.attachmentsUpdated'), t('configuracion.attachmentsUpdatedMessage'), 'success')
    } catch (error: any) {
      showFeedback(t('configuracion.saveFailed'), error.message || t('configuracion.saveAttachmentsError'), 'danger')
    } finally {
      setAttachmentConfigLoading(false)
    }
  }

  const loadApiKeys = async () => {
    if (!isAuthenticated) return
    setApiKeysLoading(true)
    try {
      setApiKeys(await fetchUserApiKeys(fetchWithAuth))
    } catch (error: any) {
      showFeedback(t('configuracion.apiKeyUnavailable'), error.message || t('configuracion.loadApiKeysError'), 'warning')
    } finally {
      setApiKeysLoading(false)
    }
  }

  const createUserApiKey = async () => {
    setApiKeysLoading(true)
    setNewApiKeyValue('')
    try {
      const created = await createUserApiKeyRequest(fetchWithAuth, apiKeyName || 'Automatizacion externa')
      setNewApiKeyValue(created.api_key || '')
      setApiKeys(prev => [created, ...prev])
      showFeedback(t('configuracion.apiKeyEnabled'), t('configuracion.apiKeyEnabledMessage'), 'success')
    } catch (error: any) {
      showFeedback(t('configuracion.createApiKeyFailed'), error.message || t('configuracion.createApiKeyError'), 'danger')
    } finally {
      setApiKeysLoading(false)
    }
  }

  const revokeUserApiKey = async (apiKeyId: string) => {
    setApiKeysLoading(true)
    try {
      const revoked = await revokeUserApiKeyRequest(fetchWithAuth, apiKeyId)
      setApiKeys(prev => prev.map(item => item.id === revoked.id ? revoked : item))
      showFeedback(t('configuracion.apiKeyRevoked'), t('configuracion.apiKeyRevokedMessage'), 'success')
    } catch (error: any) {
      showFeedback(t('configuracion.revokeApiKeyFailed'), error.message || t('configuracion.revokeApiKeyError'), 'danger')
    } finally {
      setApiKeysLoading(false)
    }
  }

  const handleApiKeyEnabledChange = async (enabled: boolean) => {
    const activeKeys = apiKeys.filter(key => key.activo)
    if (enabled) {
      if (activeKeys.length === 0) await createUserApiKey()
      return
    }
    if (activeKeys.length === 0) return
    const confirmed = await confirmAction({
      title: t('configuracion.revokeApiKeys'),
      message: t('configuracion.revokeApiKeysMessage'),
      variant: 'danger',
      confirmLabel: t('configuracion.revokeKeys'),
    })
    if (!confirmed) return
    for (const key of activeKeys) {
      await revokeUserApiKey(key.id)
    }
    setNewApiKeyValue('')
  }

  return {
    copyToClipboard,
    loadAttachmentConfig,
    saveAttachmentConfig,
    loadApiKeys,
    createUserApiKey,
    revokeUserApiKey,
    handleApiKeyEnabledChange,
  }
}
