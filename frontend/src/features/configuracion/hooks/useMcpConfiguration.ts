import { useCallback, useEffect, useRef, useState } from 'react'
import { createMcpCredential, fetchMcpConfiguration, listMcpCredentials, revokeMcpCredential, updateMcpConfiguration, type McpCredential, type McpTool, type McpScope } from '../api/configuracionApi'

type Params = {
  isAuthenticated: boolean
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  canRead: boolean
  canEdit: boolean
  confirmAction: (options: { title: string; message: string; variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string }) => Promise<boolean>
  showFeedback: (title: string, message: string, variant?: 'success' | 'danger' | 'warning' | 'info') => void
  t: (key: string) => string
}

export function useMcpConfiguration({ isAuthenticated, fetchWithAuth, canRead, canEdit, confirmAction, showFeedback, t }: Params) {
  const [tools, setTools] = useState<McpTool[]>([])
  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState<'available' | 'disabled'>('disabled')
  const [endpoint, setEndpoint] = useState('/api/mcp')
  const [credentials, setCredentials] = useState<McpCredential[]>([])
  const [scopeCatalog, setScopeCatalog] = useState<McpScope[]>([])
  const [effectiveCapabilities, setEffectiveCapabilities] = useState<Record<string, 'read' | 'edit'>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rawCredential, setRawCredential] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const lifecycleRef = useRef(0)
  const enabledRef = useRef(enabled)
  const statusRef = useRef(status)
  enabledRef.current = enabled
  statusRef.current = status

  useEffect(() => () => { mountedRef.current = false; lifecycleRef.current += 1 }, [])

  useEffect(() => {
    if (!enabled || status === 'disabled') {
      lifecycleRef.current += 1
      setRawCredential(null)
    }
  }, [enabled, status])

  const load = useCallback(async () => {
    if (!isAuthenticated || !canRead) return
    setLoading(true)
    setError(null)
    try {
      const [configuration, credentialResponse] = await Promise.all([fetchMcpConfiguration(fetchWithAuth), listMcpCredentials(fetchWithAuth)])
      setEnabled(configuration.enabled)
      setStatus(configuration.status)
      setEndpoint(configuration.endpoint)
      setTools(configuration.tools || [])
      setScopeCatalog(configuration.scope_catalog || [])
      setEffectiveCapabilities(configuration.effective_capabilities || {})
      setCredentials(credentialResponse)
    } catch (cause: any) {
      setError(cause?.message || t('configuracion.mcpLoadError'))
    } finally {
      setLoading(false)
    }
  }, [canRead, fetchWithAuth, isAuthenticated, t])

  useEffect(() => { void load() }, [load])

  const create = useCallback(async (nombre: string, scopes: string[], expiresAt?: string) => {
    if (!canEdit || !enabled || status === 'disabled') return
    const lifecycle = lifecycleRef.current
    setLoading(true)
    setRawCredential(null)
    try {
      const created = await createMcpCredential(fetchWithAuth, { nombre, scopes, ...(expiresAt ? { expires_at: expiresAt } : {}) })
      if (!mountedRef.current || lifecycle !== lifecycleRef.current || !enabledRef.current || statusRef.current === 'disabled') return
      setCredentials(current => [created, ...current])
      setRawCredential(created.api_key)
      showFeedback(t('configuracion.mcpTitle'), t('configuracion.mcpCreated'), 'success')
    } catch (cause: any) {
      if (!mountedRef.current || lifecycle !== lifecycleRef.current) return
      showFeedback(t('configuracion.mcpTitle'), cause?.message || t('configuracion.mcpCreateError'), 'danger')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [canEdit, enabled, fetchWithAuth, showFeedback, status, t])

  const revoke = useCallback(async (credential: McpCredential) => {
    if (!canEdit || !enabled || status === 'disabled' || !credential.activo) return
    const confirmed = await confirmAction({ title: t('configuracion.mcpRevokeTitle'), message: t('configuracion.mcpRevokeMessage'), variant: 'danger', confirmLabel: t('configuracion.revoke') })
    if (!confirmed) return
    setLoading(true)
    try {
      const revoked = await revokeMcpCredential(fetchWithAuth, credential.id)
      setCredentials(current => current.map(item => item.id === revoked.id ? revoked : item))
      showFeedback(t('configuracion.mcpTitle'), t('configuracion.mcpRevoked'), 'success')
    } catch (cause: any) {
      showFeedback(t('configuracion.mcpTitle'), cause?.message || t('configuracion.mcpRevokeError'), 'danger')
    } finally {
      setLoading(false)
    }
  }, [canEdit, confirmAction, enabled, fetchWithAuth, showFeedback, status, t])

  const toggle = useCallback(async (nextEnabled: boolean) => {
    if (!canEdit || loading) return
    const previousEnabled = enabled
    setEnabled(nextEnabled)
    setStatus(nextEnabled ? 'available' : 'disabled')
    setLoading(true)
    try {
      const updated = await updateMcpConfiguration(fetchWithAuth, nextEnabled)
      setEnabled(updated.enabled)
      setStatus(updated.status)
      showFeedback(t('configuracion.mcpTitle'), nextEnabled ? t('configuracion.mcpActivated') : t('configuracion.mcpDeactivated'), 'success')
    } catch (cause: any) {
      setEnabled(previousEnabled)
      setStatus(previousEnabled ? 'available' : 'disabled')
      showFeedback(t('configuracion.mcpTitle'), cause?.message || t('configuracion.mcpToggleError'), 'danger')
    } finally {
      setLoading(false)
    }
  }, [canEdit, enabled, fetchWithAuth, loading, showFeedback, t])

  return { tools, credentials, scopeCatalog, effectiveCapabilities, enabled, status, endpoint, loading, error, rawCredential, load, create, revoke, toggle, clearRawCredential: () => setRawCredential(null) }
}

export type McpConfigurationState = ReturnType<typeof useMcpConfiguration>
