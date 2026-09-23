export type OrganizationPayload = {
  caso_id: string
  suite_id: string | null
  orden: string[]
  orden_origen?: string[]
  revision: string
}

export type OrganizationResponse = {
  cases: Array<{ id: string, suite_id: string | null, orden: number, suiteId?: string | null }>
  revision: string
}

export const isCaseOrganizationAvailable = (searchQuery: string, componentId: string) => !searchQuery.trim() && !componentId

export const stopCaseDropPropagation = (event: { stopPropagation: () => void }) => event.stopPropagation()

export const organizationRevision = (cases: any[]) => {
  const rows = cases.slice().sort((a, b) => String(a.suiteId ?? a.suite_id ?? '').localeCompare(String(b.suiteId ?? b.suite_id ?? '')) || Number(a.orden ?? a.order ?? 0) - Number(b.orden ?? b.order ?? 0) || String(a.id).localeCompare(String(b.id)))
  const value = JSON.stringify(rows.map(item => [String(item.id), item.suiteId ?? item.suite_id ?? null, Number(item.orden ?? item.order ?? 0)]))
  let digest = 2166136261
  for (const char of value) { digest ^= char.charCodeAt(0); digest = Math.imul(digest, 16777619) >>> 0 }
  return digest.toString(16).padStart(8, '0')
}

const positionOf = (item: any) => Number.isFinite(Number(item?.position ?? item?.order ?? item?.orden)) ? Number(item.position ?? item.order ?? item.orden) : Number.MAX_SAFE_INTEGER

export const moveCaseInOrder = (cases: any[], caseId: string, targetSuiteId: string | null, position: number) => {
  const source = cases.find(item => String(item.id) === String(caseId))
  if (!source) return cases.slice()
  const remaining = cases.filter(item => String(item.id) !== String(caseId))
  const target = remaining.filter(item => (item.suiteId ?? item.suite_id ?? null) === targetSuiteId)
  const index = Math.max(0, Math.min(position, target.length))
  target.splice(index, 0, { ...source, suiteId: targetSuiteId })
  const targetIds = new Set(target.map(item => String(item.id)))
  let targetIndex = 0
  return remaining.map(item => targetIds.has(String(item.id)) ? target[targetIndex++] : item)
    .concat(target.slice(targetIndex))
}

export const buildOrganizationPayload = (caseId: string, targetSuiteId: string | null, _position: number, orderedCaseIds: string[], sourceCaseIds: string[] | undefined, revision: string): OrganizationPayload => ({
  caso_id: caseId,
  suite_id: targetSuiteId,
  orden: orderedCaseIds,
  ...(sourceCaseIds ? { orden_origen: sourceCaseIds } : {}),
  revision,
})

export const applyCanonicalOrganization = (current: any[], response: OrganizationResponse) => {
  const byId = new Map(current.map(item => [String(item.id), item]))
  const canonical = response.cases
    .slice()
    .sort((left, right) => positionOf(left) - positionOf(right))
    .map(item => {
      const existing = byId.get(String(item.id)) || item
      const suiteId = item.suite_id ?? item.suiteId ?? existing.suiteId ?? null
      const { suite_id: _suiteId, ...canonical } = item
      return { ...existing, ...canonical, suiteId }
    })
  const canonicalById = new Map(canonical.map(item => [String(item.id), item]))
  return canonical.concat(current.filter(item => !canonicalById.has(String(item.id))))
}

type CaseOrganizationApi = { organize: (payload: OrganizationPayload) => Promise<OrganizationResponse> }

export const createCaseOrganizationHandler = ({
  api,
  getCases,
  setCases,
}: {
  api: CaseOrganizationApi
  getCases: () => any[]
  setCases: (cases: any[]) => void
}) => async (test: any, targetSuiteId: string | null, position: number): Promise<boolean> => {
  // The backend intentionally has no null-suite target; reject the synthetic
  // root here so drag and keyboard actions cannot create a guaranteed 400.
  if (!targetSuiteId) return false
  const previous = getCases().slice()
  const sourceSuiteId = test.suiteId ?? test.suite_id ?? null
  if (!sourceSuiteId) return false
  const sourceIds = previous
    .filter(item => (item.suiteId ?? item.suite_id ?? null) === sourceSuiteId)
    .map(item => String(item.id))
  const targetIds = previous
    .filter(item => (item.suiteId ?? item.suite_id ?? null) === targetSuiteId && String(item.id) !== String(test.id))
    .map(item => String(item.id))
  targetIds.splice(Math.max(0, Math.min(position, targetIds.length)), 0, String(test.id))
  const optimistic = moveCaseInOrder(previous, String(test.id), targetSuiteId, position)
  setCases(optimistic)
  try {
    const revisionRows = previous.filter(item => {
      const suiteId = item.suiteId ?? item.suite_id ?? null
      return suiteId === sourceSuiteId || suiteId === targetSuiteId
    })
    const response = await api.organize(buildOrganizationPayload(String(test.id), targetSuiteId, position, targetIds, sourceIds, organizationRevision(revisionRows)))
    setCases(applyCanonicalOrganization(getCases(), response))
    return true
  } catch {
    setCases(previous)
    return false
  }
}
