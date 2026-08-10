import { API_BASE } from '../../../app/constants'
import { readBackendError } from '../../../app/errorMessages'

export type FetchWithAuth = (url: string, options?: RequestInit) => Promise<Response>

async function readJsonOrThrow(response: Response, fallback: string) {
  if (response.ok) return response.json()
  throw new Error(await readBackendError(response, fallback))
}

export async function fetchAttachmentConfig(fetchWithAuth: FetchWithAuth) {
  const response = await fetchWithAuth(`${API_BASE}/attachments/config/`)
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function updateAttachmentConfig(fetchWithAuth: FetchWithAuth, config: any) {
  const response = await fetchWithAuth(`${API_BASE}/attachments/config/`, {
    method: 'PATCH',
    body: JSON.stringify(config),
  })
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function fetchEvidenceSanitizationPolicy(fetchWithAuth: FetchWithAuth) {
  const response = await fetchWithAuth(`${API_BASE}/system/evidence-sanitization-policy`)
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function updateEvidenceSanitizationPolicy(fetchWithAuth: FetchWithAuth, policy: { sanitization_enabled?: boolean, traceability_complete_enabled?: boolean }) {
  const response = await fetchWithAuth(`${API_BASE}/system/evidence-sanitization-policy`, {
    method: 'PATCH',
    body: JSON.stringify(policy),
  })
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function fetchUserApiKeys(fetchWithAuth: FetchWithAuth) {
  const response = await fetchWithAuth(`${API_BASE}/users/me/api-keys/`)
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function createUserApiKey(fetchWithAuth: FetchWithAuth, nombre: string) {
  const response = await fetchWithAuth(`${API_BASE}/users/me/api-keys/`, {
    method: 'POST',
    body: JSON.stringify({ nombre }),
  })
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function revokeUserApiKey(fetchWithAuth: FetchWithAuth, apiKeyId: string) {
  const response = await fetchWithAuth(`${API_BASE}/users/me/api-keys/${apiKeyId}/`, { method: 'DELETE' })
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function fetchAiEngineConfig(fetchWithAuth: FetchWithAuth) {
  const response = await fetchWithAuth(`${API_BASE}/ai-engine/config`)
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function updateAiEngineConfig(fetchWithAuth: FetchWithAuth, config: any) {
  const response = await fetchWithAuth(`${API_BASE}/ai-engine/config`, {
    method: 'PUT',
    body: JSON.stringify(config),
  })
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function fetchAiEngineHealth(fetchWithAuth: FetchWithAuth) {
  const response = await fetchWithAuth(`${API_BASE}/ai-engine/health`)
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function fetchAiProviderProfiles(fetchWithAuth: FetchWithAuth) {
  return readJsonOrThrow(await fetchWithAuth(`${API_BASE}/ai-provider-profiles/`), 'No se pudieron cargar los perfiles IA')
}

export async function fetchAiProviderCredentials(fetchWithAuth: FetchWithAuth) {
  return readJsonOrThrow(await fetchWithAuth(`${API_BASE}/ai-provider-credentials/`), 'No se pudieron cargar las credenciales IA')
}

export async function createAiProviderCredential(fetchWithAuth: FetchWithAuth, payload: any) {
  return readJsonOrThrow(await fetchWithAuth(`${API_BASE}/ai-provider-credentials/`, { method: 'POST', body: JSON.stringify(payload) }), 'No se pudo guardar la credencial IA')
}

export async function replaceAiProviderCredential(fetchWithAuth: FetchWithAuth, credentialId: string, secret: string) {
  return readJsonOrThrow(await fetchWithAuth(`${API_BASE}/ai-provider-credentials/${credentialId}`, { method: 'PUT', body: JSON.stringify({ secret }) }), 'No se pudo actualizar la credencial IA')
}

export async function updateAiProviderCredential(fetchWithAuth: FetchWithAuth, credentialId: string, payload: { label: string }) {
  return readJsonOrThrow(await fetchWithAuth(`${API_BASE}/ai-provider-credentials/${credentialId}`, { method: 'PATCH', body: JSON.stringify(payload) }), 'No se pudo actualizar la etiqueta de la credencial IA')
}

export async function disableAiProviderCredential(fetchWithAuth: FetchWithAuth, credentialId: string) {
  return readJsonOrThrow(await fetchWithAuth(`${API_BASE}/ai-provider-credentials/${credentialId}`, { method: 'DELETE' }), 'No se pudo deshabilitar la credencial IA')
}

export async function createAiProviderProfile(fetchWithAuth: FetchWithAuth, payload: any) {
  return readJsonOrThrow(await fetchWithAuth(`${API_BASE}/ai-provider-profiles/`, { method: 'POST', body: JSON.stringify(payload) }), 'No se pudo crear el perfil IA')
}

export async function disableAiProviderProfile(fetchWithAuth: FetchWithAuth, profileId: string) {
  return readJsonOrThrow(await fetchWithAuth(`${API_BASE}/ai-provider-profiles/${profileId}`, { method: 'DELETE' }), 'No se pudo deshabilitar el perfil IA')
}

export async function updateAiProviderProfile(fetchWithAuth: FetchWithAuth, profileId: string, payload: any) {
  return readJsonOrThrow(await fetchWithAuth(`${API_BASE}/ai-provider-profiles/${profileId}`, { method: 'PATCH', body: JSON.stringify(payload) }), 'No se pudo actualizar el perfil IA')
}

export async function activateAiProviderProfile(fetchWithAuth: FetchWithAuth, profileId: string) {
  return readJsonOrThrow(await fetchWithAuth(`${API_BASE}/ai-provider-profiles/${profileId}/activate`, { method: 'POST' }), 'No se pudo activar el perfil IA')
}

export async function testAiProviderProfile(fetchWithAuth: FetchWithAuth, profileId: string) {
  return readJsonOrThrow(await fetchWithAuth(`${API_BASE}/ai-provider-profiles/${profileId}/test`, { method: 'POST' }), 'La prueba del perfil IA falló')
}

export async function migrateLegacyAiProviderCredentials(fetchWithAuth: FetchWithAuth) {
  return readJsonOrThrow(await fetchWithAuth(`${API_BASE}/ai-provider-credentials/migrate-legacy`, { method: 'POST' }), 'No se pudieron migrar las claves antiguas')
}

export type SystemMonitorComponent = {
  id: string
  name: string
  type: string
  version?: string | null
  target?: string | null
  status: string
  latency_ms?: number | null
  detail?: string | null
  restart_hint?: string | null
  checked_at: string
}

export type SystemMonitorWorker = {
  runner_id: string
  name: string
  type: string
  status: string
  active: boolean
  last_heartbeat?: string | null
  hostname?: string | null
  local_ips: string[]
  pid?: number | null
  tags: string[]
  capabilities: Record<string, any>
  resources: Record<string, any>
  active_jobs: number
  current_job_id?: string | null
  uptime_seconds?: number | null
  version?: string | null
}

export type SystemMonitorSummary = {
  overall_status: string
  uptime_percent: number
  components: SystemMonitorComponent[]
  workers: SystemMonitorWorker[]
  restart_hints: Record<string, string>
  checked_at: string
}

export type SystemVersionInfo = {
  product: string
  version: string
  edition_base?: string
  release_channel?: string
  community_release_tag?: string
  database_revision?: string | null
}

export async function fetchSystemMonitorSummary(fetchWithAuth: FetchWithAuth): Promise<SystemMonitorSummary> {
  const response = await fetchWithAuth(`${API_BASE}/system-monitor/summary`)
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function fetchSystemVersion(fetchWithAuth: FetchWithAuth): Promise<SystemVersionInfo> {
  const response = await fetchWithAuth(`${API_BASE}/system/version`)
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function fetchSystemUpdateChannels(fetchWithAuth: FetchWithAuth) {
  const response = await fetchWithAuth(`${API_BASE}/system/updates/channels`)
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function checkCommunityUpdate(fetchWithAuth: FetchWithAuth) {
  const response = await fetchWithAuth(`${API_BASE}/system/updates/check-community?force=true`)
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function fetchLatestSystemUpdate(fetchWithAuth: FetchWithAuth) {
  const response = await fetchWithAuth(`${API_BASE}/system/updates/latest`)
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function syncPremiumSystemUpdate(fetchWithAuth: FetchWithAuth) {
  const response = await fetchWithAuth(`${API_BASE}/system/updates/sync-premium`, {
    method: 'POST',
  })
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function fetchSystemUpdateStatus(fetchWithAuth: FetchWithAuth, taskId?: string) {
  const suffix = taskId ? `/${encodeURIComponent(taskId)}` : ''
  const response = await fetchWithAuth(`${API_BASE}/system/updates/status${suffix}`)
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function fetchSystemUpdateHistory(fetchWithAuth: FetchWithAuth, limit = 10) {
  const response = await fetchWithAuth(`${API_BASE}/system/updates/history?limit=${encodeURIComponent(String(limit))}`)
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function applySystemUpdate(fetchWithAuth: FetchWithAuth, payload: { channel: string, manifest?: any, force?: boolean, confirmation?: string }) {
  const response = await fetchWithAuth(`${API_BASE}/system/updates/apply`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function restartPreparedSystemUpdate(fetchWithAuth: FetchWithAuth, taskId: string) {
  const response = await fetchWithAuth(`${API_BASE}/system/updates/restart/${encodeURIComponent(taskId)}`, {
    method: 'POST',
  })
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function rollbackSystemUpdate(fetchWithAuth: FetchWithAuth, taskId: string) {
  const response = await fetchWithAuth(`${API_BASE}/system/updates/rollback/${encodeURIComponent(taskId)}`, {
    method: 'POST',
  })
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function reportSystemUpdateFailure(fetchWithAuth: FetchWithAuth, taskId: string) {
  const response = await fetchWithAuth(`${API_BASE}/system/updates/report-failure/${encodeURIComponent(taskId)}`, {
    method: 'POST',
  })
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function fetchSessionConfig(fetchWithAuth: FetchWithAuth) {
  const response = await fetchWithAuth(`${API_BASE}/auth/session-config`)
  if (response.status === 404) return null
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function updateSessionConfig(fetchWithAuth: FetchWithAuth, config: any) {
  const response = await fetchWithAuth(`${API_BASE}/auth/session-config`, {
    method: 'PUT',
    body: JSON.stringify({
      session_timeout_minutes: Number(config.session_timeout_minutes ?? 480),
    }),
  })
  if (response.status === 404) return null
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}
