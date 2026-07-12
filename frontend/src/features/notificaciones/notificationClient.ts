import { API_BASE } from '../../app/constants'

export type FetchWithAuth = (url: string, options?: any) => Promise<Response>

async function jsonOrThrow(response: Response) {
  if (!response.ok) throw new Error(await response.text())
  return response.json()
}

export const notificationClient = {
  getEmailConfig: async (fetchWithAuth: FetchWithAuth) =>
    jsonOrThrow(await fetchWithAuth(`${API_BASE}/notifications/email/config/`)),
  saveEmailConfig: async (fetchWithAuth: FetchWithAuth, config: any) =>
    jsonOrThrow(await fetchWithAuth(`${API_BASE}/notifications/email/config/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })),
  sendTestEmail: async (fetchWithAuth: FetchWithAuth, to: string) =>
    jsonOrThrow(await fetchWithAuth(`${API_BASE}/notifications/email/test/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to }),
    })),
  listTemplates: async (fetchWithAuth: FetchWithAuth) =>
    jsonOrThrow(await fetchWithAuth(`${API_BASE}/notifications/templates/`)),
  saveTemplate: async (fetchWithAuth: FetchWithAuth, templateId: string, payload: any) =>
    jsonOrThrow(await fetchWithAuth(`${API_BASE}/notifications/templates/${templateId}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })),
  listRules: async (fetchWithAuth: FetchWithAuth) =>
    jsonOrThrow(await fetchWithAuth(`${API_BASE}/notifications/rules/`)),
  createRule: async (fetchWithAuth: FetchWithAuth, payload: any) =>
    jsonOrThrow(await fetchWithAuth(`${API_BASE}/notifications/rules/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })),
  saveRule: async (fetchWithAuth: FetchWithAuth, ruleId: string, payload: any) =>
    jsonOrThrow(await fetchWithAuth(`${API_BASE}/notifications/rules/${ruleId}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })),
  deleteRule: async (fetchWithAuth: FetchWithAuth, ruleId: string) =>
    jsonOrThrow(await fetchWithAuth(`${API_BASE}/notifications/rules/${ruleId}/`, { method: 'DELETE' })),
  listDeliveries: async (fetchWithAuth: FetchWithAuth, limit = 10) =>
    jsonOrThrow(await fetchWithAuth(`${API_BASE}/notifications/deliveries/?limit=${limit}`)),
  retryDelivery: async (fetchWithAuth: FetchWithAuth, deliveryId: string) =>
    jsonOrThrow(await fetchWithAuth(`${API_BASE}/notifications/deliveries/${deliveryId}/retry/`, { method: 'POST' })),
  processOutbox: async (fetchWithAuth: FetchWithAuth) =>
    jsonOrThrow(await fetchWithAuth(`${API_BASE}/notifications/process/`, { method: 'POST' })),
  listPreferences: async (fetchWithAuth: FetchWithAuth) =>
    jsonOrThrow(await fetchWithAuth(`${API_BASE}/users/me/notification-preferences/`)),
  savePreferences: async (fetchWithAuth: FetchWithAuth, preferences: any[]) =>
    jsonOrThrow(await fetchWithAuth(`${API_BASE}/users/me/notification-preferences/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preferences),
    })),
  listInbox: async (fetchWithAuth: FetchWithAuth, limit = 10) =>
    jsonOrThrow(await fetchWithAuth(`${API_BASE}/notifications/inbox/?limit=${limit}`)),
  markInboxRead: async (fetchWithAuth: FetchWithAuth, itemId: string) =>
    jsonOrThrow(await fetchWithAuth(`${API_BASE}/notifications/inbox/${itemId}/read/`, { method: 'POST' })),
  markAllInboxRead: async (fetchWithAuth: FetchWithAuth) =>
    jsonOrThrow(await fetchWithAuth(`${API_BASE}/notifications/inbox/read-all/`, { method: 'POST' })),
}
