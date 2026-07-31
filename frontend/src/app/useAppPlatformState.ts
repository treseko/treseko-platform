import { useCallback, useEffect, useState } from 'react'
import { API_BASE } from './constants'
import { DEFAULT_BRANDING, normalizeBrandingState, type BrandingState } from './branding'
import type { ModuleId } from './types'

type PlatformStateOptions = {
  isAuthenticated: boolean
  loggedUser: any
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  t: (key: string) => string
}

export function useAppPlatformState({ isAuthenticated, loggedUser, fetchWithAuth, t }: PlatformStateOptions) {
  const [systemFeatureIds, setSystemFeatureIds] = useState<Set<string>>(new Set())
  const [systemFeaturesLoaded, setSystemFeaturesLoaded] = useState(false)
  const [systemEdition, setSystemEdition] = useState<'community' | 'premium'>('community')
  const [firstRunState, setFirstRunState] = useState<any>(null)
  const [firstRunLoaded, setFirstRunLoaded] = useState(false)
  const [branding, setBranding] = useState<BrandingState>(DEFAULT_BRANDING)

  const loadPublicBranding = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/system/branding/public`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.detail || 'No se pudo cargar branding.')
      setBranding(normalizeBrandingState(data))
    } catch {
      setBranding(DEFAULT_BRANDING)
    }
  }, [])

  useEffect(() => { void loadPublicBranding() }, [loadPublicBranding])

  useEffect(() => {
    if (!isAuthenticated) {
      setSystemFeatureIds(new Set())
      setSystemFeaturesLoaded(false)
      setSystemEdition('community')
      setFirstRunState(null)
      setFirstRunLoaded(false)
      return
    }
    let cancelled = false
    const loadSystemFeatures = () => fetchWithAuth(`${API_BASE}/system/features`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data?.detail || 'No se pudieron cargar las features del sistema.')
        return data
      })
      .then((data) => {
        if (cancelled) return
        setSystemEdition(data.edition === 'premium' ? 'premium' : 'community')
        setSystemFeatureIds(new Set((data.features || []).filter((feature: any) => feature.enabled).map((feature: any) => feature.id)))
        setSystemFeaturesLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setSystemFeatureIds(new Set())
        setSystemEdition('community')
        setSystemFeaturesLoaded(true)
      })
    void loadSystemFeatures()
    window.addEventListener('treseko:license-updated', loadSystemFeatures)
    return () => {
      cancelled = true
      window.removeEventListener('treseko:license-updated', loadSystemFeatures)
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated) {
      setFirstRunState(null)
      setFirstRunLoaded(false)
      return
    }
    let cancelled = false
    setFirstRunLoaded(false)
    fetchWithAuth(`${API_BASE}/system/first-run`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data?.detail || 'No se pudo cargar el estado inicial.')
        return data
      })
      .then((data) => {
        if (cancelled) return
        setFirstRunState(data)
        setFirstRunLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setFirstRunState({ completed: true, requires_onboarding: false, installation_has_data: true })
        setFirstRunLoaded(true)
      })
    return () => { cancelled = true }
  }, [isAuthenticated])

  const canAccessEntitledModule = useCallback((moduleId: ModuleId) => {
    if (!systemFeaturesLoaded) return true
    if (moduleId === 'motor_ia') return systemFeatureIds.has('ai.basic_execution') || systemFeatureIds.has('ai.engine')
    if (moduleId === 'redmine') return true
    return true
  }, [systemFeatureIds, systemFeaturesLoaded])

  const hasSystemFeature = useCallback((featureId: string) => systemFeatureIds.has(featureId), [systemFeatureIds])

  useEffect(() => {
    const theme = loggedUser.personalTheme || 'system'
    const density = loggedUser.profileSettings?.density || 'comfortable'
    document.documentElement.dataset.qaTheme = theme
    document.documentElement.dataset.qaDensity = density
  }, [loggedUser.personalTheme, loggedUser.profileSettings])

  return { systemFeatureIds, systemFeaturesLoaded, systemEdition, firstRunState, setFirstRunState, firstRunLoaded, branding, setBranding, canAccessEntitledModule, hasSystemFeature }
}
