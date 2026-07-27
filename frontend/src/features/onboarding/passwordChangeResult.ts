export function applyPasswordChangeResult(
  data: any,
  onAccessTokenRefreshed: (accessToken: string) => void,
  onPreferencesUpdated: (preferences: any) => void
) {
  if (typeof data?.access_token !== 'string' || !data.access_token) {
    throw new Error('La contraseña cambió, pero no se pudo renovar la sesión. Inicia sesión nuevamente.')
  }
  onAccessTokenRefreshed(data.access_token)
  onPreferencesUpdated(data)
}
