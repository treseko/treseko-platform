import { API_BASE } from '../../../app/constants'

export type FetchWithAuth = (url: string, options?: RequestInit) => Promise<Response>

async function readJsonOrThrow(response: Response, fallback: string) {
  if (response.ok) return response.json()
  const error = await response.json().catch(() => null)
  throw new Error(error?.detail || error?.message || fallback)
}

export async function fetchProjectRunHistory(fetchWithAuth: FetchWithAuth, projectId: string, params: URLSearchParams) {
  const response = await fetchWithAuth(`${API_BASE}/proyectos/${projectId}/test-runs/?${params.toString()}`)
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

export async function fetchTestRunDetail(fetchWithAuth: FetchWithAuth, runId: string) {
  const response = await fetchWithAuth(`${API_BASE}/test-runs/${runId}/detalle/`)
  return readJsonOrThrow(response, `Backend respondio ${response.status}`)
}

