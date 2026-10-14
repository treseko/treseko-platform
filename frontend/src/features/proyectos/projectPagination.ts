export async function loadProjectPages(
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>,
  url: string,
  isCurrent: () => boolean = () => true,
): Promise<any[] | null> {
  const result: any[] = []
  const limit = 200
  for (let skip = 0; ; skip += limit) {
    if (!isCurrent()) return null
    const response = await fetchWithAuth(`${url}${url.includes('?') ? '&' : '?'}skip=${skip}&limit=${limit}`)
    if (!isCurrent()) return null
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.detail || `Backend respondió ${response.status}`)
    }
    const page = await response.json()
    if (!isCurrent()) return null
    if (!Array.isArray(page)) throw new Error('La respuesta del servidor no contiene un listado válido')
    result.push(...page)
    if (page.length < limit) return result
  }
}
