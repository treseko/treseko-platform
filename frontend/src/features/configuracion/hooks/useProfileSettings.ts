import { useEffect, useState } from 'react'
import { API_BASE } from '../../../app/constants'
import type { TranslationKey } from '../../../i18n'
import type { Locale } from '../../../i18n'

type UseProfileSettingsParams = {
  loggedUser: any
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  onLoggedUserUpdated: (user: any) => void
  onPreferencesUpdated?: (preferences: any) => void
  showFeedback: (title: string, message: string, variant?: string) => void
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

const createProfileDraft = (loggedUser: any) => ({
  nombre_completo: loggedUser?.name || '',
  display_name: loggedUser?.profileSettings?.display_name || '',
  avatar_provider: loggedUser?.avatarProvider || 'gravatar',
  personal_theme: loggedUser?.personalTheme || 'system',
  density: loggedUser?.profileSettings?.density || 'comfortable',
  language: loggedUser?.profileSettings?.language || 'es',
})

export function useProfileSettings({
  loggedUser,
  fetchWithAuth,
  onLoggedUserUpdated,
  onPreferencesUpdated,
  showFeedback,
  t,
}: UseProfileSettingsParams) {
  const [profileDraft, setProfileDraft] = useState(() => createProfileDraft(loggedUser))

  useEffect(() => {
    setProfileDraft(createProfileDraft(loggedUser))
  }, [loggedUser])

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
      const prefResponse = await fetchWithAuth(`${API_BASE}/users/me/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personal_theme: profileDraft.personal_theme,
          profile_settings: {
            display_name: profileDraft.display_name,
          },
        }),
      })
      if (!prefResponse.ok) throw new Error(await prefResponse.text())
      const preferences = await prefResponse.json()
      onLoggedUserUpdated({ ...updatedUser, ...preferences })
      showFeedback(t('configuracion.profileUpdated'), t('configuracion.profileSavedMessage'), 'success')
    } catch (error: any) {
      showFeedback(t('configuracion.profileSaveError'), error?.message || t('configuracion.profileSaveFallback'), 'danger')
    }
  }

  const saveLanguage = (language: Locale) => {
    void fetchWithAuth(`${API_BASE}/users/me/language`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language }),
    }).then(async (response) => {
      if (!response.ok) throw new Error(await response.text())
      const preferences = await response.json()
      if (onPreferencesUpdated) onPreferencesUpdated(preferences)
      else onLoggedUserUpdated({ ...loggedUser, ...preferences })
    }).catch((error: any) => {
      showFeedback(t('configuracion.profileSaveError'), error?.message || t('configuracion.profileSaveFallback'), 'danger')
    })
  }

  return {
    profileDraft,
    setProfileDraft,
    saveMyProfile,
    saveLanguage,
  }
}
