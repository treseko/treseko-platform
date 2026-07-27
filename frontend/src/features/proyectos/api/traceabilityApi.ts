import { API_BASE } from "../../../app/constants";

export async function traceabilityJson(fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>, path: string, options?: RequestInit) {
  const response = await fetchWithAuth(`${API_BASE}${path}`, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.detail || payload?.error || `Backend respondió ${response.status}`);
  return payload;
}
