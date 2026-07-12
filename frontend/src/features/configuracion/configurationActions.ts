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
      showFeedback('Copiado', `${label} copiado al portapapeles.`, 'success')
    } catch {
      showFeedback('No se pudo copiar', 'Copia el valor manualmente.', 'warning')
    }
  }

  const loadAttachmentConfig = async () => {
    setAttachmentConfigLoading(true)
    try {
      setAttachmentConfig(await fetchAttachmentConfig(fetchWithAuth))
    } catch (error: any) {
      showFeedback('Adjuntos no disponibles', error.message || 'No se pudo cargar la configuracion de evidencias.', 'warning')
    } finally {
      setAttachmentConfigLoading(false)
    }
  }

  const saveAttachmentConfig = async (config: any) => {
    setAttachmentConfigLoading(true)
    try {
      const saved = await updateAttachmentConfig(fetchWithAuth, config)
      setAttachmentConfig(saved)
      showFeedback('Adjuntos actualizados', 'La configuracion de evidencias fue guardada.', 'success')
    } catch (error: any) {
      showFeedback('No se pudo guardar', error.message || 'Error al guardar configuracion de adjuntos.', 'danger')
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
      showFeedback('API key no disponible', error.message || 'No se pudieron cargar las API keys.', 'warning')
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
      showFeedback('API key habilitada', 'La API key fue creada. Guardala ahora porque no se volvera a mostrar completa.', 'success')
    } catch (error: any) {
      showFeedback('No se pudo crear API key', error.message || 'Error al crear API key.', 'danger')
    } finally {
      setApiKeysLoading(false)
    }
  }

  const revokeUserApiKey = async (apiKeyId: string) => {
    setApiKeysLoading(true)
    try {
      const revoked = await revokeUserApiKeyRequest(fetchWithAuth, apiKeyId)
      setApiKeys(prev => prev.map(item => item.id === revoked.id ? revoked : item))
      showFeedback('API key revocada', 'La API key ya no podrá reportar ejecuciones.', 'success')
    } catch (error: any) {
      showFeedback('No se pudo revocar', error.message || 'Error al revocar API key.', 'danger')
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
      title: 'Revocar API keys',
      message: 'Se revocaran las API keys activas de automatizacion externa. Los runners que usen esas claves dejaran de reportar.',
      variant: 'danger',
      confirmLabel: 'Revocar claves',
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
