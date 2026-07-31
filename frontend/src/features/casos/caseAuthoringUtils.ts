const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function uuidOrNull(value: any) {
  const text = String(value || '')
  return UUID_RE.test(text) ? text : null
}

export function suiteBreadcrumb(suites: any[], suiteId: string): string {
  const walk = (nodes: any[], path: string[]): string[] | null => {
    for (const suite of nodes) {
      const nextPath = [...path, suite.nombre]
      if (suite.id === suiteId) return nextPath
      const childPath = walk(suite.children || [], nextPath)
      if (childPath) return childPath
    }
    return null
  }
  return walk(suites, [])?.join(' / ') || 'Sin carpeta seleccionada'
}
