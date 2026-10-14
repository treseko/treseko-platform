import { useCallback, useEffect, useRef, useState } from 'react'
import { createMcpCredential, fetchMcpConfiguration, listMcpCredentials, revokeMcpCredential, setMcpCredentialState, updateMcpConfiguration, type McpCredential, type McpTool, type McpScope } from '../api/configuracionApi'

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
  const loadSequenceRef = useRef(0)
  const creatingRef = useRef(false)
  const mountedRef = useRef(true)
  const lifecycleRef = useRef(0)
  const enabledRef = useRef(enabled)
  const statusRef = useRef(status)
  enabledRef.current = enabled
  statusRef.current = status

  const contextRef = useRef({ isAuthenticated, canRead, canEdit, fetchWithAuth })
  const previous = contextRef.current
  if (previous.isAuthenticated !== isAuthenticated || previous.canRead !== canRead || previous.canEdit !== canEdit || previous.fetchWithAuth !== fetchWithAuth) lifecycleRef.current += 1
  contextRef.current = { isAuthenticated, canRead, canEdit, fetchWithAuth }
  const current = (epoch: number) => mountedRef.current && lifecycleRef.current === epoch && contextRef.current.isAuthenticated && contextRef.current.canRead
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; lifecycleRef.current += 1 }
  }, [])
  useEffect(() => {
    setRawCredential(null)
    setCredentials([])
    setTools([])
    setScopeCatalog([])
    setEffectiveCapabilities({})
    setLoading(false)
    if (!isAuthenticated || !canRead) { setEnabled(false); setStatus('disabled') }
  }, [isAuthenticated, canRead, canEdit, fetchWithAuth])

  useEffect(() => {
    if (!enabled || status === 'disabled') {
      lifecycleRef.current += 1
      setRawCredential(null)
    }
  }, [enabled, status])

  const load = useCallback(async () => {
    if (!isAuthenticated || !canRead) return
    const epoch = lifecycleRef.current
    const sequence = ++loadSequenceRef.current
    setLoading(true)
    setError(null)
    try {
      const [configuration, credentialResponse] = await Promise.all([fetchMcpConfiguration(fetchWithAuth), listMcpCredentials(fetchWithAuth)])
      if (!current(epoch) || sequence !== loadSequenceRef.current) return
      setEnabled(configuration.enabled)
      setStatus(configuration.status)
      setEndpoint(configuration.endpoint)
      setTools(configuration.tools || [])
      setScopeCatalog(configuration.scope_catalog || [])
      setEffectiveCapabilities(configuration.effective_capabilities || {})
      setCredentials(credentialResponse)
    } catch (cause: any) {
      if (!current(epoch) || sequence !== loadSequenceRef.current) return
      setError(cause?.message || t('configuracion.mcpLoadError'))
    } finally {
      if (current(epoch) && sequence === loadSequenceRef.current) setLoading(false)
    }
  }, [canRead, fetchWithAuth, isAuthenticated, t])

  useEffect(() => { void load() }, [load])

  const create = useCallback(async (nombre: string, scopes: string[], expiresAt?: string) => {
    if (!isAuthenticated || !canRead || !canEdit || !enabled || status === 'disabled' || creatingRef.current) return false
    creatingRef.current = true
    const lifecycle = lifecycleRef.current
    setLoading(true)
    setRawCredential(null)
    try {
      const created = await createMcpCredential(fetchWithAuth, { nombre, scopes, ...(expiresAt ? { expires_at: expiresAt } : {}) })
      if (!mountedRef.current || lifecycle !== lifecycleRef.current || !enabledRef.current || statusRef.current === 'disabled') return
      const { api_key, ...metadata } = created
      setCredentials(current => [metadata, ...current])
      setRawCredential(api_key)
      showFeedback(t('configuracion.mcpTitle'), t('configuracion.mcpCreated'), 'success')
      return true
    } catch (cause: any) {
      if (!mountedRef.current || lifecycle !== lifecycleRef.current) return
      showFeedback(t('configuracion.mcpTitle'), cause?.message || t('configuracion.mcpCreateError'), 'danger')
      return false
    } finally {
      creatingRef.current = false
      if (current(lifecycle)) setLoading(false)
    }
  }, [isAuthenticated, canRead, canEdit, enabled, fetchWithAuth, showFeedback, status, t])

  const revoke = useCallback(async (credential: McpCredential) => {
    if (!isAuthenticated || !canRead || !canEdit || credential.estado === 'REVOKED' || (!credential.estado && !credential.activo)) return
    const epoch = lifecycleRef.current
    const confirmed = await confirmAction({ title: t('configuracion.mcpRevokeTitle'), message: t('configuracion.mcpRevokeMessage'), variant: 'danger', confirmLabel: t('configuracion.revoke') })
    if (!confirmed || !current(epoch) || !contextRef.current.canEdit) return
    setLoading(true)
    try {
      const revoked = await revokeMcpCredential(fetchWithAuth, credential.id)
      if (!current(epoch)) return
      setCredentials(current => current.map(item => item.id === revoked.id ? revoked : item))
      showFeedback(t('configuracion.mcpTitle'), t('configuracion.mcpRevoked'), 'success')
    } catch (cause: any) {
      if (!current(epoch)) return
      showFeedback(t('configuracion.mcpTitle'), cause?.message || t('configuracion.mcpRevokeError'), 'danger')
    } finally {
      if (current(epoch)) setLoading(false)
    }
  }, [isAuthenticated, canRead, canEdit, confirmAction, fetchWithAuth, showFeedback, t])

  const setCredentialState = useCallback(async (credential: McpCredential, estado: 'ACTIVE' | 'PAUSED') => {
    if (!isAuthenticated || !canRead || !canEdit || credential.estado === 'REVOKED') return
    const epoch = lifecycleRef.current
    setLoading(true)
    try {
      const updated = await setMcpCredentialState(fetchWithAuth, credential.id, estado)
      if (!current(epoch)) return
      setCredentials(current => current.map(item => item.id === updated.id ? updated : item))
      showFeedback(t('configuracion.mcpTitle'), estado === 'ACTIVE' ? t('configuracion.mcpCredentialResumed') : t('configuracion.mcpCredentialPaused'), 'success')
    } catch (cause: any) {
      if (!current(epoch)) return
      showFeedback(t('configuracion.mcpTitle'), cause?.message || t('configuracion.mcpCredentialStateError'), 'danger')
    } finally {
      if (current(epoch)) setLoading(false)
    }
  }, [isAuthenticated, canRead, canEdit, enabled, fetchWithAuth, showFeedback, status, t])

  const toggle = useCallback(async (nextEnabled: boolean) => {
    if (!isAuthenticated || !canRead || !canEdit || loading) return
    const epoch = lifecycleRef.current
    const previousEnabled = enabled
    setEnabled(nextEnabled)
    setStatus(nextEnabled ? 'available' : 'disabled')
    setLoading(true)
    try {
      const updated = await updateMcpConfiguration(fetchWithAuth, nextEnabled)
      if (!current(epoch)) return
      setEnabled(updated.enabled)
      setStatus(updated.status)
      showFeedback(t('configuracion.mcpTitle'), nextEnabled ? t('configuracion.mcpActivated') : t('configuracion.mcpDeactivated'), 'success')
    } catch (cause: any) {
      if (!current(epoch)) return
      setEnabled(previousEnabled)
      setStatus(previousEnabled ? 'available' : 'disabled')
      showFeedback(t('configuracion.mcpTitle'), cause?.message || t('configuracion.mcpToggleError'), 'danger')
    } finally {
      if (current(epoch)) setLoading(false)
    }
  }, [isAuthenticated, canRead, canEdit, enabled, fetchWithAuth, loading, showFeedback, t])

  return { tools, credentials, scopeCatalog, effectiveCapabilities, enabled, status, endpoint, loading, error, rawCredential, load, create, revoke, setCredentialState, toggle, clearRawCredential: () => setRawCredential(null) }
}

export type McpConfigurationState = ReturnType<typeof useMcpConfiguration>
