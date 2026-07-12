import { memo, useMemo, useState, useCallback } from 'react'
import { Button, Form } from 'react-bootstrap'
import { ChevronDown, ChevronRight, Folders, FileText, Search } from 'lucide-react'

type BuildCaseSelectorProps = {
  suitesTree: any[]
  casosList: any[]
  componentId: string | null
  selectedCaseIds: string[]
  onSelectionChange: (ids: string[]) => void
  searchQuery?: string
  onSearchChange?: (q: string) => void
  lockedCaseIds?: string[]
}

type SuiteNodeProps = {
  suite: any
  level: number
  allCases: any[]
  selectedIds: Set<string>
  expandedSuites: Record<string, boolean>
  onToggleExpand: (suiteId: string) => void
  onToggleSuite: (suiteCaseIds: string[]) => void
  onToggleCase: (caseId: string) => void
  searchQuery: string
  lockedIds: Set<string>
}

const getSuiteCaseIds = (suite: any, casosList: any[]): string[] => {
  const ids: string[] = []
  const directCases = casosList.filter(c => c.suiteId === suite.id)
  ids.push(...directCases.map(c => c.id))
  if (suite.children && suite.children.length > 0) {
    for (const child of suite.children) {
      ids.push(...getSuiteCaseIds(child, casosList))
    }
  }
  return ids
}

