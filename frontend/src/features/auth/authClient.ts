import { API_BASE } from '../../app/constants'
import { mapBackendUserToSession } from '../../app/mappers'
import type { SessionUser } from '../../app/types'
import type { Dispatch, SetStateAction } from 'react'
import type { TranslationKey } from '../../i18n'

type CreateAuthClientParams = {
  setLoggedUser: Dispatch<SetStateAction<SessionUser>>
  setIsAuthenticated: (authenticated: boolean) => void
  setLoginError: (error: string) => void
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
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
  setLoginError,
  t
}: CreateAuthClientParams) {
  const persistAccessToken = (accessToken: string) => {
    if (!accessToken) {
      throw new Error(t('auth.invalidSessionToken'))
    }
    localStorage.setItem('qa_access_token', accessToken)
    localStorage.setItem('qa_session_expires_at', getJwtExpiresAt(accessToken))
  }

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
      throw new Error(error?.detail || t('auth.backendLoginFailed'))
    }

    const data = await response.json()
    persistAccessToken(data.access_token)
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
      throw new Error(error?.detail || t('auth.adLoginFailed'))
    }

    const data = await response.json()
    persistAccessToken(data.access_token)
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
    JSON.stringify({ detail: t('auth.backendTokenMissing') }),
    { status: 401, headers: { 'Content-Type': 'application/json' } }
  )

  const responseTemporaryAuthUnavailable = () => new Response(
    JSON.stringify({ detail: t('auth.backendSessionValidationFailed') }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  )

  const clearBackendSession = (message = t('auth.sessionExpired'), expectedToken?: string) => {
    // An in-flight request from an older session must not erase a token that
    // was issued by a login completed while that request was still running.
    if (expectedToken && localStorage.getItem('qa_access_token') !== expectedToken) return false
    setLoginError(message)
    setIsAuthenticated(false)
    localStorage.removeItem('qa_session_active')
    localStorage.removeItem('qa_session_user')
    localStorage.removeItem('qa_access_token')
    localStorage.removeItem('qa_session_expires_at')
    return true
  }

  const authHeaders = async () => {
    const token = getStoredAccessToken()
    if (!token) {
      throw new Error(t('auth.backendTokenMissing'))
    }
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  }

  const fetchWithAuth = async (url: string, options: RequestInit = {}): Promise<Response> => {
    const token = getStoredAccessToken()
    if (!token) {
      if (hasValidStoredSession()) {
        return responseTemporaryAuthUnavailable()
      }
      clearBackendSession(t('auth.sessionExpired'))
      return responseWithoutToken()
    }
    const requestWithToken = (requestToken: string) => fetch(url, {
      ...options,
      headers: withAuthHeaders(requestToken, options)
    })

    let response = await requestWithToken(token)
    if (response.status !== 401) return response

    const currentToken = localStorage.getItem('qa_access_token')
    if (currentToken !== token) {
      // A login may have completed while the old request was in flight. Retry
      // once with that new session instead of logging it out with a stale 401.
      if (!currentToken) return response
      if (isJwtExpired(currentToken)) {
        clearBackendSession(t('auth.sessionExpired'), currentToken)
        return response
      }
      response = await requestWithToken(currentToken)
      if (response.status === 401 && localStorage.getItem('qa_access_token') === currentToken) {
        clearBackendSession(t('auth.sessionExpired'), currentToken)
      }
      return response
    }

    clearBackendSession(t('auth.sessionExpired'), token)
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
        clearBackendSession(t('auth.backendTokenMissing'))
      }
      return
    }
    try {
      const response = await fetch(`${API_BASE}/users/me/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.status === 401) {
        clearBackendSession(t('auth.sessionExpired'), token)
        return
      }
      if (response.ok) {
        // Do not hydrate user data returned for a token replaced mid-request.
        if (localStorage.getItem('qa_access_token') !== token) return
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
    persistAccessToken,
    persistSession,
    syncSessionFromBackend
  }
}
