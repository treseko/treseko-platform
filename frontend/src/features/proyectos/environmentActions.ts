import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { mapBackendEnvironmentToItem } from '../../app/mappers'
import { isValidUUID } from '../../app/validation'
import type { TranslationKey } from '../../i18n'

type CreateEnvironmentActionsParams = {
  projectsSource: 'local' | 'backend'
  managingProjectId: string | null
  environments: any[]
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setEnvironments: Dispatch<SetStateAction<any[]>>
  setProjectSyncMessage: (message: string) => void
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

export function createEnvironmentActions({
  projectsSource,
  managingProjectId,
  environments,
  fetchWithAuth,
  setEnvironments,
  setProjectSyncMessage,
  t
}: CreateEnvironmentActionsParams) {
  const parseVariablesText = (value: string) =>
    Object.fromEntries(
      String(value || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
          const separator = line.indexOf('=')
          if (separator === -1) return [line, '']
          return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]
        })
        .filter(([key]) => key)
    )

  const parseJsonObject = (value: string, label: string) => {
    const text = String(value || '').trim()
    if (!text) return {}
    try {
      const parsed = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} debe ser un objeto JSON`)
      return parsed
    } catch (error: any) {
      throw new Error(`${label}: JSON inválido (${error?.message || 'revisa el formato'})`)
    }
  }

  const parseJsonProfiles = (value: string) => {
    const text = String(value || '').trim()
    if (!text) return []
    try {
      const parsed = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object') throw new Error('debe ser una lista u objeto JSON')
      return parsed
    } catch (error: any) {
      throw new Error(`Perfiles Chatbot: JSON inválido (${error?.message || 'revisa el formato'})`)
    }
  }

  const chatbotConfigFromForm = (formData: FormData) => {
    const endpoint = String(formData.get('chatbotEndpoint') || '').trim()
    const headers = parseJsonObject(String(formData.get('chatbotHeaders') || ''), 'Headers Chatbot')
    const requestTemplate = parseJsonObject(String(formData.get('chatbotRequestTemplate') || ''), 'Plantilla Chatbot')
    const responseMapping = parseJsonObject(String(formData.get('chatbotResponseMapping') || ''), 'Mapeo Chatbot')
    const profileBindings = parseJsonObject(String(formData.get('chatbotProfileBindings') || ''), 'Bindings del perfil')
    const profiles = parseJsonProfiles(String(formData.get('chatbotProfiles') || ''))
    const defaultProfile = String(formData.get('chatbotDefaultProfile') || '').trim()
    const hasConfig = Boolean(endpoint || Object.keys(headers).length || Object.keys(requestTemplate).length || Object.keys(responseMapping).length || Object.keys(profileBindings).length || (Array.isArray(profiles) ? profiles.length : Object.keys(profiles).length) || defaultProfile)
    if (!hasConfig) return {}
    return {
      schema_version: 1,
      connection: {
        adapter: String(formData.get('chatbotAdapter') || 'http'),
        endpoint,
        method: String(formData.get('chatbotMethod') || 'POST'),
        headers,
        request_template: requestTemplate,
        response_mapping: responseMapping,
        timeout_ms: Number(formData.get('chatbotTimeout') || 30000),
        retries: Number(formData.get('chatbotRetries') || 0),
      },
      profile_bindings: profileBindings,
      profiles,
      ...(defaultProfile ? { default_profile: defaultProfile } : {}),
    }
  }

  const loadEnvironmentsForProject = async (projectId: string) => {
    if (!projectId || !isValidUUID(projectId) || projectsSource !== 'backend') return
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${projectId}/entornos/`)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }

      const envs = await response.json()
      const mapped = envs.map(mapBackendEnvironmentToItem)
      setEnvironments(prev => [
        ...prev.filter(env => env.projectId !== projectId),
        ...mapped
      ])
    } catch (error: any) {
      setProjectSyncMessage(`No se pudieron cargar ambientes: ${error.message}.`)
    }
  }

  const handleSaveProjectEnvironment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const target = event.currentTarget
    const formData = new FormData(target)
    const envUrl = String(formData.get('envUrl') || '').trim()
    const fixedVariables = Object.fromEntries(
      ['USER', 'PASSWORD', 'TOKEN', 'TENANT']
        .map(key => [key, String(formData.get(`env${key}`) || '').trim()])
        .filter(([, value]) => value)
    )
    let chatbotConfig: Record<string, any>
    try {
      chatbotConfig = chatbotConfigFromForm(formData)
    } catch (error: any) {
      setProjectSyncMessage(error?.message || 'Configuración Chatbot inválida.')
      return
    }
    const data = {
      name: String(formData.get('envName') || '').trim(),
      url: envUrl,
      status: String(formData.get('envStatus') || 'Unknown'),
      version: String(formData.get('envVersion') || '').trim(),
      variables: {
        ...(envUrl ? { BASE_URL: envUrl } : {}),
        ...fixedVariables,
        ...parseVariablesText(String(formData.get('envVariables') || ''))
      },
      configuracion_chatbot: chatbotConfig,
    }
    if (!data.name || !data.url || !managingProjectId) return

    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/entornos/`, {
          method: 'POST',
          body: JSON.stringify({
            proyecto_id: managingProjectId,
            nombre: data.name,
            url: data.url,
            status: data.status,
            version: data.version,
            variables: data.variables,
            configuracion_chatbot: data.configuracion_chatbot
          })
        })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }
        const env = await response.json()
        setEnvironments([...environments, mapBackendEnvironmentToItem(env)])
        setProjectSyncMessage(t('proyectos.environmentCreatedBackend'))
      } catch (error: any) {
        setProjectSyncMessage(`${t('proyectos.environmentPersistError')}: ${error.message}.`)
        return
      }
    } else {
      setEnvironments([...environments, { id: `e${Date.now()}`, projectId: managingProjectId, ...data, chatbotConfig: data.configuracion_chatbot, lastPing: 'Justo ahora' }])
      setProjectSyncMessage(t('proyectos.environmentCreatedLocal'))
    }
    target.reset()
  }

  const handleDeleteProjectEnvironment = async (envId: string) => {
    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/entornos/${envId}`, { method: 'DELETE' })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }
      } catch (error: any) {
        setProjectSyncMessage(`${t('proyectos.environmentDeleteError')}: ${error.message}.`)
        return
      }
    }
    setEnvironments(environments.filter(env => env.id !== envId))
    setProjectSyncMessage(t('proyectos.environmentHidden'))
  }

  const handleEditProjectEnvironment = async (envId: string, event?: FormEvent<HTMLFormElement>) => {
    const current = environments.find(env => env.id === envId)
    if (!current) return
    if (event) {
      event.preventDefault()
      const formData = new FormData(event.currentTarget)
      const name = String(formData.get('envName') || '').trim()
      const url = String(formData.get('envUrl') || '').trim()
      if (!name || !url) return
      const version = String(formData.get('envVersion') || '').trim()
      const status = String(formData.get('envStatus') || current.status || 'Unknown')
      const variables = {
        ...(url ? { BASE_URL: url } : {}),
        ...parseVariablesText(String(formData.get('envVariables') || ''))
      }
      let configuracion_chatbot: Record<string, any>
      try {
        configuracion_chatbot = chatbotConfigFromForm(formData)
      } catch (error: any) {
        setProjectSyncMessage(error?.message || 'Configuración Chatbot inválida.')
        return
      }

      if (projectsSource === 'backend') {
        try {
          const response = await fetchWithAuth(`${API_BASE}/entornos/${envId}`, {
            method: 'PATCH',
            body: JSON.stringify({ nombre: name, url, version, status, variables, configuracion_chatbot })
          })
          if (!response.ok) {
            const error = await response.json().catch(() => null)
            throw new Error(error?.detail || `Backend respondió ${response.status}`)
          }
          const updated = await response.json()
          setEnvironments(environments.map(env => env.id === envId ? mapBackendEnvironmentToItem(updated) : env))
          setProjectSyncMessage(t('proyectos.environmentUpdated'))
        } catch (error: any) {
          setProjectSyncMessage(`${t('proyectos.environmentUpdateError')}: ${error.message}.`)
        }
        return
      }

      setEnvironments(environments.map(env => env.id === envId ? { ...env, name, url, version, status, variables, chatbotConfig: configuracion_chatbot } : env))
      setProjectSyncMessage(t('proyectos.environmentUpdatedLocal'))
      return
    }
    return false
  }

  const handleSaveEnvironmentDataset = async (event: FormEvent<HTMLFormElement>, envId: string) => {
    event.preventDefault()
    const target = event.currentTarget
    const formData = new FormData(target)
    const payload = {
      nombre: String(formData.get('datasetName') || '').trim(),
      descripcion: String(formData.get('datasetDescription') || '').trim(),
      variables: parseVariablesText(String(formData.get('datasetVariables') || '')),
      activo: true,
      es_default: Boolean(formData.get('datasetDefault'))
    }
    if (!payload.nombre) return false

    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/entornos/${envId}/datasets/`, {
          method: 'POST',
          body: JSON.stringify(payload)
        })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondio ${response.status}`)
        }
        const created = await response.json()
        setEnvironments(prev => prev.map(env => {
          if (env.id !== envId) return env
          const createdDataset = {
            id: created.id,
            environmentId: created.entorno_id,
            name: created.nombre,
            description: created.descripcion || '',
            variables: created.variables || {},
            active: created.activo !== false,
            isDefault: Boolean(created.es_default),
            createdAt: created.fecha_creacion || ''
          }
          return {
            ...env,
            datasets: [...(env.datasets || []), createdDataset].map((dataset: any) => ({
              ...dataset,
              isDefault: createdDataset.isDefault ? dataset.id === createdDataset.id : dataset.isDefault
            }))
          }
        }))
        setProjectSyncMessage(t('proyectos.datasetSaved'))
      } catch (error: any) {
        setProjectSyncMessage(`${t('proyectos.datasetCreateError')}: ${error.message}.`)
        return false
      }
    } else {
      setEnvironments(prev => prev.map(env => env.id === envId ? {
        ...env,
        datasets: [...(env.datasets || []), { id: `ds_${Date.now()}`, environmentId: envId, name: payload.nombre, description: payload.descripcion, variables: payload.variables, active: true, isDefault: payload.es_default || (env.datasets || []).length === 0 }]
          .map((dataset: any, _index: number, list: any[]) => ({
            ...dataset,
            isDefault: (payload.es_default || (env.datasets || []).length === 0) ? dataset.id === list[list.length - 1].id : dataset.isDefault
          }))
      } : env))
    }
    target.reset()
    return true
  }

  const handleSetDefaultEnvironmentDataset = async (envId: string, datasetId: string) => {
    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/entorno-datasets/${datasetId}/`, {
          method: 'PATCH',
          body: JSON.stringify({ es_default: true })
        })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondio ${response.status}`)
        }
      } catch (error: any) {
        setProjectSyncMessage(`${t('proyectos.datasetDefaultError')}: ${error.message}.`)
        return false
      }
    }
    setEnvironments(prev => prev.map(env => env.id === envId ? {
      ...env,
      datasets: (env.datasets || []).map((dataset: any) => ({ ...dataset, isDefault: dataset.id === datasetId }))
    } : env))
    setProjectSyncMessage(t('proyectos.datasetDefaultUpdated'))
    return true
  }

  const handleUpdateEnvironmentDataset = async (event: FormEvent<HTMLFormElement>, envId: string, datasetId: string) => {
    event.preventDefault()
    const target = event.currentTarget
    const formData = new FormData(target)
    const payload = {
      nombre: String(formData.get('datasetName') || '').trim(),
      descripcion: String(formData.get('datasetDescription') || '').trim(),
      variables: parseVariablesText(String(formData.get('datasetVariables') || '')),
      activo: true,
      es_default: Boolean(formData.get('datasetDefault'))
    }
    if (!payload.nombre) return false

    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/entorno-datasets/${datasetId}/`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondio ${response.status}`)
        }
        const updated = await response.json()
        setEnvironments(prev => prev.map(env => {
          if (env.id !== envId) return env
          const updatedDataset = {
            id: updated.id,
            environmentId: updated.entorno_id,
            name: updated.nombre,
            description: updated.descripcion || '',
            variables: updated.variables || {},
            active: updated.activo !== false,
            isDefault: Boolean(updated.es_default),
            createdAt: updated.fecha_creacion || ''
          }
          return {
            ...env,
            datasets: (env.datasets || []).map((dataset: any) => ({
              ...dataset,
              ...(dataset.id === datasetId ? updatedDataset : {}),
              isDefault: updatedDataset.isDefault ? dataset.id === datasetId : dataset.isDefault
            }))
          }
        }))
        setProjectSyncMessage(t('proyectos.datasetUpdated'))
      } catch (error: any) {
        setProjectSyncMessage(`${t('proyectos.datasetUpdateError')}: ${error.message}.`)
        return false
      }
      return true
    }

    setEnvironments(prev => prev.map(env => env.id === envId ? {
      ...env,
      datasets: (env.datasets || []).map((dataset: any) => ({
        ...dataset,
        ...(dataset.id === datasetId ? {
          name: payload.nombre,
          description: payload.descripcion,
          variables: payload.variables,
          active: payload.activo,
          isDefault: payload.es_default
        } : {}),
        isDefault: payload.es_default ? dataset.id === datasetId : dataset.isDefault
      }))
    } : env))
    setProjectSyncMessage(t('proyectos.datasetSaved'))
    return true
  }

  const handleDeleteEnvironmentDataset = async (envId: string, datasetId: string) => {
    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/entorno-datasets/${datasetId}/`, { method: 'DELETE' })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondio ${response.status}`)
        }
      } catch (error: any) {
        setProjectSyncMessage(`${t('proyectos.datasetDeleteError')}: ${error.message}.`)
        return false
      }
    }
    setEnvironments(prev => prev.map(env => env.id === envId ? {
      ...env,
      datasets: (env.datasets || []).filter((dataset: any) => dataset.id !== datasetId)
    } : env))
    setProjectSyncMessage(t('proyectos.datasetHidden'))
    return true
  }

  return {
    loadEnvironmentsForProject,
    handleSaveProjectEnvironment,
    handleEditProjectEnvironment,
    handleDeleteProjectEnvironment,
    handleSaveEnvironmentDataset,
    handleUpdateEnvironmentDataset,
    handleSetDefaultEnvironmentDataset,
    handleDeleteEnvironmentDataset
  }
}