const SuiteNode = memo(({
  suite,
  level,
  allCases,
  selectedIds,
  expandedSuites,
  onToggleExpand,
  onToggleSuite,
  onToggleCase,
  searchQuery,
  lockedIds
}: SuiteNodeProps) => {
  const isExpanded = expandedSuites[suite.id]

  const suiteCaseIds = useMemo(() =>
    getSuiteCaseIds(suite, allCases),
    [suite, allCases]
  )

  if (suiteCaseIds.length === 0) return null

  const checkedCount = suiteCaseIds.filter(id => selectedIds.has(id)).length
  const isAllChecked = checkedCount === suiteCaseIds.length
  const isIndeterminate = checkedCount > 0 && checkedCount < suiteCaseIds.length
  const lockCount = suiteCaseIds.filter(id => lockedIds.has(id)).length

  const directCases = allCases.filter(c => c.suiteId === suite.id)

  const query = searchQuery.trim().toLowerCase()

  const suiteMatchesQuery = query && suite.nombre.toLowerCase().includes(query)
  const hasMatchingCases = !query || directCases.some(c =>
    c.title.toLowerCase().includes(query) ||
    c.id.toLowerCase().includes(query) ||
    (c.code || '').toLowerCase().includes(query)
  )
  const childrenMatchQuery = suite.children?.some((child: any) => {
    const childCases = getSuiteCaseIds(child, allCases)
    if (childCases.length === 0) return false
    if (!query) return true
    if (child.nombre.toLowerCase().includes(query)) return true
    const childDirectCases = allCases.filter(c => c.suiteId === child.id)
    return childDirectCases.some(c =>
      c.title.toLowerCase().includes(query) ||
      c.id.toLowerCase().includes(query) ||
      (c.code || '').toLowerCase().includes(query)
    )
  })

  if (query && !suiteMatchesQuery && !hasMatchingCases && !childrenMatchQuery) return null

  const showCases = isExpanded || !!query
  const suiteColor = suite.color || '#F1F5F9'

  return (
    <div className="mb-1">
      <div
        className="p-2 rounded-3 d-flex align-items-center gap-2 border border-transparent"
        style={{ marginLeft: level * 16, minHeight: '38px', background: suiteColor, cursor: 'pointer' }}
        onClick={() => onToggleExpand(suite.id)}
      >
        <span className="flex-shrink-0 d-flex align-items-center justify-content-center" style={{ width: '16px' }}>
          {suite.children && suite.children.length > 0 ? (
            isExpanded ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />
          ) : (
            <div style={{ width: '14px' }} />
          )}
        </span>

        <input
          type="checkbox"
          className="form-check-input flex-shrink-0 m-0"
          style={{ cursor: 'pointer' }}
          checked={isAllChecked}
          ref={el => { if (el) el.indeterminate = isIndeterminate }}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleSuite(suiteCaseIds)}
        />

        <Folders size={16} className="flex-shrink-0 text-warning" />
        <span className="small text-truncate flex-grow-1 text-dark" style={{ fontSize: '0.85rem' }}>{suite.nombre}</span>
        {lockCount > 0 && (
          <span className="badge bg-success-subtle text-success border border-success-subtle x-small fw-semibold flex-shrink-0">
            {lockCount} ejecutados
          </span>
        )}
        <span className="badge bg-light text-dark border x-small fw-semibold flex-shrink-0">
          {checkedCount}/{suiteCaseIds.length}
        </span>
      </div>

      {isExpanded && suite.children && suite.children.length > 0 && (
        <div className="mt-1 border-start ms-3 ps-2 border-light-subtle">
          {suite.children.map((child: any) => (
            <SuiteNode
              key={child.id}
              suite={child}
              level={level + 1}
              allCases={allCases}
              selectedIds={selectedIds}
              expandedSuites={expandedSuites}
              onToggleExpand={onToggleExpand}
              onToggleSuite={onToggleSuite}
              onToggleCase={onToggleCase}
              searchQuery={searchQuery}
              lockedIds={lockedIds}
            />
          ))}
        </div>
      )}

      {showCases && directCases.length > 0 && (
        <div className="mt-1 d-flex flex-column gap-1" style={{ marginLeft: (level * 16) + 44 }}>
          {directCases
            .filter(c => !query || c.title.toLowerCase().includes(query) || c.id.toLowerCase().includes(query) || (c.code || '').toLowerCase().includes(query))
            .map(test => {
              const locked = lockedIds.has(test.id)
              return (
            <div
              key={test.id}
              className="py-1 px-2 rounded-2 d-flex align-items-center gap-2 border"
              style={{ minHeight: '28px', background: locked ? '#F8FAFC' : '#FFFFFF', borderColor: locked ? '#CBD5E1' : '#E9ECEF' }}
              title={locked ? 'Caso ya ejecutado en esta build. No se puede quitar.' : test.title}
            >
              <input
                type="checkbox"
                className="form-check-input flex-shrink-0 m-0"
                style={{ cursor: locked ? 'not-allowed' : 'pointer' }}
                checked={selectedIds.has(test.id)}
                disabled={locked}
                onChange={() => onToggleCase(test.id)}
              />
              <FileText size={12} className="flex-shrink-0 text-muted" />
              <span className="font-monospace x-small fw-bold text-secondary flex-shrink-0">{test.code || test.id.slice(0, 8).toUpperCase()}</span>
              <span className="x-small text-truncate flex-grow-1 text-dark">{test.title}</span>
              {locked && <span className="badge bg-success-subtle text-success border border-success-subtle x-small flex-shrink-0">Ejecutado</span>}
            </div>
          )})}
        </div>
      )}
    </div>
  )
})

SuiteNode.displayName = 'SuiteNode'

