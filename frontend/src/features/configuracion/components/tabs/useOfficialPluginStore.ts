import { useState } from 'react'
import { API_BASE } from '../../../../app/constants'

export type OfficialStoreItem = {
  release_id?: string
  plugin_id: string
  version: string
  status: string
  changelog?: string
  manifest?: { name?: string, publisher?: string, compatibility?: { treseko_min?: string, treseko_max?: string }, permissions?: string[] }
}

type StoreAuditEntry = { id: string, accion: string, usuario_email?: string, fecha?: string, detalles?: Record<string, any> }

type Options = {
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  canConfigure: boolean
  showFeedback: (title: string, message: string, variant?: string) => void
  t: (key: string) => string
}

export function useOfficialPluginStore({ fetchWithAuth, canConfigure, showFeedback, t }: Options) {
  const [items, setItems] = useState<OfficialStoreItem[]>([])
  const [available, setAvailable] = useState(false)
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [paired, setPaired] = useState(false)
  const [audit, setAudit] = useState<StoreAuditEntry[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/plugins/store/catalog`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.detail || t('configuracion.integrationStoreLoadError'))
      const isAvailable = data.available !== false
      setAvailable(isAvailable)
      setItems(Array.isArray(data.items) ? data.items : [])
      if (isAvailable && canConfigure) {
        const connection = await fetchWithAuth(`${API_BASE}/plugins/store/connection`)
        const connectionData = await connection.json().catch(() => ({}))
        if (connection.ok) setPaired(Boolean(connectionData.paired))
      } else {
        setPaired(false)
      }
    } catch (err: any) {
      setAvailable(false)
      setItems([])
      setPaired(false)
      showFeedback(t('configuracion.integrationStoreTitle'), err?.message || t('configuracion.integrationStoreUnavailable'), 'warning')
    } finally {
      setLoading(false)
    }
  }

  const pair = async () => {
    try {
      setLoading(true)
      const response = await fetchWithAuth(`${API_BASE}/plugins/store/register`, { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.detail || t('configuracion.integrationPairError'))
      setPaired(true)
      showFeedback(t('configuracion.integrationPairSuccessTitle'), t('configuracion.integrationPairSuccess'), 'success')
    } catch (err: any) {
      showFeedback(t('configuracion.integrationPairFailedTitle'), err?.message || t('configuracion.integrationStoreCheck'), 'danger')
    } finally {
      setLoading(false)
    }
  }

  return { items, available, visible, setVisible, loading, paired, audit, setAudit, load, pair }
}
