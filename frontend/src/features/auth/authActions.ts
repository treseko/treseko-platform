import type { FormEvent } from 'react'
import { ALLOW_LOCAL_FALLBACK, API_BASE, DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD } from '../../app/constants'
import { createSessionUser, mapBackendUserToSession } from '../../app/mappers'
import type { AuthMode, SessionUser } from '../../app/types'

type CreateAuthActionsParams = {
  authMode: AuthMode
  loginForm: { email: string; password: string; domain: string }
  adConfig: { enabled: boolean; mode?: string }
  loginWithPassword: (email?: string, password?: string) => Promise<any>
  loginWithAdPassword: (username: string, password: string) => Promise<any>
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  authHeaders: () => Promise<Record<string, string>>
  persistSession: (user: SessionUser) => void
  setLoginError: (error: string) => void
  setLoginLoading: (loading: boolean) => void
  setOrganizations: (organizations: any[]) => void
  setProjectsList: (projects: any[]) => void
  setCurrentOrgId: (orgId: string) => void
  setCurrentProjectId: (projectId: string) => void
  setCurrentCompId: (componentId: string) => void
  setCurrentBuildId: (buildId: string) => void
  setActiveTab: (tab: string) => void
  setIsAuthenticated: (authenticated: boolean) => void
}

export function createAuthActions({
  authMode,
  loginForm,
  adConfig,
  loginWithPassword,
  loginWithAdPassword,
  fetchWithAuth,
  authHeaders,
  persistSession,
  setLoginError,
  setLoginLoading,
  setOrganizations,
  setProjectsList,
  setCurrentOrgId,
  setCurrentProjectId,
  setCurrentCompId,
  setCurrentBuildId,
  setActiveTab,
  setIsAuthenticated
}: CreateAuthActionsParams) {
  const clearWorkspaceContext = () => {
    setOrganizations([])
    setProjectsList([])
    setCurrentOrgId('')
    setCurrentProjectId('')
    setCurrentCompId('')
    setCurrentBuildId('')
  }

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoginError('')
    setLoginLoading(true)
    localStorage.removeItem('qa_access_token')
    localStorage.removeItem('qa_session_expires_at')
    clearWorkspaceContext()

    try {
      if (authMode === 'local') {
        try {
          await loginWithPassword(loginForm.email, loginForm.password)
          const response = await fetchWithAuth(`${API_BASE}/users/me/`)
          if (response.ok) {
            const backendUser = await response.json()
            persistSession(mapBackendUserToSession(backendUser))
          } else if (ALLOW_LOCAL_FALLBACK) {
            persistSession(createSessionUser(loginForm.email, 'ADMIN', 'local'))
          } else {
            throw new Error('No se pudo sincronizar el usuario con backend.')
          }
        } catch {
          if (!ALLOW_LOCAL_FALLBACK || !DEV_ADMIN_PASSWORD || loginForm.email !== DEV_ADMIN_EMAIL || loginForm.password !== DEV_ADMIN_PASSWORD) {
            throw new Error('Credenciales locales inválidas o backend no disponible.')
          }
          persistSession(createSessionUser(loginForm.email, 'ADMIN', 'local'))
        }
      } else {
        if (!adConfig.enabled) throw new Error('Active Directory está deshabilitado en la configuración.')
        if ((adConfig.mode || 'oidc') === 'ldap') {
          await loginWithAdPassword(loginForm.email, loginForm.password)
          const response = await fetchWithAuth(`${API_BASE}/users/me/`)
          if (!response.ok) throw new Error('No se pudo sincronizar el usuario AD.')
          persistSession(mapBackendUserToSession(await response.json()))
          setActiveTab('dashboard')
          return
        }
        window.location.href = `${API_BASE}/auth/ad/login/?return_to=/`
        return
      }
      setActiveTab('dashboard')
    } catch (error: any) {
      setLoginError(error.message || 'No se pudo iniciar sesión.')
    } finally {
      setLoginLoading(false)
    }
  }

  const handleLogout = async () => {
    const accessToken = localStorage.getItem('qa_access_token')

    if (accessToken) {
      try {
        const headers = await authHeaders()
        await fetch(`${API_BASE}/auth/logout/`, {
          method: 'POST',
          headers,
          body: JSON.stringify({})
        })
      } catch {
      }
    }

    localStorage.removeItem('qa_session_active')
    localStorage.removeItem('qa_session_user')
    localStorage.removeItem('qa_access_token')
    localStorage.removeItem('qa_session_expires_at')
    localStorage.removeItem('qa_session_config')
    setIsAuthenticated(false)
    setActiveTab('dashboard')
    clearWorkspaceContext()
  }

  return {
    handleLogin,
    handleLogout
  }
}
