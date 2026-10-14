const closedStatuses = new Set(['RESUELTO', 'CERRADO', 'DUPLICADO', 'NO_REPRODUCIBLE', 'NO_CORRESPONDE'])
export function matchesReportDetailFilters(item: any, kind: 'bug' | 'failure' | 'evidence', filters: any) {
  const linked = kind === 'bug' ? [item] : kind === 'evidence' ? item.linked_bugs || [] : Array.isArray(item.bug) ? item.bug : item.bug ? [item.bug] : []
  const isOpen = (bug: any) => typeof bug.is_open === 'boolean' ? bug.is_open : !closedStatuses.has(String(bug.estado || '').toUpperCase())
  const hasEvidence = kind === 'bug' ? Boolean(item.has_evidence) : kind === 'evidence' ? item.status === 'completa' : Boolean(item.has_evidence ?? !item.flags?.sin_evidencia)
  const bugMatches = !filters.bug || (filters.bug === 'with' ? linked.length > 0 : filters.bug === 'without' ? linked.length === 0 : filters.bug === 'open' ? linked.some(isOpen) : filters.bug === 'closed' ? linked.some((bug: any) => !isOpen(bug)) : true)
  return (!filters.suite || String(item.suite || '') === filters.suite)
    && (!filters.priority || String(item.prioridad || '') === filters.priority)
    && (!filters.status || String(item.estado || item.status || '') === filters.status)
    && (!filters.owner || String(item.responsable || item.created_by || '') === filters.owner)
    && (!filters.executionMode || String(item.execution_mode || '') === filters.executionMode)
    && bugMatches && (!filters.evidence || (filters.evidence === 'with' ? hasEvidence : !hasEvidence))
}
