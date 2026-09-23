import type { OrganizationPayload, OrganizationResponse } from './caseOrganization'

type FetchWithAuth = (url: string, init?: RequestInit) => Promise<Response>

type Options = { endpoint: string, fetchWithAuth: FetchWithAuth }

export const createCaseOrganizationApi = ({ endpoint, fetchWithAuth }: Options) => ({
  async organize(payload: OrganizationPayload): Promise<OrganizationResponse> {
    const response = await fetchWithAuth(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.detail || `Backend responded ${response.status}`)
    }
    return response.json()
  },
})
