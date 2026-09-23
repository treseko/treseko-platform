import { memo, useMemo, useState, type CSSProperties } from 'react'
import { Button, Dropdown } from 'react-bootstrap'
import { Archive, ArrowDown, ArrowUp, Bug, ChevronDown, ChevronRight, ClipboardCopy, Database, Edit, FileCheck2, FolderCheck, FolderPlus, Folders, Globe2, History, LockKeyhole, MoreVertical, MoveRight, RotateCcw, Search, Settings, ShieldCheck, Smartphone, Trash2, Zap } from 'lucide-react'
import { compareSuitesByOrder, compareTestsBySuiteOrder } from './testOrdering'
import { UNSUITED_CASES_ROOT_ID } from './testRepositoryUtils'
import { useI18n } from './i18n'
import { caseCreationFormats, caseFormatPresentation, normalizeCaseFormat, type CaseFormat } from './features/casos/caseFormat'
import { stopCaseDropPropagation } from './features/casos/caseOrganization'

type SuiteTreeProps = {
  suites: any[]
  expandedSuites: Record<string, boolean>
  selectedSuiteId: string
  selectedSubSuiteId: string | null
  selectedTest: any
  casosList: any[]
  organizationCases?: any[]
  currentCompId: string
  testSearchQuery: string
  onSelectSuite: (suiteId: string) => void
  onToggleSuite: (suiteId: string) => void
  onCreateCase: (suiteId: string, format?: CaseFormat) => void
  onCreateSuite: (parentId: string) => void
  onEditSuite: (suite: any) => void
  onCloneSuite?: (suite: any) => void
  onMoveSuite?: (suite: any) => void
  onArchiveSuite?: (suite: any) => void
  onRestoreSuite?: (suite: any) => void
  onDeleteSuite: (suiteId: string) => void
  onSelectTest: (test: any, suiteId: string) => void
  onEditCase: (test: any) => void
  onCloneCase?: (test: any) => void
  onMoveCase?: (test: any) => void
  onOrganizeCase?: (test: any, targetSuiteId: string | null, position: number) => Promise<boolean | void> | boolean | void
  onAnnounce?: (message: string) => void
  onArchiveCase?: (test: any) => void
  onRestoreCase?: (test: any) => void
  onViewVersions?: (test: any) => void
  onDeleteCase: (caseId: string) => void
  showActions?: boolean
  showMetrics?: boolean
  getSuiteMetrics?: (suiteId: string) => { total: number, passed: number, failed: number, blocked: number, pending: number }
  openTestDropdown?: string | null
  onToggleTestDropdown?: (id: string | null) => void
  openSuiteDropdown?: string | null
  onToggleSuiteDropdown?: (id: string | null) => void
}

const collectSuiteIds = (suite: any, visited = new Set<string>()): string[] => {
  if (!suite?.id || visited.has(suite.id)) return []
  visited.add(suite.id)
  const children = suite.children || []
  return [suite.id, ...children.flatMap((child: any) => collectSuiteIds(child, visited))]
}

const naturalCompare = (left: any, right: any) =>
  String(left || '').localeCompare(String(right || ''), undefined, {
    numeric: true,
    sensitivity: 'base'
  })

const compareSuitesByName = compareSuitesByOrder

const normalizeForSearch = (value: unknown) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase()

const testMatchesQuery = (test: any, query: string) => {
  if (!query) return true
  return [
    test?.title,
    test?.id,
    test?.code,
    ...(test?.tags || [])
  ].some((value) => normalizeForSearch(value).includes(query))
}

const suiteMatchesQuery = (suite: any, props: SuiteTreeProps, query: string, visited = new Set<string>()): boolean => {
  if (!suite?.id || visited.has(suite.id)) return false
  const nextVisited = new Set(visited)
  nextVisited.add(suite.id)
  if (normalizeForSearch(suite.nombre || suite.name).includes(query)) return true
  const isUnsuitedRoot = suite.id === UNSUITED_CASES_ROOT_ID
  const hasMatchingCase = props.casosList.some((test) =>
    (isUnsuitedRoot ? !test?.suiteId : test?.suiteId === suite.id)
    && (!props.currentCompId || test?.componentId === props.currentCompId)
    && testMatchesQuery(test, query)
  )
  return hasMatchingCase || (suite.children || []).some((child: any) => suiteMatchesQuery(child, props, query, nextVisited))
}

