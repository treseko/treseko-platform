import { useEffect, useState } from 'react'
import { API_BASE } from '../../../app/constants'
import type { TranslationKey } from '../../../i18n'
import { normalizeLocale } from '../../../i18n/localeUtils'
import type { Locale } from '../../../i18n'
import { DEFAULT_THEME_ID } from '../../../app/themes/themeCatalog'
import { APPEARANCE_KEY, CUSTOM_THEMES_KEY, DEFAULT_APPEARANCE, PERSONAL_THEME_CONFIG_KEY, normalizeAppearance, normalizeCustomThemes, normalizeProjectTheme, type ProjectThemeSettings } from '../../../app/themes/themeCustomization'

type UseProfileSettingsParams = {
  loggedUser: any
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  onLoggedUserUpdated: (user: any) => void
  onPreferencesUpdated?: (preferences: any) => void
  showFeedback: (title: string, message: string, variant?: string) => void
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
  currentProjectId?: string | null
}

export function createLanguagePatchRequest(language: Locale): RequestInit {
  return {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language }),
  }
}

export async function persistLanguagePreference(
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>,
  language: Locale,
): Promise<any> {
  const response = await fetchWithAuth(`${API_BASE}/users/me/language`, createLanguagePatchRequest(language))
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `No se pudo guardar el idioma (${response.status})`)
  }
  return response.json()
}

const createProfileDraft = (loggedUser: any, currentProjectId?: string | null) => ({
  nombre_completo: loggedUser?.name || '',
  display_name: loggedUser?.profileSettings?.display_name || '',
  avatar_provider: loggedUser?.avatarProvider || 'gravatar',
  personal_theme: loggedUser?.personalTheme || DEFAULT_THEME_ID,
  density: loggedUser?.profileSettings?.density || 'comfortable',
  language: normalizeLocale(loggedUser?.profileSettings?.language),
  appearance: normalizeAppearance(loggedUser?.profileSettings?.[APPEARANCE_KEY]),
  custom_themes: normalizeCustomThemes(loggedUser?.profileSettings?.[CUSTOM_THEMES_KEY]),
  personal_theme_config: normalizeProjectTheme(loggedUser?.profileSettings?.[PERSONAL_THEME_CONFIG_KEY]),
  project_theme: loggedUser?.projectThemeOverrides?.[currentProjectId || '']?.schemaVersion === 1
    ? normalizeProjectTheme(loggedUser?.projectThemeOverrides?.[currentProjectId || ''])
    : null,
})

export function useProfileSettings({
  loggedUser,
  fetchWithAuth,
  onLoggedUserUpdated,
  onPreferencesUpdated,
  showFeedback,
  t,
  currentProjectId,
}: UseProfileSettingsParams) {
  const [profileDraft, setProfileDraft] = useState(() => createProfileDraft(loggedUser, currentProjectId))

  useEffect(() => {
    setProfileDraft(createProfileDraft(loggedUser, currentProjectId))
  }, [loggedUser, currentProjectId])

  const saveMyProfile = async (event: any) => {
    event.preventDefault()
    try {
      const profileResponse = await fetchWithAuth(`${API_BASE}/users/me/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre_completo: profileDraft.nombre_completo,
          display_name: profileDraft.display_name,
          avatar_provider: profileDraft.avatar_provider,
        }),
      })
      if (!profileResponse.ok) throw new Error(await profileResponse.text())
      const updatedUser = await profileResponse.json()
      const prefResponse = await fetchWithAuth(`${API_BASE}/users/me/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personal_theme: profileDraft.personal_theme,
          profile_settings: {
            display_name: profileDraft.display_name,
            [APPEARANCE_KEY]: profileDraft.appearance || DEFAULT_APPEARANCE,
            [CUSTOM_THEMES_KEY]: profileDraft.custom_themes || [],
          },
        }),
      })
      if (!prefResponse.ok) throw new Error(await prefResponse.text())
      const preferences = await prefResponse.json()
      onLoggedUserUpdated(preferences)
      showFeedback(t('configuracion.profileUpdated'), t('configuracion.profileSavedMessage'), 'success')
    } catch (error: any) {
      showFeedback(t('configuracion.profileSaveError'), error?.message || t('configuracion.profileSaveFallback'), 'danger')
    }
  }

  const saveProjectTheme = async (theme: ProjectThemeSettings) => {
    const profileSettings = {
      ...(loggedUser.profileSettings || {}),
      [PERSONAL_THEME_CONFIG_KEY]: theme,
    }
    const response = await fetchWithAuth(`${API_BASE}/users/me/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_settings: profileSettings }),
    })
    if (!response.ok) throw new Error(await response.text())
    onLoggedUserUpdated(await response.json())
    showFeedback(t('configuracion.projectThemeSaved'), t('configuracion.projectThemeSavedMessage'), 'success')
  }

  const resetProjectTheme = async () => {
    const profileSettings = { ...(loggedUser.profileSettings || {}) }
    delete profileSettings[PERSONAL_THEME_CONFIG_KEY]
    const response = await fetchWithAuth(`${API_BASE}/users/me/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_settings: profileSettings, personal_theme: DEFAULT_THEME_ID }),
    })
    if (!response.ok) throw new Error(await response.text())
    onLoggedUserUpdated(await response.json())
    showFeedback(t('configuracion.projectThemeReset'), t('configuracion.projectThemeResetMessage'), 'success')
  }

  const saveLanguage = async (language: Locale): Promise<boolean> => {
    try {
      const preferences = await persistLanguagePreference(fetchWithAuth, language)
      if (onPreferencesUpdated) onPreferencesUpdated(preferences)
      else onLoggedUserUpdated({ ...loggedUser, ...preferences })
      return true
    } catch (error: any) {
      showFeedback(t('configuracion.profileSaveError'), error?.message || t('configuracion.profileSaveFallback'), 'danger')
      return false
    }
  }

  return {
    profileDraft,
    setProfileDraft,
    saveMyProfile,
    saveLanguage,
    saveProjectTheme,
    resetProjectTheme,
  }
}
