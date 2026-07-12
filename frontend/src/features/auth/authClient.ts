import { API_BASE } from '../../app/constants'
import { mapBackendUserToSession } from '../../app/mappers'
import type { SessionUser } from '../../app/types'
import type { Dispatch, SetStateAction } from 'react'

type CreateAuthClientParams = {
  setLoggedUser: Dispatch<SetStateAction<SessionUser>>
  setIsAuthenticated: (authenticated: boolean) => void
  setLoginError: (error: string) => void
}

function isFormDataBody(body: BodyInit | null | undefined): body is FormData {
  return typeof FormData !== 'undefined' && body instanceof FormData
}

function withAuthHeaders(token: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers || {})
  headers.set('Authorization', `Bearer ${token}`)
  if (!headers.has('Content-Type') && !isFormDataBody(options.body)) {
    headers.set('Content-Type', 'application/json')
  }
  return headers
}

function isJwtExpired(token: string) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1] || ''))
    const exp = Number(payload.exp || 0)
    return exp > 0 && exp * 1000 <= Date.now()
  } catch {
    return true
  }
}

function getJwtExpiresAt(token: string) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1] || ''))
    const exp = Number(payload.exp || 0)
    return exp > 0 ? new Date(exp * 1000).toISOString() : ''
  } catch {
    return ''
  }
}

function serializeSessionUser(user: SessionUser) {
  try {
    return JSON.stringify(user)
  } catch {
    return ''
  }
}

export function createAuthClient({
  setLoggedUser,
  setIsAuthenticated,
  setLoginError
}: CreateAuthClientParams) {
  const loginWithPassword = async (email: string, password: string) => {
    const body = new URLSearchParams()
    body.set('username', email)
    body.set('password', password)

    const response = await fetch(`${API_BASE}/auth/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })

    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.detail || 'No se pudo iniciar sesión en backend.')
    }

    const data = await response.json()
    localStorage.setItem('qa_access_token', data.access_token)
    localStorage.setItem('qa_session_expires_at', getJwtExpiresAt(data.access_token))
    return data.access_token as string
  }

  const loginWithAdPassword = async (username: string, password: string) => {
    const response = await fetch(`${API_BASE}/auth/ad/password-login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })

    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.detail || 'No se pudo iniciar sesión con Active Directory.')
    }

    const data = await response.json()
    localStorage.setItem('qa_access_token', data.access_token)
    localStorage.setItem('qa_session_expires_at', getJwtExpiresAt(data.access_token))
    return data.access_token as string
  }

  const getStoredAccessToken = () => {
    const cached = localStorage.getItem('qa_access_token')
    if (cached && !isJwtExpired(cached)) {
      return cached
    }
    localStorage.removeItem('qa_access_token')
    return null
  }

  const hasValidStoredSession = () => {
    const expiresAt = localStorage.getItem('qa_session_expires_at')
    if (!expiresAt) return false
    const expiresMs = Date.parse(expiresAt)
    return Number.isFinite(expiresMs) && expiresMs > Date.now()
  }

  const responseWithoutToken = () => new Response(
    JSON.stringify({ detail: 'Sesión sin token de backend.' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } }
  )

  const responseTemporaryAuthUnavailable = () => new Response(
    JSON.stringify({ detail: 'No se pudo validar la sesion con backend. Intenta nuevamente.' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  )

  const clearBackendSession = (message = 'Sesion expirada. Por favor, inicia sesion nuevamente.') => {
    setLoginError(message)
    setIsAuthenticated(false)
    localStorage.removeItem('qa_session_active')
    localStorage.removeItem('qa_session_user')
    localStorage.removeItem('qa_access_token')
    localStorage.removeItem('qa_session_expires_at')
  }

  const authHeaders = async () => {
    const token = getStoredAccessToken()
    if (!token) {
      throw new Error('Sesión sin token de backend.')
    }
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  }

  const fetchWithAuth = async (url: string, options: RequestInit = {}): Promise<Response> => {
    let token = getStoredAccessToken()
    if (!token) {
      if (hasValidStoredSession()) {
        return responseTemporaryAuthUnavailable()
      }
      clearBackendSession('Sesion expirada. Inicia sesion nuevamente.')
      return responseWithoutToken()
    }
    const mergedOptions = {
      ...options,
      headers: withAuthHeaders(token, options)
    }

    let response = await fetch(url, mergedOptions)

    if (response.status === 401) {
      setLoginError('Sesión expirada. Por favor, inicia sesión nuevamente.')
      setIsAuthenticated(false)
      localStorage.removeItem('qa_session_active')
      localStorage.removeItem('qa_session_user')
      localStorage.removeItem('qa_access_token')
      localStorage.removeItem('qa_session_expires_at')
    }

    return response
  }

  const persistSession = (user: SessionUser) => {
    const serialized = serializeSessionUser(user)
    setLoggedUser(prev => serializeSessionUser(prev) === serialized ? prev : user)
    setIsAuthenticated(true)
    localStorage.setItem('qa_session_active', 'true')
    localStorage.setItem('qa_session_user', serialized || JSON.stringify(user))
  }

  const syncSessionFromBackend = async () => {
    const token = getStoredAccessToken()
    if (!token) {
      if (hasValidStoredSession()) {
        return
      }
      if (localStorage.getItem('qa_session_active') === 'true') {
        clearBackendSession('Sesion sin token de backend. Inicia sesion nuevamente.')
      }
      return
    }
    try {
      const response = await fetch(`${API_BASE}/users/me/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.status === 401 || response.status === 403) {
        clearBackendSession()
        return
      }
      if (response.ok) {
        persistSession(mapBackendUserToSession(await response.json()))
      }
    } catch {
    }
  }

  return {
    loginWithPassword,
    loginWithAdPassword,
    authHeaders,
    fetchWithAuth,
    persistSession,
    syncSessionFromBackend
  }
}