const formatCaseCount = (count: number, t: (key: any, params?: any) => string) => t('common.caseCount', { count, label: t(count === 1 ? 'common.caseSingular' : 'common.casePlural') })

const formatSuiteCount = (count: number, t: (key: any, params?: any) => string) => t('common.suiteCount', { count, label: t(count === 1 ? 'common.suiteSingular' : 'common.suitePlural') })

const suiteIconMap: Record<string, any> = {
  folder: Folders,
  'folder-check': FolderCheck,
  'file-check': FileCheck2,
  shield: ShieldCheck,
  bug: Bug,
  search: Search,
  globe: Globe2,
  smartphone: Smartphone,
  database: Database,
  lock: LockKeyhole,
  zap: Zap,
  settings: Settings,
}

const suiteIconColor = (color: string) => {
  const normalized = String(color || '').trim().toUpperCase()
  if (normalized === '#F1F5F9' || normalized === '#F8FAFC' || normalized === '#E5E7EB' || normalized === '#E2E8F0') return '#64748B'
  if (normalized.startsWith('#DBEA') || normalized.startsWith('#E0F2') || normalized.startsWith('#CFFA')) return '#0D6EFD'
  if (normalized.startsWith('#DCF') || normalized.startsWith('#ECF') || normalized.startsWith('#CCF')) return '#198754'
  if (normalized.startsWith('#FEE') || normalized.startsWith('#FFE')) return '#DC3545'
  if (normalized.startsWith('#FEF') || normalized.startsWith('#FFED')) return '#B7791F'
  if (normalized.startsWith('#EDE') || normalized.startsWith('#F3E')) return '#6F42C1'
  if (/^#[0-9A-F]{6}$/.test(normalized)) return normalized
  return '#64748B'
}

const SuiteTreeNode = ({
  suite,
  level,
  props,
  visited = new Set<string>()
}: {
  suite: any
  level: number
  props: SuiteTreeProps
  visited?: Set<string>
}) => {
  const { t } = useI18n()
  const [dragOverCase, setDragOverCase] = useState<{ id: string, after: boolean } | null>(null)
  const [dragOverSuite, setDragOverSuite] = useState(false)
  if (!suite?.id || visited.has(suite.id)) return null
  const isUnsuitedRoot = suite.id === UNSUITED_CASES_ROOT_ID
  const childVisited = new Set(visited)
  childVisited.add(suite.id)
  const {
    expandedSuites,
    selectedSuiteId,
    selectedSubSuiteId,
    selectedTest,
    casosList,
    organizationCases,
    currentCompId,
    testSearchQuery,
    onSelectSuite,
    onToggleSuite,
    onCreateCase,
    onCreateSuite,
    onEditSuite,
    onCloneSuite,
    onMoveSuite,
    onArchiveSuite,
    onRestoreSuite,
    onDeleteSuite,
    onSelectTest,
    onEditCase,
    onCloneCase,
    onMoveCase,
    onArchiveCase,
    onOrganizeCase,
    onAnnounce,
    onRestoreCase,
    onViewVersions,
    onDeleteCase,
    showActions = true,
    showMetrics = false,
    getSuiteMetrics,
    openTestDropdown,
    onToggleTestDropdown,
    openSuiteDropdown,
    onToggleSuiteDropdown
  } = props
  const query = normalizeForSearch(testSearchQuery.trim())
  // Una búsqueda debe revelar el camino hasta el resultado, incluso si la carpeta
  // estaba contraída. El estado persistido se conserva cuando se limpia la búsqueda.
  const isExpanded = query !== '' || (isUnsuitedRoot ? expandedSuites[suite.id] !== false : expandedSuites[suite.id])
  const isSelected = selectedSuiteId === suite.id || selectedSubSuiteId === suite.id
  const suiteTests = casosList
    .filter(test => isUnsuitedRoot ? !test.suiteId : test.suiteId === suite.id)
    .filter(test => !currentCompId || test.componentId === currentCompId)
    .filter(test => testMatchesQuery(test, query))
    .sort(compareTestsBySuiteOrder)
  const hasChildSuites = (suite.children || []).length > 0
  const organizationAvailable = Boolean(onOrganizeCase)
  const organizationRows = (organizationCases || casosList).filter(test => test?.activo !== false && test?.caseStatus !== 'ARCHIVADO' && test?.estado_caso !== 'ARCHIVADO')
  const canOrganize = organizationAvailable
  const canonicalPositionForVisibleIndex = (targetSuiteId: string, visibleIndex: number) => {
    const target = suiteTests[visibleIndex]
    if (!target) return organizationRows.filter(item => (item.suiteId ?? item.suite_id) === targetSuiteId).length
    const targetRows = organizationRows
      .filter(item => (item.suiteId ?? item.suite_id) === targetSuiteId)
      .sort(compareTestsBySuiteOrder)
    const index = targetRows.findIndex(item => String(item.id) === String(target.id))
    return index < 0 ? targetRows.length : index
  }
  const hasExpandableContent = hasChildSuites || suiteTests.length > 0
  // Selection identifies the active suite; only expansion controls its contents.
  const shouldShowTests = isExpanded || query !== ''
  const metrics = showMetrics && getSuiteMetrics ? getSuiteMetrics(suite.id) : null
  const hasMetricResults = !!metrics && (metrics.passed > 0 || metrics.failed > 0 || metrics.blocked > 0 || metrics.pending > 0)
  const suiteTreeIds = collectSuiteIds(suite)
  const descendantSuiteCount = Math.max(0, suiteTreeIds.length - 1)
  const cumulativeTestCount = casosList.filter(test =>
    (isUnsuitedRoot ? !test.suiteId : suiteTreeIds.includes(test.suiteId)) && (!currentCompId || test.componentId === currentCompId)
  ).length
  const showCountChips = !showMetrics && (descendantSuiteCount > 0 || cumulativeTestCount > 0)
  const suiteColor = suite.color || '#F1F5F9'
  const SuiteIcon = suiteIconMap[suite.icono || suite.icon || 'folder'] || Folders
  const suiteFullName = String(suite.nombre || suite.name || t('common.noName'))
  const suiteTooltip = isUnsuitedRoot
    ? `${t('casos.noSuiteCases')}. ${t('common.clickTo', { action: isExpanded ? t('common.collapse') : t('common.expand') })}`
    : hasExpandableContent
      ? `${t('common.folder')}: ${suiteFullName}. ${t('common.clickTo', { action: isExpanded ? t('common.collapse') : t('common.expand') })}`
      : `${t('common.folder')}: ${suiteFullName}`
  const suiteMenuOpen = openSuiteDropdown === suite.id
  const handleSuiteToggle = () => {
    onSelectSuite(suite.id)
    onToggleSuite(suite.id)
  }
  const getTestTone = (test: any) => {
    const raw = String(test?.lastResult || test?.status || '').toLowerCase()
    if (['passed', 'ok', 'paso'].includes(raw)) return { bg: '#ECFDF3', border: '#198754', icon: 'text-success' }
    if (['failed', 'fallido', 'fallo'].includes(raw)) return { bg: '#FEF2F2', border: '#DC3545', icon: 'text-danger' }
    if (['blocked', 'bloqueado'].includes(raw)) return { bg: '#EFF6FF', border: '#0D6EFD', icon: 'text-primary' }
    return { bg: '#FFFFFF', border: '#E9ECEF', icon: 'text-muted' }
  }
  const organize = async (test: any, targetSuiteId: string | null, position: number) => {
    if (!onOrganizeCase || !organizationAvailable) return false
    try {
      const result = await onOrganizeCase(test, targetSuiteId, position)
      onAnnounce?.(result === false ? t('casos.caseOrganizationFailed') : t('casos.caseOrganizationSaved'))
      return result !== false
    } catch {
      onAnnounce?.(t('casos.caseOrganizationFailed'))
      return false
    }
  }
  const dropCase = (event: React.DragEvent, targetSuiteId: string | null, _position: number, targetCaseId?: string, insertAfter = false) => {
    event.preventDefault()
    stopCaseDropPropagation(event)
    setDragOverCase(null)
    setDragOverSuite(false)
    if (!canOrganize) return
    const sourceId = event.dataTransfer.getData('text/case-id') || event.dataTransfer.getData('text/plain')
    const source = organizationRows.find(item => String(item.id) === sourceId)
    if (!source) return
    const targetRows = organizationRows
      .filter(item => (item.suiteId ?? item.suite_id ?? null) === targetSuiteId && String(item.id) !== sourceId)
      .sort(compareTestsBySuiteOrder)
    const targetPosition = targetCaseId
      ? targetRows.findIndex(item => String(item.id) === targetCaseId) + (insertAfter ? 1 : 0)
      : targetRows.length
    void organize(source, targetSuiteId, targetPosition < 0 ? targetRows.length : targetPosition)
  }

  return (
    <div className="mb-1">
      <div
        onClick={handleSuiteToggle}
        onDragEnter={(event) => {
          if (canOrganize && !isUnsuitedRoot && !isExpanded) onToggleSuite(suite.id)
        }}
        onDragOver={(event) => { if (canOrganize && !isUnsuitedRoot) { event.preventDefault(); setDragOverSuite(true); setDragOverCase(null) } }}
        onDragLeave={() => setDragOverSuite(false)}
        onDrop={(event) => { if (!isUnsuitedRoot) dropCase(event, suite.id, suiteTests.length) }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          handleSuiteToggle()
        }}
        role="button"
        tabIndex={0}
        aria-expanded={hasExpandableContent ? isExpanded : undefined}
        className={`suite-tree-suite-row p-2 rounded-3 cursor-pointer d-flex align-items-center transition-all border ${dragOverSuite ? 'border-primary bg-primary-subtle' : isSelected ? 'is-selected border-primary text-primary fw-bold shadow-sm' : 'border-transparent hover-bg-light text-dark'}`}
        style={{ marginLeft: level * 16, minHeight: '38px', '--suite-color': suiteColor, cursor: 'pointer' } as CSSProperties}
        title={suiteMenuOpen ? undefined : (isUnsuitedRoot ? t('casos.unsuitedOrganizationDisabled') : suiteTooltip)}
        aria-label={isUnsuitedRoot ? t('casos.unsuitedOrganizationDisabled') : suiteTooltip}
        aria-disabled={isUnsuitedRoot || undefined}
      >
        <span className="flex-shrink-0 d-flex align-items-center justify-content-center me-2" style={{ width: '16px' }}>
          {hasExpandableContent ? (
            isExpanded ? <ChevronDown size={14} className={isSelected ? 'text-primary' : 'text-muted'} /> : <ChevronRight size={14} className="text-muted" />
          ) : (
            <div style={{ width: '14px' }} />
          )}
        </span>

        <SuiteIcon size={16} className="flex-shrink-0 me-2" style={{ color: isSelected ? 'var(--app-primary)' : suiteIconColor(suiteColor) }} />
        <span className="app-small text-truncate flex-grow-1" title={suiteMenuOpen ? undefined : suiteTooltip} aria-label={suiteTooltip}>{suiteFullName}</span>
        {suite.archivado && (
          <span className="badge bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle x-small flex-shrink-0">{t('common.archived')}</span>
        )}
        {showCountChips && (
          <span className="d-flex align-items-center gap-1 ms-2 flex-shrink-0">
            {descendantSuiteCount > 0 && <BadgeLike text={formatSuiteCount(descendantSuiteCount, t)} tone="secondary" title={t('common.includedSubSuites', { count: descendantSuiteCount })} />}
            {cumulativeTestCount > 0 && <BadgeLike text={formatCaseCount(cumulativeTestCount, t)} tone="secondary" title={t('common.includedCases', { count: cumulativeTestCount })} />}
          </span>
        )}
        {metrics && (
          <span className="d-flex align-items-center gap-1 ms-2 flex-shrink-0">
            <BadgeLike text={formatCaseCount(metrics.total, t)} tone="secondary" title={t('common.includedCases', { count: metrics.total })} />
            <MetricBadge metrics={metrics} muted={!hasMetricResults} />
          </span>
        )}

        {showActions && !isUnsuitedRoot && <div className="ms-auto pl-2 flex-shrink-0">
          <Dropdown show={suiteMenuOpen} onToggle={(isOpen) => onToggleSuiteDropdown?.(isOpen ? suite.id : null)} onClick={(e) => e.stopPropagation()}>
            <Dropdown.Toggle variant="link" size="sm" className="p-1 text-muted shadow-none border-0 hover-text-primary d-flex align-items-center flex-shrink-0">
              <Settings size={14} />
            </Dropdown.Toggle>
            <Dropdown.Menu className="shadow-sm border-light-subtle app-small">
              <Dropdown.Header className="px-3 pb-1 text-uppercase x-small text-muted">{t('common.newTestCase')}</Dropdown.Header>
              {caseCreationFormats.map((format) => {
                const FormatIcon = caseFormatPresentation[format].icon
                const label = t(caseFormatPresentation[format].labelKey)
                return (
                  <Dropdown.Item
                    key={format}
                    onClick={() => onCreateCase(suite.id, format)}
                    className="d-flex align-items-center gap-2 text-dark"
                  >
                    <FormatIcon size={14} style={{ color: caseFormatPresentation[format].color }} aria-hidden="true" />
                    {label}
                  </Dropdown.Item>
                )
              })}
              <Dropdown.Divider />
              <Dropdown.Item onClick={() => onCreateSuite(suite.id)} className="d-flex align-items-center gap-2 text-dark"><FolderPlus size={14}/> {t('common.newSubfolder')}</Dropdown.Item>
              <Dropdown.Item onClick={() => onEditSuite(suite)} className="d-flex align-items-center gap-2 text-dark"><Edit size={14}/> {t('common.editFolder')}</Dropdown.Item>
              {onCloneSuite && (
                <Dropdown.Item onClick={() => onCloneSuite(suite)} className="d-flex align-items-center gap-2 text-dark">
                  <ClipboardCopy size={14} className="flex-shrink-0" aria-hidden="true" />
                  <span className="text-truncate">{t('common.copySuite')}</span>
                </Dropdown.Item>
              )}
              {onMoveSuite && (
                <Dropdown.Item onClick={() => onMoveSuite(suite)} className="d-flex align-items-center gap-2 text-dark"><MoveRight size={14}/> {t('common.moveFolder')}</Dropdown.Item>
              )}
              {(onArchiveSuite || onRestoreSuite) && <Dropdown.Divider />}
              {suite.archivado ? (
                onRestoreSuite && (
                  <Dropdown.Item onClick={() => onRestoreSuite(suite)} className="d-flex align-items-center gap-2 text-dark"><RotateCcw size={14}/> {t('common.restoreSuite')}</Dropdown.Item>
                )
              ) : (
                onArchiveSuite && (
                  <Dropdown.Item onClick={() => onArchiveSuite(suite)} className="d-flex align-items-center gap-2 text-dark"><Archive size={14}/> {t('common.archiveSuite')}</Dropdown.Item>
                )
              )}
              <Dropdown.Divider />
              <Dropdown.Item onClick={() => onDeleteSuite(suite.id)} className="d-flex align-items-center gap-2 text-danger"><Trash2 size={14}/> {t('common.deleteFolder')}</Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        </div>}
      </div>

      {isExpanded && hasChildSuites && (
        <div className="mt-1 border-start ms-3 ps-2 border-light-subtle">
          {suite.children.slice().sort(compareSuitesByOrder)
            .filter((child: any) => child?.id !== suite.id && !childVisited.has(child?.id))
            .filter((child: any) => !query || suiteMatchesQuery(child, props, query, childVisited))
            .map((child: any) => (
            <SuiteTreeNode key={child.id} suite={child} level={level + 1} props={props} visited={childVisited} />
          ))}
        </div>
      )}

      {shouldShowTests && suiteTests.length > 0 && (
        <div
          className="mt-1 d-flex flex-column gap-1"
          style={{ marginLeft: (level * 16) + 28 }}
          onDragOver={(event) => {
            if (canOrganize && !isUnsuitedRoot && event.target === event.currentTarget) {
              event.preventDefault()
              setDragOverCase(null)
              setDragOverSuite(true)
            }
          }}
          onDrop={(event) => {
            if (!isUnsuitedRoot && event.target === event.currentTarget) dropCase(event, suite.id, suiteTests.length)
          }}
        >
          {suiteTests.map((test, testIndex) => {
            const tone = getTestTone(test)
            const isSelectedTest = selectedTest?.id === test.id
            const testCode = test.code || test.id.slice(0, 8).toUpperCase()
            const testFullName = String(test.title || t('common.noName'))
            const format = normalizeCaseFormat(test.format)

            const formatLabel = t(caseFormatPresentation[format].labelKey)
            const testTooltip = `${testCode} - ${testFullName} · ${formatLabel}`
            const visibleTags = (test.tags || []).slice(0, 2)
            const hiddenTagCount = Math.max(0, (test.tags || []).length - visibleTags.length)
            return (
            <div
              key={test.id}
              onClick={(e) => {
                e.stopPropagation()
                onSelectTest(test, suite.id)
              }}
              draggable={canOrganize && test.caseStatus !== 'ARCHIVADO' && test.estado_caso !== 'ARCHIVADO' && test.activo !== false}
              onDragStart={(event) => {
                event.dataTransfer.setData('text/case-id', String(test.id))
                event.dataTransfer.setData('text/plain', String(test.id))
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => {
                setDragOverCase(null)
                setDragOverSuite(false)
              }}
              onDragOver={(event) => {
                if (!canOrganize || isUnsuitedRoot) return
                event.preventDefault()
                const bounds = event.currentTarget.getBoundingClientRect()
                const after = event.clientY > bounds.top + bounds.height / 2
                setDragOverCase({ id: String(test.id), after })
                setDragOverSuite(false)
              }}
              onDragLeave={() => setDragOverCase(null)}
              onDrop={(event) => {
                if (!isUnsuitedRoot) {
                  const bounds = event.currentTarget.getBoundingClientRect()
                  const after = event.clientY > bounds.top + bounds.height / 2
                  dropCase(event, suite.id, testIndex, String(test.id), after)
                }
              }}
              className={`py-1 px-2 rounded-2 d-flex align-items-center gap-1 cursor-pointer border text-dark suite-tree-case-row ${isSelectedTest ? 'is-selected shadow-sm' : ''}`}
              style={{ minHeight: '28px', position: 'relative', '--case-tone-border': tone.border } as CSSProperties}
              title={organizationAvailable ? testTooltip : `${testTooltip} · ${t('casos.caseOrganizationFilteredDisabled')}`}
              aria-label={testTooltip}
              aria-disabled={!organizationAvailable || undefined}
            >
              {dragOverCase?.id === String(test.id) && !dragOverCase.after && <span className="position-absolute start-0 end-0 bg-primary" style={{ height: '3px', top: '-2px' }} aria-hidden="true" />}
              <span className="font-monospace x-small fw-bold text-secondary flex-shrink-0">{testCode}</span>
              <span className="x-small text-truncate flex-grow-1" title={testTooltip} aria-label={testTooltip}>{testFullName}</span>
              <span className="suite-tree-case-tags d-inline-flex align-items-center gap-1">
                {visibleTags.map((tag: string) => (
                  <span key={tag} className="badge bg-light text-primary border x-small suite-tree-case-tag" title={tag}>{tag}</span>
                ))}
                {hiddenTagCount > 0 && (
                  <span className="badge bg-light text-secondary border x-small flex-shrink-0" title={(test.tags || []).slice(visibleTags.length).join(', ')}>
                    +{hiddenTagCount}
                  </span>
                )}
              </span>
              {test.isOutdatedVersion && (
                <span className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle x-small flex-shrink-0">v{test.version}-&gt;v{test.latestVersion}</span>
              )}
              {test.caseStatus === 'ARCHIVADO' && (
                <span className="badge bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle x-small flex-shrink-0">{t('common.archived')}</span>
              )}
              {showActions && <Dropdown show={openTestDropdown === test.id} onToggle={(isOpen) => onToggleTestDropdown?.(isOpen ? test.id : null)} onClick={(e) => e.stopPropagation()}>
                <Dropdown.Toggle
                  as="button"
                  type="button"
                  bsPrefix="suite-tree-case-actions-toggle"
                  className="text-muted suite-tree-case-actions d-inline-flex align-items-center justify-content-center"
                  title={t('common.caseOptions')}
                  aria-label={`${t('common.caseOptions')}: ${testTooltip}`}
                >
                  <MoreVertical size={14} />
                </Dropdown.Toggle>
                <Dropdown.Menu className="shadow-sm border-light-subtle app-small">
                  {onViewVersions && test.version > 1 && (
                    <Dropdown.Item onClick={() => onViewVersions(test)} className="d-flex align-items-center gap-2 text-dark">
                      <History size={14} /> {t('common.viewChanges')}
                    </Dropdown.Item>
                  )}
                  <Dropdown.Item onClick={() => onEditCase(test)} className="d-flex align-items-center gap-2 text-dark">
                    <Edit size={14} /> {t('common.editCase')}
                  </Dropdown.Item>
                  {onCloneCase && (
                    <Dropdown.Item onClick={() => onCloneCase(test)} className="d-flex align-items-center gap-2 text-dark">
                      <ClipboardCopy size={14} /> {t('common.copyAsNewTest')}
                    </Dropdown.Item>
                  )}
                  {onOrganizeCase && (
                    <>
                      <Dropdown.Item disabled={!canOrganize || isUnsuitedRoot || testIndex === 0} onClick={() => void organize(test, suite.id, canonicalPositionForVisibleIndex(suite.id, testIndex - 1))} className="d-flex align-items-center gap-2 text-dark"><ArrowUp size={14} /> {t('casos.moveCaseUp')}</Dropdown.Item>
                      <Dropdown.Item disabled={!canOrganize || isUnsuitedRoot || testIndex === suiteTests.length - 1} onClick={() => void organize(test, suite.id, canonicalPositionForVisibleIndex(suite.id, testIndex + 1))} className="d-flex align-items-center gap-2 text-dark"><ArrowDown size={14} /> {t('casos.moveCaseDown')}</Dropdown.Item>
                    </>
                  )}
                  {onMoveCase && (
                    <Dropdown.Item onClick={() => onMoveCase(test)} className="d-flex align-items-center gap-2 text-dark">
                      <MoveRight size={14} /> {t('common.moveTest')}
                    </Dropdown.Item>
                  )}
                  {(onArchiveCase || onRestoreCase) && <Dropdown.Divider />}
                  {test.caseStatus === 'ARCHIVADO' ? (
                    onRestoreCase && (
                      <Dropdown.Item onClick={() => onRestoreCase(test)} className="d-flex align-items-center gap-2 text-dark">
                        <RotateCcw size={14} /> {t('common.restoreTest')}
                      </Dropdown.Item>
                    )
                  ) : (
                    onArchiveCase && (
                      <Dropdown.Item onClick={() => onArchiveCase(test)} className="d-flex align-items-center gap-2 text-dark">
                        <Archive size={14} /> {t('common.archiveTest')}
                      </Dropdown.Item>
                    )
                  )}
                  <Dropdown.Divider />
                  <Dropdown.Item onClick={() => onDeleteCase(test.id)} className="d-flex align-items-center gap-2 text-danger">
                    <Trash2 size={14} /> {t('common.deleteCase')}
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown>}
              {dragOverCase?.id === String(test.id) && dragOverCase.after && <span className="position-absolute start-0 end-0 bg-primary" style={{ height: '3px', bottom: '-2px' }} aria-hidden="true" />}
            </div>
          )})}
          {dragOverSuite && <span className="bg-primary w-100" style={{ height: '3px' }} aria-hidden="true" />}
        </div>
      )}
    </div>
  )
}

export const SuiteTree = memo((props: SuiteTreeProps) => {
  const { t } = useI18n()
  const [localOpenTestDropdown, setLocalOpenTestDropdown] = useState<string | null>(null)
  const [localOpenSuiteDropdown, setLocalOpenSuiteDropdown] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const toggleTestDropdown = (id: string | null) => {
    setLocalOpenTestDropdown(id)
    if (id) setLocalOpenSuiteDropdown(null)
  }
  const toggleSuiteDropdown = (id: string | null) => {
    setLocalOpenSuiteDropdown(id)
    if (id) setLocalOpenTestDropdown(null)
  }

  const mergedProps: SuiteTreeProps = useMemo(() => ({
    ...props,
    openTestDropdown: props.openTestDropdown ?? localOpenTestDropdown,
    onToggleTestDropdown: props.onToggleTestDropdown ?? toggleTestDropdown,
    openSuiteDropdown: props.openSuiteDropdown ?? localOpenSuiteDropdown,
    onToggleSuiteDropdown: props.onToggleSuiteDropdown ?? toggleSuiteDropdown,
    onAnnounce: props.onAnnounce ?? setAnnouncement,
  }), [props, localOpenTestDropdown, localOpenSuiteDropdown])

  const hasUnsuitedCases = props.casosList.some(test =>
    !test?.suiteId && (!props.currentCompId || test.componentId === props.currentCompId)
  )
  const unsuitedRoot = {
    id: UNSUITED_CASES_ROOT_ID,
    nombre: t('casos.noSuiteCases'),
    icono: 'file-check',
    color: '#F8FAFC',
    children: []
  }

  const query = normalizeForSearch(props.testSearchQuery.trim())
  const filteredSuites = query
    ? props.suites.filter((suite: any) => suiteMatchesQuery(suite, mergedProps, query))
    : props.suites

  return (
    <>
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</div>
      {hasUnsuitedCases && (!query || suiteMatchesQuery(unsuitedRoot, mergedProps, query)) && <SuiteTreeNode suite={unsuitedRoot} level={0} props={mergedProps} />}
      {filteredSuites.slice().sort(compareSuitesByOrder).map((suite: any) => (
        <SuiteTreeNode key={suite.id} suite={suite} level={0} props={mergedProps} />
      ))}
    </>
  )
})

const BadgeLike = ({ text, tone, title }: { text: string, tone: 'primary' | 'secondary', title?: string }) => (
  <span className={`badge ${tone === 'primary' ? 'bg-primary' : 'bg-light text-dark border'} x-small fw-semibold`} title={title || text}>
    {text}
  </span>
)

const MetricBadge = ({ metrics, muted }: { metrics: { passed: number, failed: number, blocked: number, pending: number }, muted: boolean }) => (
  <span className="badge bg-light text-dark border x-small fw-semibold d-inline-flex align-items-center gap-1">
    <span className={muted || metrics.passed === 0 ? 'text-secondary' : 'text-success'}>{metrics.passed}</span>
    <span className="text-secondary">/</span>
    <span className={muted || metrics.failed === 0 ? 'text-secondary' : 'text-danger'}>{metrics.failed}</span>
    <span className="text-secondary">/</span>
    <span className={muted || metrics.blocked === 0 ? 'text-secondary' : 'text-primary'}>{metrics.blocked}</span>
    <span className="text-secondary">/</span>
    <span className="text-secondary">{metrics.pending}</span>
  </span>
)
