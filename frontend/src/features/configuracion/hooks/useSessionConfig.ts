import { useEffect, useState } from 'react'
import { fetchSessionConfig, updateSessionConfig, type FetchWithAuth } from '../api/configuracionApi'
import { useI18n } from '../../../i18n'

const SESSION_CONFIG_STORAGE_KEY = 'qa_session_config'

export function readLocalSessionConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_CONFIG_STORAGE_KEY) || '{}')
    const minutes = Number(saved.session_timeout_minutes)
    if (Number.isFinite(minutes)) {
      return { session_timeout_minutes: Math.max(15, Math.min(minutes, 43200)) }
    }
  } catch {
  }
  return { session_timeout_minutes: 480 }
}

export function persistLocalSessionConfig(config: any) {
  const minutes = Math.max(15, Math.min(Number(config?.session_timeout_minutes ?? 480), 43200))
  const normalized = { session_timeout_minutes: minutes }
  localStorage.setItem(SESSION_CONFIG_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

function isAuthBootstrapError(error: any) {
  const message = String(error?.message || '')
  return (
    message.includes('No se pudo iniciar sesión en backend') ||
    message.includes('No se pudo iniciar sesión de desarrollo') ||
    message.includes('disponible en Treseko Premium') ||
    message.includes('Failed to fetch') ||
    message.includes('NetworkError') ||
    message.includes('Load failed')
  )
}

type UseSessionConfigParams = {
  isAuthenticated: boolean
  fetchWithAuth: FetchWithAuth
  showFeedback: (title: string, message: string, variant?: string) => void
  setIsAuthenticated: (authenticated: boolean) => void
  setLoginError: (message: string) => void
}

export function useSessionConfig({
  isAuthenticated,
  fetchWithAuth,
  showFeedback,
  setIsAuthenticated,
  setLoginError,
}: UseSessionConfigParams) {
  const { t } = useI18n()
  const [sessionConfig, setSessionConfig] = useState(readLocalSessionConfig)
  const [sessionConfigLoading, setSessionConfigLoading] = useState(false)

  const loadSessionConfig = async () => {
    if (!isAuthenticated) return
    setSessionConfigLoading(true)
    try {
      const config = await fetchSessionConfig(fetchWithAuth)
      const normalized = config
        ? persistLocalSessionConfig({ session_timeout_minutes: Number(config.session_timeout_minutes ?? 480) })
        : readLocalSessionConfig()
      setSessionConfig(normalized)
    } catch (error: any) {
      if (isAuthBootstrapError(error)) {
        setSessionConfig(readLocalSessionConfig())
        return
      }
      showFeedback(t('configuracion.sessionTitle'), error.message || t('configuracion.sessionLoadError'), 'danger')
    } finally {
      setSessionConfigLoading(false)
    }
  }

  const saveSessionConfig = async (config: any) => {
    setSessionConfigLoading(true)
    try {
      const saved = await updateSessionConfig(fetchWithAuth, config)
      const normalized = persistLocalSessionConfig(saved || config)
      setSessionConfig(normalized)
      showFeedback(
        t('configuracion.sessionTitle'),
        saved
          ? t('configuracion.sessionSaved')
          : t('configuracion.sessionSavedLocal'),
        'success'
      )
    } catch (error: any) {
      showFeedback(t('configuracion.sessionTitle'), error.message || t('configuracion.sessionSaveError'), 'danger')
    } finally {
      setSessionConfigLoading(false)
    }
  }

  useEffect(() => {
    if (!isAuthenticated) return
    let intervalId: number | undefined
    const closeExpiredSession = () => {
      localStorage.removeItem('qa_session_active')
      localStorage.removeItem('qa_session_user')
      localStorage.removeItem('qa_access_token')
      localStorage.removeItem('qa_session_expires_at')
      setLoginError(t('configuracion.sessionExpired'))
      setIsAuthenticated(false)
    }
    const checkSessionExpiry = () => {
      const expiresAt = localStorage.getItem('qa_session_expires_at')
      if (!expiresAt) return
      const expiresMs = Date.parse(expiresAt)
      if (Number.isFinite(expiresMs) && expiresMs <= Date.now()) {
        closeExpiredSession()
      }
    }
    checkSessionExpiry()
    intervalId = window.setInterval(checkSessionExpiry, 10_000)
    return () => {
      if (intervalId) window.clearInterval(intervalId)
    }
  }, [isAuthenticated, setIsAuthenticated, setLoginError])

  return {
    sessionConfig,
    setSessionConfig,
    sessionConfigLoading,
    loadSessionConfig,
    saveSessionConfig,
  }
}

export type SessionConfigState = ReturnType<typeof useSessionConfig>