export const BuildCaseSelector = memo(({
  suitesTree,
  casosList,
  componentId,
  selectedCaseIds,
  onSelectionChange,
  searchQuery = '',
  onSearchChange,
  lockedCaseIds = []
}: BuildCaseSelectorProps) => {
  const selectedIds = useMemo(() => new Set(selectedCaseIds), [selectedCaseIds])
  const lockedIds = useMemo(() => new Set(lockedCaseIds), [lockedCaseIds])

  const filteredCases = useMemo(() =>
    casosList.filter(c =>
      (!componentId || c.componentId === componentId) &&
      c.caseStatus !== 'DEPRECADO' &&
      c.caseStatus !== 'ARCHIVADO'
    ),
    [casosList, componentId]
  )

  const [expandedSuites, setExpandedSuites] = useState<Record<string, boolean>>({})
  const allExpanded = useMemo(() => {
    const result: Record<string, boolean> = {}
    const expandAll = (suites: any[]) => {
      for (const s of suites) {
        result[s.id] = true
        if (s.children) expandAll(s.children)
      }
    }
    expandAll(suitesTree)
    return result
  }, [suitesTree])

  const effectiveExpanded = useMemo(() => {
    const hasAny = Object.values(expandedSuites).some(v => v)
    return hasAny ? expandedSuites : allExpanded
  }, [expandedSuites, allExpanded])

  const handleToggleExpand = useCallback((suiteId: string) => {
    setExpandedSuites(prev => {
      const hasAny = Object.values(prev).some(v => v)
      const current = hasAny ? prev : allExpanded
      return { ...current, [suiteId]: !current[suiteId] }
    })
  }, [allExpanded])

  const handleToggleSuite = useCallback((suiteCaseIds: string[]) => {
    const editableIds = suiteCaseIds.filter(id => !lockedIds.has(id))
    const lockedSelectedIds = selectedCaseIds.filter(id => lockedIds.has(id))
    const allSelected = editableIds.length > 0 && editableIds.every(id => selectedIds.has(id))
    if (allSelected) {
      onSelectionChange([...new Set([...lockedSelectedIds, ...selectedCaseIds.filter(id => !editableIds.includes(id))])])
    } else {
      const newIds = [...new Set([...selectedCaseIds, ...editableIds])]
      onSelectionChange(newIds)
    }
  }, [lockedIds, selectedIds, selectedCaseIds, onSelectionChange])

  const handleToggleCase = useCallback((caseId: string) => {
    if (lockedIds.has(caseId)) return
    if (selectedIds.has(caseId)) {
      onSelectionChange(selectedCaseIds.filter(id => id !== caseId))
    } else {
      onSelectionChange([...selectedCaseIds, caseId])
    }
  }, [lockedIds, selectedIds, selectedCaseIds, onSelectionChange])

  const totalCases = filteredCases.length
  const selectedCount = selectedCaseIds.length

  return (
    <div>
      {onSearchChange && (
        <div className="mb-2">
          <div className="input-group input-group-sm">
            <span className="input-group-text bg-white border-end-0"><Search size={14} className="text-muted" /></span>
            <Form.Control
              placeholder="Buscar suite o caso..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="border-start-0 bg-white"
            />
            {searchQuery && (
              <button className="btn btn-outline-secondary border-start-0 bg-white" onClick={() => onSearchChange('')}>
                &times;
              </button>
            )}
          </div>
        </div>
      )}
      <div className="d-flex justify-content-between align-items-center mb-2">
        <span className="x-small text-muted">{selectedCount} de {totalCases} casos seleccionados</span>
        <div className="d-flex gap-1">
          <Button
            variant="link"
            size="sm"
            className="p-0 x-small text-decoration-none shadow-none"
            onClick={() => {
              const allIds = filteredCases.map(c => c.id)
              onSelectionChange([...new Set([...selectedCaseIds, ...allIds])])
            }}
          >
            Seleccionar todos
          </Button>
          <span className="x-small text-muted">|</span>
          <Button
            variant="link"
            size="sm"
            className="p-0 x-small text-decoration-none shadow-none"
            onClick={() => onSelectionChange(selectedCaseIds.filter(id => lockedIds.has(id)))}
          >
            Limpiar
          </Button>
        </div>
      </div>
      <div className="border rounded-3 overflow-auto p-2" style={{ maxHeight: '420px' }}>
        {suitesTree.length === 0 ? (
          <div className="text-center text-muted small py-4">
            No hay suites disponibles.
          </div>
        ) : (
          suitesTree.map(suite => (
            <SuiteNode
              key={suite.id}
              suite={suite}
              level={0}
              allCases={filteredCases}
              selectedIds={selectedIds}
              expandedSuites={effectiveExpanded}
              onToggleExpand={handleToggleExpand}
              onToggleSuite={handleToggleSuite}
              onToggleCase={handleToggleCase}
              searchQuery={searchQuery}
              lockedIds={lockedIds}
            />
          ))
        )}
      </div>
    </div>
  )
})

BuildCaseSelector.displayName = 'BuildCaseSelector'
