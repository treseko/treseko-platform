import { memo, useMemo, useState } from 'react'
import { Button, Dropdown } from 'react-bootstrap'
import { Archive, Bug, ChevronDown, ChevronRight, ClipboardCopy, Database, Edit, FileCheck2, FileText, FolderCheck, FolderPlus, Folders, Globe2, History, LockKeyhole, MoreVertical, MoveRight, PlusCircle, RotateCcw, Search, Settings, ShieldCheck, Smartphone, Trash2, Zap } from 'lucide-react'

type SuiteTreeProps = {
  suites: any[]
  expandedSuites: Record<string, boolean>
  selectedSuiteId: string
  selectedSubSuiteId: string | null
  selectedTest: any
  casosList: any[]
  currentCompId: string
  testSearchQuery: string
  onSelectSuite: (suiteId: string) => void
  onToggleSuite: (suiteId: string) => void
  onCreateCase: (suiteId: string) => void
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

const compareTestsByTitle = (left: any, right: any) =>
  naturalCompare(left.title, right.title)
  || naturalCompare(left.code, right.code)
  || naturalCompare(left.createdAt || left.fecha_creacion, right.createdAt || right.fecha_creacion)
  || naturalCompare(left.id, right.id)

const compareSuitesByName = (left: any, right: any) =>
  naturalCompare(left.nombre || left.name, right.nombre || right.name)
  || naturalCompare(left.id, right.id)

const formatCaseCount = (count: number) => `${count} ${count === 1 ? 'caso' : 'casos'}`

const formatSuiteCount = (count: number) => `${count} ${count === 1 ? 'suite' : 'suites'}`

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
  if (!suite?.id || visited.has(suite.id)) return null
  const childVisited = new Set(visited)
  childVisited.add(suite.id)
  const {
    expandedSuites,
    selectedSuiteId,
    selectedSubSuiteId,
    selectedTest,
    casosList,
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
  const isExpanded = expandedSuites[suite.id]
  const isSelected = selectedSuiteId === suite.id || selectedSubSuiteId === suite.id
  const query = testSearchQuery.trim().toLowerCase()
  const suiteTests = casosList
    .filter(test => test.suiteId === suite.id)
    .filter(test => !currentCompId || test.componentId === currentCompId)
    .filter(test => !query || test.title.toLowerCase().includes(query) || test.id.toLowerCase().includes(query) || (test.code || '').toLowerCase().includes(query) || (test.tags || []).some((tag: string) => tag.toLowerCase().includes(query)))
    .sort(compareTestsByTitle)
  const shouldShowTests = isExpanded || isSelected || query !== ''
  const metrics = showMetrics && getSuiteMetrics ? getSuiteMetrics(suite.id) : null
  const hasMetricResults = !!metrics && (metrics.passed > 0 || metrics.failed > 0 || metrics.blocked > 0 || metrics.pending > 0)
  const suiteTreeIds = collectSuiteIds(suite)
  const descendantSuiteCount = Math.max(0, suiteTreeIds.length - 1)
  const cumulativeTestCount = casosList.filter(test =>
    suiteTreeIds.includes(test.suiteId) && (!currentCompId || test.componentId === currentCompId)
  ).length
  const showCountChips = !showMetrics && (descendantSuiteCount > 0 || cumulativeTestCount > 0)
  const suiteColor = suite.color || '#F1F5F9'
  const SuiteIcon = suiteIconMap[suite.icono || suite.icon || 'folder'] || Folders
  const suiteFullName = String(suite.nombre || suite.name || 'Sin nombre')
  const suiteTooltip = `Carpeta: ${suiteFullName}`
  const getTestTone = (test: any) => {
    const raw = String(test?.lastResult || test?.status || '').toLowerCase()
    if (['passed', 'ok', 'paso'].includes(raw)) return { bg: '#ECFDF3', border: '#198754', icon: 'text-success' }
    if (['failed', 'fallido', 'fallo'].includes(raw)) return { bg: '#FEF2F2', border: '#DC3545', icon: 'text-danger' }
    if (['blocked', 'bloqueado'].includes(raw)) return { bg: '#EFF6FF', border: '#0D6EFD', icon: 'text-primary' }
    return { bg: '#FFFFFF', border: '#E9ECEF', icon: 'text-muted' }
  }

  return (
    <div className="mb-1">
      <div
        onClick={() => {
          onSelectSuite(suite.id)
          onToggleSuite(suite.id)
        }}
        className={`p-2 rounded-3 cursor-pointer d-flex align-items-center transition-all border ${isSelected ? 'border-primary text-primary fw-bold shadow-sm' : 'border-transparent hover-bg-light text-dark'}`}
        style={{ marginLeft: level * 16, minHeight: '38px', background: suiteColor }}
        title={suiteTooltip}
        aria-label={suiteTooltip}
      >
        <span className="flex-shrink-0 d-flex align-items-center justify-content-center me-2" style={{ width: '16px' }}>
          {suite.children && suite.children.length > 0 ? (
            isExpanded ? <ChevronDown size={14} className={isSelected ? 'text-primary' : 'text-muted'} /> : <ChevronRight size={14} className="text-muted" />
          ) : (
            <div style={{ width: '14px' }} />
          )}
        </span>

        <SuiteIcon size={16} className="flex-shrink-0 me-2" style={{ color: isSelected ? '#0d6efd' : suiteIconColor(suiteColor) }} />
        <span className="small text-truncate flex-grow-1" style={{ fontSize: '0.85rem' }} title={suiteTooltip} aria-label={suiteTooltip}>{suiteFullName}</span>
        {suite.archivado && (
          <span className="badge bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle x-small flex-shrink-0">ARCHIVADA</span>
        )}
        {showCountChips && (
          <span className="d-flex align-items-center gap-1 ms-2 flex-shrink-0">
            {descendantSuiteCount > 0 && <BadgeLike text={formatSuiteCount(descendantSuiteCount)} tone="secondary" title={`Sub-suites incluidas: ${descendantSuiteCount}`} />}
            {cumulativeTestCount > 0 && <BadgeLike text={formatCaseCount(cumulativeTestCount)} tone="secondary" title={`Casos incluidos: ${cumulativeTestCount}`} />}
          </span>
        )}
        {metrics && (
          <span className="d-flex align-items-center gap-1 ms-2 flex-shrink-0">
            <BadgeLike text={formatCaseCount(metrics.total)} tone="secondary" title={`Casos incluidos: ${metrics.total}`} />
            <MetricBadge metrics={metrics} muted={!hasMetricResults} />
          </span>
        )}

        {showActions && <div className="ms-auto pl-2 flex-shrink-0">
          <Dropdown show={openSuiteDropdown === suite.id} onToggle={(isOpen) => onToggleSuiteDropdown?.(isOpen ? suite.id : null)} onClick={(e) => e.stopPropagation()}>
            <Dropdown.Toggle variant="link" size="sm" className="p-1 text-muted shadow-none border-0 hover-text-primary d-flex align-items-center flex-shrink-0">
              <Settings size={14} />
            </Dropdown.Toggle>
            <Dropdown.Menu className="shadow-sm border-light-subtle" style={{ fontSize: '0.85rem' }}>
              <Dropdown.Item onClick={() => onCreateCase(suite.id)} className="d-flex align-items-center gap-2 text-dark"><PlusCircle size={14}/> Nuevo caso de prueba</Dropdown.Item>
              <Dropdown.Divider />
              <Dropdown.Item onClick={() => onCreateSuite(suite.id)} className="d-flex align-items-center gap-2 text-dark"><FolderPlus size={14}/> Nueva Sub-carpeta</Dropdown.Item>
              <Dropdown.Item onClick={() => onEditSuite(suite)} className="d-flex align-items-center gap-2 text-dark"><Edit size={14}/> Editar carpeta</Dropdown.Item>
              {onCloneSuite && (
                <Dropdown.Item onClick={() => onCloneSuite(suite)} className="d-flex align-items-center gap-2 text-dark"><ClipboardCopy size={14}/> Copiar suite completa</Dropdown.Item>
              )}
              {onMoveSuite && (
                <Dropdown.Item onClick={() => onMoveSuite(suite)} className="d-flex align-items-center gap-2 text-dark"><MoveRight size={14}/> Mover carpeta</Dropdown.Item>
              )}
              {(onArchiveSuite || onRestoreSuite) && <Dropdown.Divider />}
              {suite.archivado ? (
                onRestoreSuite && (
                  <Dropdown.Item onClick={() => onRestoreSuite(suite)} className="d-flex align-items-center gap-2 text-dark"><RotateCcw size={14}/> Restaurar suite</Dropdown.Item>
                )
              ) : (
                onArchiveSuite && (
                  <Dropdown.Item onClick={() => onArchiveSuite(suite)} className="d-flex align-items-center gap-2 text-dark"><Archive size={14}/> Archivar suite</Dropdown.Item>
                )
              )}
              <Dropdown.Divider />
              <Dropdown.Item onClick={() => onDeleteSuite(suite.id)} className="d-flex align-items-center gap-2 text-danger"><Trash2 size={14}/> Eliminar carpeta</Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        </div>}
      </div>

      {isExpanded && suite.children && suite.children.length > 0 && (
        <div className="mt-1 border-start ms-3 ps-2 border-light-subtle">
          {suite.children.slice().sort(compareSuitesByName).filter((child: any) => child?.id !== suite.id && !childVisited.has(child?.id)).map((child: any) => (
            <SuiteTreeNode key={child.id} suite={child} level={level + 1} props={props} visited={childVisited} />
          ))}
        </div>
      )}

      {shouldShowTests && suiteTests.length > 0 && (
        <div className="mt-1 d-flex flex-column gap-1" style={{ marginLeft: (level * 16) + 28 }}>
          {suiteTests.map(test => {
            const tone = getTestTone(test)
            const isSelectedTest = selectedTest?.id === test.id
            const testCode = test.code || test.id.slice(0, 8).toUpperCase()
            const testFullName = String(test.title || 'Sin nombre')
            const testTooltip = `${testCode} - ${testFullName}`
            return (
            <div
              key={test.id}
              onClick={(e) => {
                e.stopPropagation()
                onSelectTest(test, suite.id)
              }}
              className={`py-1 px-2 rounded-2 d-flex align-items-center gap-1 cursor-pointer border text-dark ${isSelectedTest ? 'shadow-sm' : ''}`}
              style={{ minHeight: '28px', background: isSelectedTest ? '#E7F1FF' : tone.bg, borderColor: isSelectedTest ? '#0D6EFD' : tone.border }}
              title={testTooltip}
              aria-label={testTooltip}
            >
              <FileText size={12} className={`flex-shrink-0 ${isSelectedTest ? 'text-primary' : tone.icon}`} />
              <span className="font-monospace x-small fw-bold text-secondary flex-shrink-0">{testCode}</span>
              <span className="x-small text-truncate flex-grow-1" title={testTooltip} aria-label={testTooltip}>{testFullName}</span>
              {(test.tags || []).slice(0, 2).map((tag: string) => (
                <span key={tag} className="badge bg-light text-primary border x-small flex-shrink-0">{tag}</span>
              ))}
              {test.isOutdatedVersion && (
                <span className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle x-small flex-shrink-0">v{test.version}-&gt;v{test.latestVersion}</span>
              )}
              {test.caseStatus === 'ARCHIVADO' && (
                <span className="badge bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle x-small flex-shrink-0">ARCHIVADA</span>
              )}
              {showActions && <Dropdown show={openTestDropdown === test.id} onToggle={(isOpen) => onToggleTestDropdown?.(isOpen ? test.id : null)} onClick={(e) => e.stopPropagation()}>
                <Dropdown.Toggle
                  as="button"
                  type="button"
                  bsPrefix="suite-tree-case-actions-toggle"
                  className="text-muted flex-shrink-0 d-inline-flex align-items-center justify-content-center"
                  title="Opciones del caso"
                  aria-label={`Opciones del caso: ${testTooltip}`}
                >
                  <MoreVertical size={14} />
                </Dropdown.Toggle>
                <Dropdown.Menu className="shadow-sm border-light-subtle" style={{ fontSize: '0.85rem' }}>
                  {onViewVersions && test.version > 1 && (
                    <Dropdown.Item onClick={() => onViewVersions(test)} className="d-flex align-items-center gap-2 text-dark">
                      <History size={14} /> Ver cambios
                    </Dropdown.Item>
                  )}
                  <Dropdown.Item onClick={() => onEditCase(test)} className="d-flex align-items-center gap-2 text-dark">
                    <Edit size={14} /> Editar caso
                  </Dropdown.Item>
                  {onCloneCase && (
                    <Dropdown.Item onClick={() => onCloneCase(test)} className="d-flex align-items-center gap-2 text-dark">
                      <ClipboardCopy size={14} /> Copiar como nueva prueba
                    </Dropdown.Item>
                  )}
                  {onMoveCase && (
                    <Dropdown.Item onClick={() => onMoveCase(test)} className="d-flex align-items-center gap-2 text-dark">
                      <MoveRight size={14} /> Mover prueba
                    </Dropdown.Item>
                  )}
                  {(onArchiveCase || onRestoreCase) && <Dropdown.Divider />}
                  {test.caseStatus === 'ARCHIVADO' ? (
                    onRestoreCase && (
                      <Dropdown.Item onClick={() => onRestoreCase(test)} className="d-flex align-items-center gap-2 text-dark">
                        <RotateCcw size={14} /> Restaurar prueba
                      </Dropdown.Item>
                    )
                  ) : (
                    onArchiveCase && (
                      <Dropdown.Item onClick={() => onArchiveCase(test)} className="d-flex align-items-center gap-2 text-dark">
                        <Archive size={14} /> Archivar prueba
                      </Dropdown.Item>
                    )
                  )}
                  <Dropdown.Divider />
                  <Dropdown.Item onClick={() => onDeleteCase(test.id)} className="d-flex align-items-center gap-2 text-danger">
                    <Trash2 size={14} /> Eliminar caso
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown>}
            </div>
          )})}
        </div>
      )}
    </div>
  )
}

export const SuiteTree = memo((props: SuiteTreeProps) => {
  const [localOpenTestDropdown, setLocalOpenTestDropdown] = useState<string | null>(null)
  const [localOpenSuiteDropdown, setLocalOpenSuiteDropdown] = useState<string | null>(null)

  const mergedProps: SuiteTreeProps = useMemo(() => ({
    ...props,
    openTestDropdown: props.openTestDropdown ?? localOpenTestDropdown,
    onToggleTestDropdown: props.onToggleTestDropdown ?? setLocalOpenTestDropdown,
    openSuiteDropdown: props.openSuiteDropdown ?? localOpenSuiteDropdown,
    onToggleSuiteDropdown: props.onToggleSuiteDropdown ?? setLocalOpenSuiteDropdown,
  }), [props, localOpenTestDropdown, localOpenSuiteDropdown])

  return (
    <>
      {props.suites.slice().sort(compareSuitesByName).map((suite: any) => (
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
