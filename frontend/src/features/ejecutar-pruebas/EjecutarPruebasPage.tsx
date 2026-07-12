import { useState } from 'react'
import type { Dispatch, MouseEvent, ReactNode, SetStateAction } from 'react'
import { Alert, Badge, Button, Form, Table } from 'react-bootstrap'
import {
  AlertCircle,
  Bug,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Folders,
  History,
  ImagePlus,
  Info,
  PlayCircle,
  RefreshCw,
  Search,
  User,
  XCircle
} from 'lucide-react'
import type { AttachmentMeta } from '../../EvidenceUpload'
import { findSuiteById } from '../../testRepositoryUtils'
import { isImageAsset, resolveAssetUrl } from '../../shared/utils/assets'
import { isEvidenceAvailable } from '../../shared/utils/evidenceAvailability'
import { getExecutionHistoryStats, getStatusColor, normalizeExecutionHistory } from '../ejecucion/executionUtils'
import { RunDetailModal } from '../historial/RunDetailModal'
import { getBugCriticalityPresentation, getBugPriorityPresentation, getBugSeverityPresentation } from '../bugs/bugPresentation'

type EjecutarPruebasPageProps = {
  suiteExplorerWidth: number
  startSuiteExplorerResize: (event: MouseEvent<HTMLDivElement>) => void
  executionInitialLoading: boolean
  executionRefreshing: boolean
  executionSuiteTree: any[]
  renderExecutionSuiteTree: (suites: any[]) => ReactNode
  currentBuildId: string
  suitesTree: any[]
  selectedSuiteId: string
  testSearchQuery: string
  setTestSearchQuery: Dispatch<SetStateAction<string>>
  setSelectedSubSuiteId: Dispatch<SetStateAction<string | null>>
  setSelectedExecutionTestIds: Dispatch<SetStateAction<string[]>>
  setSelectedTest: Dispatch<SetStateAction<any>>
  filteredTests: any[]
  getExecutionStatusKey: (test: any) => string
  selectedExecutionTests: any[]
  openExecutionSelector: () => void
  allVisibleExecutionTestsSelected: boolean
  toggleVisibleExecutionSelection: (checked: boolean) => void
  selectedTest: any
  handleSelectTestForExecution: (test: any) => void
  selectedExecutionTestIds: string[]
  toggleExecutionSelection: (testId: string) => void
  activeBuildResultsLoading: boolean
  activeBuildResultsLoaded: boolean
  isOutdatedExecutionCase: (test: any) => boolean
  openSingleCaseExecutionSelector: (test: any) => void
  setZoomImage: Dispatch<SetStateAction<string | null>>
  getExecutionActionLabel: (test: any) => string
  buildsList: any[]
  showFeedback: (title: string, message: string, variant?: any) => void
  onOpenBuildHistory: () => void
  onOpenRunHistory: (runId: string) => void
  runDetail: any | null
  runDetailLoading: boolean
  runDetailError: string
  onCloseRunDetail: () => void
  onOpenEvidence: (attachment: any) => void
  canAccessCapability?: (capabilityId: any, level?: any) => boolean
  onCreateInternalBugFromCase?: (test: any) => Promise<any>
  creatingInternalBugContextId?: string | null
  openBugsByCase?: Record<string, any[]>
  openBugsLoading?: boolean
  onOpenBugTracker?: () => void
}

const getTrend = (test: any) => {
  if (!test.history || test.history.length < 2) return null
  const current = test.lastResult
  const previous = test.history[1]?.status
  if (!previous) return null

  const isPassed = (status: string) => status === 'PASO' || status === 'OK'
  const isFailed = (status: string) => status === 'FALLO' || status === 'FALLIDO'

  if (isPassed(current) && isFailed(previous)) return 'up'
  if (isFailed(current) && isPassed(previous)) return 'down'
  if (current === previous) return 'same'
  return 'neutral'
}

const getLastResultColor = (test: any) => {
  if (test.lastResult === 'PASO' || test.lastResult === 'OK') return 'success'
  if (test.lastResult === 'FALLO' || test.lastResult === 'FALLIDO') return 'danger'
  if (test.lastResult === 'BLOQUEADO') return 'warning'
  return 'secondary'
}

export function EjecutarPruebasPage({
  suiteExplorerWidth,
  startSuiteExplorerResize,
  executionInitialLoading,
  executionRefreshing,
  executionSuiteTree,
  renderExecutionSuiteTree,
  currentBuildId,
  suitesTree,
  selectedSuiteId,
  testSearchQuery,
  setTestSearchQuery,
  setSelectedSubSuiteId,
  setSelectedExecutionTestIds,
  setSelectedTest,
  filteredTests,
  getExecutionStatusKey,
  selectedExecutionTests,
  openExecutionSelector,
  allVisibleExecutionTestsSelected,
  toggleVisibleExecutionSelection,
  selectedTest,
  handleSelectTestForExecution,
  selectedExecutionTestIds,
  toggleExecutionSelection,
  activeBuildResultsLoading,
  activeBuildResultsLoaded,
  isOutdatedExecutionCase,
  openSingleCaseExecutionSelector,
  setZoomImage,
  getExecutionActionLabel,
  buildsList,
  showFeedback,
  onOpenBuildHistory,
  onOpenRunHistory,
  runDetail,
  runDetailLoading,
  runDetailError,
  onCloseRunDetail,
  onOpenEvidence,
  canAccessCapability,
  onCreateInternalBugFromCase,
  creatingInternalBugContextId,
  openBugsByCase = {},
  openBugsLoading = false,
  onOpenBugTracker
}: EjecutarPruebasPageProps) {
  const [mobileExplorerOpen, setMobileExplorerOpen] = useState(false)
  const [caseBugLinks, setCaseBugLinks] = useState<Record<string, any>>({})
  const [bugCaseFilter, setBugCaseFilter] = useState<'all' | 'open' | 'retest'>('all')
  const canStartAnyExecution = !canAccessCapability || canAccessCapability('ejecutar.manual', 'edit') || canAccessCapability('ejecutar.automatizada', 'edit') || canAccessCapability('ejecutar.ia', 'edit')
  const canViewBuildHistory = !canAccessCapability || canAccessCapability('ejecutar.historial_build', 'read')
  const canCreateBugs = !canAccessCapability || canAccessCapability('bugs.crear', 'edit')
  const canViewBugs = !canAccessCapability || canAccessCapability('bugs.ver', 'read')
  const isFailureResult = (status?: string) => ['FALLO', 'FALLIDO', 'BLOQUEADO'].includes(String(status || '').toUpperCase())
  const getOpenBugsForCase = (test: any) => test?.id ? (openBugsByCase[test.id] || []) : []
  const isRetestBug = (bug: any) => ['LISTO_PARA_RETEST', 'EN_RETEST'].includes(String(bug?.estado || '').toUpperCase()) || String(bug?.retest_status || '').toLowerCase().includes('retest')
  const visibleTests = filteredTests.filter(test => {
    if (bugCaseFilter === 'all') return true
    const bugs = getOpenBugsForCase(test)
    if (bugCaseFilter === 'open') return bugs.length > 0
    return bugs.some(isRetestBug)
  })
  const openBugCaseCount = filteredTests.filter(test => getOpenBugsForCase(test).length > 0).length
  const openBugTotal = filteredTests.reduce((total, test) => total + getOpenBugsForCase(test).length, 0)
  const retestBugCaseCount = filteredTests.filter(test => getOpenBugsForCase(test).some(isRetestBug)).length
  const getBugStatusBadge = (bug: any) => {
    const state = String(bug?.estado || '').toUpperCase()
    if (isRetestBug(bug)) return { label: 'RETEST', bg: 'warning', text: 'dark' as const }
    if (['RESUELTO', 'CERRADO', 'DUPLICADO', 'NO_REPRODUCIBLE', 'NO_CORRESPONDE'].includes(state)) {
      return { label: state || 'CERRADO', bg: 'secondary', text: undefined }
    }
    if (state === 'BLOQUEADO') return { label: state, bg: 'danger', text: undefined }
    if (['TRIAGE', 'ASIGNADO', 'EN_PROGRESO', 'REABIERTO'].includes(state)) return { label: state, bg: 'primary', text: undefined }
    return { label: state || 'ABIERTO', bg: 'success', text: undefined }
  }
  const getBugSeverityBadge = (severity?: string) => {
    const value = String(severity || '').toUpperCase()
    const presentation = getBugSeverityPresentation(value)
    if (!value) return null
    if (value === 'CRITICA') return { label: presentation?.label || `Sev. ${value}`, bg: 'danger', text: undefined }
    if (value === 'ALTA') return { label: presentation?.label || `Sev. ${value}`, bg: 'warning', text: 'dark' as const }
    if (value === 'MEDIA') return { label: presentation?.label || `Sev. ${value}`, bg: 'primary', text: undefined }
    if (value === 'BAJA') return { label: presentation?.label || `Sev. ${value}`, bg: 'secondary', text: undefined }
    return { label: presentation?.label || `Sev. ${value}`, bg: 'light', text: 'dark' as const }
  }
  const getBugCriticalityBadge = (criticality?: string) => {
    const value = String(criticality || '').toUpperCase()
    const presentation = getBugCriticalityPresentation(value)
    if (!value) return null
    if (value === 'CRITICA') return { label: presentation?.label || `Crit. ${value}`, bg: 'danger', text: undefined }
    if (value === 'ALTA') return { label: presentation?.label || `Crit. ${value}`, bg: 'warning', text: 'dark' as const }
    if (value === 'MEDIA') return { label: presentation?.label || `Crit. ${value}`, bg: 'light', text: 'dark' as const }
    return { label: presentation?.label || `Crit. ${value}`, bg: 'secondary', text: undefined }
  }
  const renderOpenBugBadge = (test: any) => {
    const bugs = getOpenBugsForCase(test)
    if (bugs.length === 0) return null
    const hasRetest = bugs.some(isRetestBug)
    return (
      <Badge
        bg={hasRetest ? 'warning' : 'danger'}
        text={hasRetest ? 'dark' : undefined}
        className="x-small d-inline-flex align-items-center gap-1"
        title={bugs.map((bug: any) => `${bug.codigo} · ${bug.estado}`).join('\n')}
      >
        <Bug size={10} /> {hasRetest ? 'Retest' : `${bugs.length} bug${bugs.length > 1 ? 's' : ''}`}
      </Badge>
    )
  }
  const getFailureBugContextId = (test: any) => {
    const latestFailure = getCurrentBuildFailureContext(test)
    return latestFailure?.snapshotId || latestFailure?.snapshot_id || latestFailure?.executionId || latestFailure?.execution_id || latestFailure?.id || test.id
  }
  const getFailureBugForContext = (test: any) => {
    const latestFailure = getCurrentBuildFailureContext(test)
    const snapshotId = latestFailure?.snapshotId || latestFailure?.snapshot_id || null
    const executionId = latestFailure?.executionId || latestFailure?.execution_id || latestFailure?.id || null
    if (!snapshotId && !executionId) return null
    return getOpenBugsForCase(test).find((bug: any) => (
      (snapshotId && String(bug.snapshot_id || '') === String(snapshotId)) ||
      (executionId && String(bug.ejecucion_id || '') === String(executionId))
    )) || null
  }
  const isHistoryItemFromCurrentBuild = (item: any) => {
    if (!currentBuildId) return false
    const itemBuildId = item?.buildId || item?.build_id || null
    return Boolean(itemBuildId) && String(itemBuildId) === String(currentBuildId)
  }
  const getCurrentBuildFailureContext = (test: any) => {
    const latest = normalizeExecutionHistory(test)[0]
    if (!latest || !isFailureResult(latest.status)) return null
    if (!isHistoryItemFromCurrentBuild(latest)) return null
    return latest
  }
  const handleInternalBugClick = async (event: MouseEvent<HTMLElement>, test: any) => {
    event.stopPropagation()
    if (!getCurrentBuildFailureContext(test)) {
      showFeedback('Bug interno', 'Primero ejecuta esta prueba en la build actual y guarda un resultado fallido o bloqueado.', 'warning')
      return
    }
    const reportedBug = caseBugLinks[test.id] || getFailureBugForContext(test)
    if (reportedBug) {
      onOpenBugTracker?.()
      return
    }
    const bug = await onCreateInternalBugFromCase?.(test)
    if (bug) setCaseBugLinks(prev => ({ ...prev, [test.id]: bug }))
  }
  const renderInternalBugButton = (test: any, compact = false) => {
    const failureContext = getCurrentBuildFailureContext(test)
    if (!canCreateBugs || !onCreateInternalBugFromCase || !failureContext) return null
    const contextId = getFailureBugContextId(test)
    const linkedBug = caseBugLinks[test.id] || getFailureBugForContext(test)
    const isCreating = creatingInternalBugContextId === contextId
    const title = linkedBug ? `${linkedBug.codigo} ya reporta esta ejecucion` : 'Preparar bug interno desde la ejecucion fallida de esta build'
    return (
      <Button
        variant={linkedBug ? 'danger' : 'outline-danger'}
        size="sm"
        className={`fw-bold d-inline-flex align-items-center justify-content-center gap-1 ${compact ? 'p-0' : ''}`}
        style={compact ? { width: 30, height: 30 } : undefined}
        disabled={isCreating}
        onClick={(event) => handleInternalBugClick(event, test)}
        title={title}
        aria-label={title}
      >
        <Bug size={compact ? 13 : 15} />
        {!compact && (isCreating ? 'Preparando...' : linkedBug ? `Bug reportado ${linkedBug.codigo}` : 'Preparar bug interno')}
      </Button>
    )
  }

  return (
    <div className="execution-page mobile-stack d-flex h-100 overflow-hidden animate__animated animate__fadeIn">
      <div className={`execution-sidebar border-end bg-light shadow-sm text-start d-flex flex-column position-relative ${mobileExplorerOpen ? 'is-open' : ''}`} style={{ width: `${suiteExplorerWidth}px`, minWidth: '260px', maxWidth: '560px', flexShrink: 0 }}>
        <div className="p-3 bg-white border-bottom fw-bold text-muted small d-flex flex-column gap-2">
          <div className="d-flex justify-content-between align-items-center">
            <span className="d-flex align-items-center gap-1">
              EXPLORADOR
              <Button
                type="button"
                variant="link"
                size="sm"
                className="p-0 text-primary shadow-none"
                title="Ver significado de métricas"
                onClick={() => showFeedback('Métricas de ejecución', 'El contador usa el orden pasadas / fallidas / bloqueadas / sin correr. Verde: pasadas, rojo: fallidas, azul: bloqueadas, gris: sin correr.', 'info')}
              >
                <Info size={14} />
              </Button>
            </span>
            <Button variant="link" size="sm" className="p-0 text-decoration-none x-small fw-bold" onClick={() => {
              setSelectedSubSuiteId(null)
              setSelectedExecutionTestIds([])
              setTestSearchQuery('')
              setSelectedTest(null)
            }}>Limpiar</Button>
          </div>
          <div className="input-group input-group-sm mt-1">
            <span className="input-group-text bg-light border-end-0 text-muted">
              <Search size={14} />
            </span>
            <Form.Control
              type="text"
              placeholder="Buscar prueba..."
              className="bg-light border-start-0 shadow-none ps-0"
              value={testSearchQuery}
              onChange={(event) => setTestSearchQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="p-2 overflow-auto flex-grow-1 pb-5">
          {executionInitialLoading ? (
            <div className="text-center text-muted p-3 small"><div className="spinner-border spinner-border-sm mb-2" /><br />Cargando...</div>
          ) : executionSuiteTree.length === 0 ? (
            <div className="text-center text-muted p-3 small">
              <Folders size={24} className="mb-2 opacity-40 d-block mx-auto" />
              {currentBuildId ? 'La build activa no tiene casos asignados.' : 'No hay suites disponibles.'}
            </div>
          ) : (
            <>
              {executionRefreshing && (
                <div className="d-flex align-items-center gap-2 text-primary x-small fw-bold mb-2 px-2">
                  <RefreshCw size={12} className="animate-pulse" />
                  Actualizando...
                </div>
              )}
              {renderExecutionSuiteTree(executionSuiteTree)}
            </>
          )}
        </div>
        <div
          onMouseDown={startSuiteExplorerResize}
          title="Arrastrar para cambiar ancho"
          style={{ position: 'absolute', top: 0, right: -4, width: 8, height: '100%', cursor: 'col-resize', zIndex: 5 }}
        />
      </div>

      <div className="execution-content flex-grow-1 d-flex flex-column overflow-hidden text-start" style={{ minWidth: 0 }}>
        <div className="p-3 bg-white border-bottom d-flex justify-content-between align-items-center sticky-top z-1 app-toolbar" style={{ flexWrap: 'wrap', gap: '8px' }}>
          <div className="d-flex align-items-center gap-3">
            <h6 className="m-0 fw-bold text-dark">
              {testSearchQuery.trim() !== '' ? (
                <span className="text-primary"><Search size={16} className="me-1" />"{testSearchQuery}"</span>
              ) : (
                <>{findSuiteById(suitesTree, selectedSuiteId)?.nombre || 'Todos los casos'}</>
              )}
            </h6>
            <div className="d-flex gap-2 align-items-center">
              <span className="badge rounded-pill" style={{ background: '#e9ecef', color: '#495057', fontSize: '11px' }}>
                {visibleTests.length} casos
              </span>
              {canViewBugs && (openBugsLoading || openBugTotal > 0 || bugCaseFilter !== 'all') && (
                <div className="d-flex align-items-center gap-1">
                  <Bug size={13} className="text-danger" />
                  <Form.Select
                    size="sm"
                    value={bugCaseFilter}
                    disabled={openBugsLoading}
                    onChange={(event) => setBugCaseFilter(event.target.value as 'all' | 'open' | 'retest')}
                    className={`x-small fw-bold py-0 ${bugCaseFilter === 'all' ? 'border-danger text-danger' : 'bg-danger text-white border-danger'}`}
                    style={{ width: 190, height: 24 }}
                    title="Filtrar por bugs relacionados"
                  >
                    <option value="all">{openBugsLoading ? 'Cargando bugs...' : `Todos (${openBugTotal} bug${openBugTotal === 1 ? '' : 's'})`}</option>
                    <option value="open">Con bugs abiertos ({openBugCaseCount} caso{openBugCaseCount === 1 ? '' : 's'})</option>
                    <option value="retest">Pendientes retest ({retestBugCaseCount} caso{retestBugCaseCount === 1 ? '' : 's'})</option>
                  </Form.Select>
                </div>
              )}
              {executionRefreshing && (
                <span className="badge rounded-pill bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 d-flex align-items-center gap-1" style={{ fontSize: '11px' }}>
                  <RefreshCw size={10} className="animate-pulse" /> Actualizando
                </span>
              )}
              {visibleTests.some(test => getExecutionStatusKey(test) === 'passed') && (
                <span className="badge rounded-pill bg-success bg-opacity-10 text-success border border-success border-opacity-25" style={{ fontSize: '11px' }}>
                  ✓ {visibleTests.filter(test => getExecutionStatusKey(test) === 'passed').length} pasados
                </span>
              )}
              {visibleTests.some(test => getExecutionStatusKey(test) === 'failed') && (
                <span className="badge rounded-pill bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25" style={{ fontSize: '11px' }}>
                  ✗ {visibleTests.filter(test => getExecutionStatusKey(test) === 'failed').length} fallidos
                </span>
              )}
              {visibleTests.some(test => getExecutionStatusKey(test) === 'pending') && (
                <span className="badge rounded-pill bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-25" style={{ fontSize: '11px' }}>
                  — {visibleTests.filter(test => getExecutionStatusKey(test) === 'pending').length} sin correr
                </span>
              )}
            </div>
          </div>
          <div className="d-flex align-items-center gap-2">
            <Button
              variant="outline-primary"
              size="sm"
              className="mobile-only align-items-center justify-content-center gap-1 fw-bold"
              onClick={() => setMobileExplorerOpen(current => !current)}
            >
              <Folders size={14} /> {mobileExplorerOpen ? 'Ocultar explorador' : 'Explorador'}
            </Button>
            <Badge bg="light" text="dark" className="border">{selectedExecutionTests.length} sel.</Badge>
            {canViewBuildHistory && (
              <Button variant="outline-secondary" size="sm" className="fw-bold d-flex align-items-center gap-1" onClick={onOpenBuildHistory}>
                <History size={14} /> Historial de esta build
              </Button>
            )}
            {canStartAnyExecution && (
              <Button
                variant="primary"
                size="sm"
                className="fw-bold px-4 shadow-sm border-0"
                disabled={selectedExecutionTests.length === 0}
                title={selectedExecutionTests.length === 0 ? 'Selecciona al menos un caso ejecutable' : undefined}
                onClick={openExecutionSelector}
              >
                <PlayCircle size={15} className="me-1" /> INICIAR EJECUCIÓN
              </Button>
            )}
          </div>
        </div>

        <div className="d-flex flex-grow-1 overflow-hidden">
          <div className="flex-grow-1 overflow-auto">
            <div className="execution-mobile-cards">
              {visibleTests.map(test => {
                const isSelected = selectedTest?.id === test.id
                const lastResultColor = getLastResultColor(test)
                const trend = getTrend(test)
                const isResultHydrating = activeBuildResultsLoading && !activeBuildResultsLoaded
                const openBugs = getOpenBugsForCase(test)
                return (
                  <div
                    key={test.id}
                    className={`execution-case-card p-3 ${isSelected ? 'border-primary' : ''}`}
                    onClick={() => handleSelectTestForExecution(test)}
                  >
                    <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="font-monospace fw-bold x-small text-secondary">{test.code || test.id.slice(0, 8).toUpperCase()}</div>
                        <div className="fw-bold text-dark text-break">{test.title}</div>
                        <div className="x-small text-muted mt-1">v{test.version} actual - {test.type}</div>
                      </div>
                      <div onClick={(event) => event.stopPropagation()}>
                        <Form.Check checked={selectedExecutionTestIds.includes(test.id)} onChange={() => toggleExecutionSelection(test.id)} />
                      </div>
                    </div>

                    <div className="d-flex flex-wrap gap-2 mb-3">
                      <Badge bg="light" text="dark" className="border">{test.component}</Badge>
                      <Badge bg={test.priority === 'ALTA' || test.priority === 'CRITICA' ? 'danger' : test.priority === 'BAJA' ? 'secondary' : 'warning'} text={test.priority === 'MEDIA' ? 'dark' : undefined}>{test.priority || '-'}</Badge>
                      <Badge bg={test.criticality === 'CRITICA' ? 'danger' : test.criticality === 'ALTA' ? 'warning' : 'light'} text="dark" className="border">{test.criticality || '-'}</Badge>
                      {test.stepsCount != null && <Badge bg="light" text="dark" className="border">{test.stepsCount} pasos</Badge>}
                      {isOutdatedExecutionCase(test) && <Badge bg="warning" text="dark" className="border">Nueva v{test.latestVersion}</Badge>}
                      {renderOpenBugBadge(test)}
                    </div>
                    {openBugs.length > 0 && (
                      <Alert variant={openBugs.some(isRetestBug) ? 'warning' : 'danger'} className="py-2 px-3 x-small mb-3">
                        {openBugs.some(isRetestBug)
                          ? 'Tiene bug pendiente de retest en esta prueba.'
                          : `Tiene ${openBugs.length} bug${openBugs.length > 1 ? 's' : ''} abierto${openBugs.length > 1 ? 's' : ''} relacionado${openBugs.length > 1 ? 's' : ''}.`}
                      </Alert>
                    )}

                    <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
                      {test.lastResult ? (
                        <Badge bg={lastResultColor} className="text-uppercase">
                          {test.lastResult}
                          {test.lastExecutedVersion ? ` - v${test.lastExecutedVersion}` : ''}
                        </Badge>
                      ) : isResultHydrating ? (
                        <span className="text-muted small">Cargando resultado...</span>
                      ) : (
                        <Badge bg="light" text="secondary" className="border">Sin correr</Badge>
                      )}
                      {trend && <Badge bg="light" text="dark" className="border">Tendencia: {trend === 'up' ? 'mejoro' : trend === 'down' ? 'empeoro' : 'igual'}</Badge>}
                    </div>

                    <div className="d-flex flex-column gap-2">
                      {test.lastExecutedAt && (
                        <div className="x-small text-muted">
                          <Clock size={12} className="me-1" />{test.lastExecutedAt}
                          {test.lastExecutedBy ? ` - ${test.lastExecutedBy}` : ''}
                        </div>
                      )}
                      {canStartAnyExecution && (
                        <Button
                          variant="outline-success"
                          size="sm"
                          className="fw-bold"
                          onClick={(event) => {
                            event.stopPropagation()
                            openSingleCaseExecutionSelector(test)
                          }}
                        >
                          <PlayCircle size={15} className="me-1" /> {getExecutionActionLabel(test)}
                        </Button>
                      )}
                      {renderInternalBugButton(test)}
                    </div>
                  </div>
                )
              })}
              {executionInitialLoading && visibleTests.length === 0 && (
                <div className="text-center py-5 text-muted small">Cargando pruebas del proyecto...</div>
              )}
              {!executionInitialLoading && visibleTests.length === 0 && (
                <div className="text-center py-5 text-muted small">
                  {bugCaseFilter === 'open'
                    ? 'No hay pruebas con bugs abiertos en esta vista.'
                    : bugCaseFilter === 'retest'
                      ? 'No hay pruebas pendientes de retest en esta vista.'
                      : 'No se encontraron pruebas.'}
                </div>
              )}
            </div>

            <Table hover size="sm" className="execution-desktop-table mb-0 align-middle border-0" style={{ tableLayout: 'fixed' }}>
              <thead className="bg-light text-dark sticky-top" style={{ top: 0 }}>
                <tr className="x-small text-muted text-uppercase border-bottom">
                  <th className="ps-3 py-3 border-0" style={{ width: '40px' }}>
                    <Form.Check
                      checked={allVisibleExecutionTestsSelected}
                      onChange={(event) => toggleVisibleExecutionSelection(event.target.checked)}
                    />
                  </th>
                  <th className="py-3 border-0" style={{ width: '80px' }}>Código</th>
                  <th className="border-0" style={{ width: '300px' }}>Nombre</th>
                  <th className="border-0" style={{ width: '80px' }}>Prior.</th>
                  <th className="border-0" style={{ width: '80px' }}>Criti.</th>
                  <th className="border-0" style={{ width: '55px', textAlign: 'center' }}>Pasos</th>
                  <th className="border-0" style={{ width: '120px' }}>Último resultado</th>
                  <th className="border-0" style={{ width: '90px', textAlign: 'center' }}>Tendencia</th>
                  <th className="border-0" style={{ width: '140px' }}>Última ejecución</th>
                  <th className="border-0 text-end pe-3" style={{ width: '150px' }}>Acciones</th>
                </tr>
              </thead>
              <tbody className="text-dark">
                {visibleTests.map(test => {
                  const isSelected = selectedTest?.id === test.id
                  const lastResultColor = getLastResultColor(test)
                  const trend = getTrend(test)
                  const isResultHydrating = activeBuildResultsLoading && !activeBuildResultsLoaded
                  const testCode = test.code || test.id.slice(0, 8).toUpperCase()
                  const testFullName = String(test.title || 'Sin nombre')
                  const testTooltip = `${testCode} - ${testFullName}`
                  return (
                    <tr
                      key={test.id}
                      className={`cursor-pointer border-bottom ${isSelected ? 'table-primary' : ''}`}
                      onClick={() => handleSelectTestForExecution(test)}
                      style={{ transition: 'background 0.1s' }}
                    >
                      <td className="ps-3" onClick={(event) => event.stopPropagation()}>
                        <Form.Check checked={selectedExecutionTestIds.includes(test.id)} onChange={() => toggleExecutionSelection(test.id)} />
                      </td>
                      <td className="fw-bold text-secondary font-monospace" style={{ fontSize: '11px' }}>{testCode}</td>
                      <td>
                        <div className="fw-semibold text-dark small text-truncate" style={{ maxWidth: '290px' }} title={testTooltip} aria-label={testTooltip}>
                          <span className="text-truncate" title={testTooltip} aria-label={testTooltip}>{testFullName}</span>
                        </div>
                        <div className="x-small text-muted d-flex align-items-center gap-1 flex-wrap">
                          <span>v{test.version} actual · {test.type}</span>
                          {isOutdatedExecutionCase(test) && (
                            <Badge bg="warning" text="dark" className="border x-small">Nueva v{test.latestVersion}</Badge>
                          )}
                          {renderOpenBugBadge(test)}
                        </div>
                      </td>
                      <td><Badge bg={test.priority === 'ALTA' || test.priority === 'CRITICA' ? 'danger' : test.priority === 'BAJA' ? 'secondary' : 'warning'} text={test.priority === 'MEDIA' ? 'dark' : undefined} className="x-small">{test.priority || '—'}</Badge></td>
                      <td><Badge bg={test.criticality === 'CRITICA' ? 'danger' : test.criticality === 'ALTA' ? 'warning' : 'light'} text={test.criticality === 'CRITICA' ? undefined : 'dark'} className="border x-small">{test.criticality || '—'}</Badge></td>
                      <td className="text-center">
                        {test.stepsCount != null ? (
                          <span className="badge rounded-pill bg-light text-dark border x-small fw-bold">{test.stepsCount}</span>
                        ) : (
                          <span className="text-muted x-small">—</span>
                        )}
                      </td>
                      <td>
                        {test.lastResult ? (
                          <Badge bg={lastResultColor} className="x-small text-uppercase w-100 text-center" style={{ letterSpacing: '0.5px' }}>
                            {test.lastResult === 'PASO' || test.lastResult === 'OK' ? '✓ PASÓ' :
                              test.lastResult === 'FALLO' || test.lastResult === 'FALLIDO' ? '✗ FALLÓ' :
                              test.lastResult}
                            {test.lastExecutedVersion ? ` · v${test.lastExecutedVersion}` : ''}
                          </Badge>
                        ) : isResultHydrating ? (
                          <span className="text-muted x-small">Cargando...</span>
                        ) : (
                          <span className="text-muted x-small">Sin correr</span>
                        )}
                      </td>
                      <td className="text-center">
                        {trend === 'up' && (
                          <div className="d-flex flex-column align-items-center" title="Mejoró respecto a ejecución anterior">
                            <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#e8f5e9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <ChevronRight size={14} className="text-success" style={{ transform: 'rotate(-90deg)' }} />
                            </div>
                            <div className="x-small text-success fw-bold" style={{ fontSize: '9px' }}>MEJORÓ</div>
                          </div>
                        )}
                        {trend === 'down' && (
                          <div className="d-flex flex-column align-items-center" title="Empeoró respecto a ejecución anterior">
                            <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#ffebee', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <ChevronRight size={14} className="text-danger" style={{ transform: 'rotate(90deg)' }} />
                            </div>
                            <div className="x-small text-danger fw-bold" style={{ fontSize: '9px' }}>EMPEORÓ</div>
                          </div>
                        )}
                        {trend === 'same' && (
                          <div className="d-flex flex-column align-items-center" title="Se mantuvo igual">
                            <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#f8f9fa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <div style={{ width: '10px', height: '2px', background: '#6c757d' }} />
                            </div>
                            <div className="x-small text-muted fw-bold" style={{ fontSize: '9px' }}>IGUAL</div>
                          </div>
                        )}
                        {!trend && (
                          <span className="text-muted x-small">—</span>
                        )}
                      </td>
                      <td>
                        {test.lastExecutedAt ? (
                          <div>
                            <div className="x-small text-dark text-truncate" style={{ maxWidth: '120px' }} title={test.lastExecutedAt}>{test.lastExecutedAt}</div>
                            {test.lastExecutedBy && <div className="x-small text-muted text-truncate" style={{ maxWidth: '120px' }} title={test.lastExecutedBy}><User size={10} className="me-1" />{test.lastExecutedBy}</div>}
                          </div>
                        ) : (
                          <span className="text-muted x-small">—</span>
                        )}
                      </td>
                      <td className="text-end pe-3">
                        <div className="d-inline-flex align-items-center justify-content-end gap-2">
                          {renderInternalBugButton(test, true)}
                          {canStartAnyExecution && (
                            <Button
                              variant="link"
                              size="sm"
                              className="p-0 text-success shadow-none"
                              title="Quick run manual"
                              onClick={(event) => {
                                event.stopPropagation()
                                openSingleCaseExecutionSelector(test)
                              }}
                            >
                              <PlayCircle size={16} />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {executionInitialLoading && visibleTests.length === 0 && (
                  <tr>
                    <td colSpan={10} className="text-center py-5 text-muted small">
                      <RefreshCw size={24} className="mb-2 opacity-50 d-block mx-auto animate-pulse" />
                      Cargando pruebas del proyecto...
                    </td>
                  </tr>
                )}
                {!executionInitialLoading && visibleTests.length === 0 && (
                  <tr>
                    <td colSpan={10} className="text-center py-5 text-muted small">
                      <Search size={24} className="mb-2 opacity-50 d-block mx-auto" />
                      {bugCaseFilter === 'open'
                        ? 'No hay pruebas con bugs abiertos en esta vista.'
                        : bugCaseFilter === 'retest'
                          ? 'No hay pruebas pendientes de retest en esta vista.'
                          : 'No se encontraron pruebas.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </div>

          {selectedTest && (
            <div
              className="execution-detail-panel border-start bg-white d-flex flex-column text-start animate__animated animate__fadeInRight"
              style={{ width: '320px', minWidth: '320px', boxShadow: '-4px 0 16px rgba(0,0,0,0.06)' }}
            >
              <div className="p-3 border-bottom d-flex justify-content-between align-items-start bg-primary bg-gradient text-white">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="x-small opacity-75 text-uppercase fw-bold mb-1" style={{ letterSpacing: '0.8px' }}>{selectedTest.code}</div>
                  <div className="fw-bold" style={{ fontSize: '13px', lineHeight: '1.3' }}>{selectedTest.title}</div>
                </div>
                <Button
                  variant="link"
                  size="sm"
                  className="p-0 ms-2 text-white opacity-75"
                  onClick={() => setSelectedTest(null)}
                >
                  <XCircle size={18} />
                </Button>
              </div>

              <div className="flex-grow-1 overflow-auto p-0">
                {selectedTest.lastResult && (
                  <div className="p-3 border-bottom">
                    <div className="x-small fw-bold text-muted text-uppercase mb-2" style={{ letterSpacing: '0.7px' }}>Última ejecución</div>
                    <div className={`rounded-2 p-2 x-small
                      ${selectedTest.lastResult === 'PASO' || selectedTest.lastResult === 'OK'
                        ? 'bg-success bg-opacity-10 text-success'
                        : selectedTest.lastResult === 'FALLO' || selectedTest.lastResult === 'FALLIDO'
                        ? 'bg-danger bg-opacity-10 text-danger'
                        : 'bg-warning bg-opacity-10 text-warning'}`}
                    >
                      <div className="d-flex align-items-center gap-2 fw-bold text-uppercase" style={{ letterSpacing: '0.4px' }}>
                        {(selectedTest.lastResult === 'PASO' || selectedTest.lastResult === 'OK') && <CheckCircle2 size={14} />}
                        {(selectedTest.lastResult === 'FALLO' || selectedTest.lastResult === 'FALLIDO') && <XCircle size={14} />}
                        {selectedTest.lastResult === 'BLOQUEADO' && <AlertCircle size={14} />}
                        <span>{selectedTest.lastResult}</span>
                        {selectedTest.lastExecutedVersion ? (
                          <Badge bg="light" text="dark" className="border ms-auto x-small">Ejecutada como v{selectedTest.lastExecutedVersion}</Badge>
                        ) : (
                          <Badge bg="light" text="dark" className="border ms-auto x-small">Versión no registrada</Badge>
                        )}
                      </div>
                      <div className="d-flex flex-column gap-1 mt-2 text-muted">
                        {selectedTest.lastExecutedAt && (
                          <span><Clock size={11} className="me-1" />{selectedTest.lastExecutedAt}</span>
                        )}
                        {selectedTest.lastExecutedBy && (
                          <span><User size={11} className="me-1" />{selectedTest.lastExecutedBy}</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="p-3 border-bottom">
                  <div className="x-small fw-bold text-muted text-uppercase mb-2" style={{ letterSpacing: '0.7px' }}>Caso actual</div>
                  <div className="x-small text-muted mb-2">
                    <span className="fw-semibold text-dark">Versión actual:</span> v{selectedTest.version}
                  </div>
                  <div className="d-flex flex-wrap gap-1 mb-2">
                    <Badge bg={selectedTest.priority === 'ALTA' || selectedTest.priority === 'CRITICA' ? 'danger' : selectedTest.priority === 'BAJA' ? 'secondary' : 'warning'} text={selectedTest.priority === 'MEDIA' ? 'dark' : undefined} className="x-small">Prior. {selectedTest.priority || '—'}</Badge>
                    <Badge bg={selectedTest.criticality === 'CRITICA' ? 'danger' : selectedTest.criticality === 'ALTA' ? 'warning' : 'light'} text="dark" className="border x-small">Criti. {selectedTest.criticality || '—'}</Badge>
                    <Badge bg={selectedTest.caseStatus === 'EN_REVISION' ? 'info' : selectedTest.caseStatus === 'DEPRECADO' || selectedTest.caseStatus === 'ARCHIVADO' ? 'secondary' : 'success'} className="x-small">{selectedTest.caseStatus || 'ACTIVO'}</Badge>
                    <Badge bg="light" text="dark" className="border x-small">{selectedTest.type}</Badge>
                  </div>
                  <div className="x-small text-muted d-flex flex-column gap-1">
                    <div><span className="fw-semibold text-dark">Componente:</span> {selectedTest.component}</div>
                    {isOutdatedExecutionCase(selectedTest) && (
                      <div className="text-warning fw-semibold">Nueva versión disponible: v{selectedTest.latestVersion}</div>
                    )}
                    {selectedTest.stepsCount != null && <div><span className="fw-semibold text-dark">Pasos:</span> {selectedTest.stepsCount}</div>}
                  </div>
                </div>

                {getOpenBugsForCase(selectedTest).length > 0 && (
                  <div className="p-3 border-bottom">
                    <div className="x-small fw-bold text-muted text-uppercase mb-2 d-flex align-items-center justify-content-between" style={{ letterSpacing: '0.7px' }}>
                      <span className="d-flex align-items-center gap-1">
                        <Bug size={13} /> Bugs relacionados
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="p-0 text-primary shadow-none"
                          title="Ver significado de bugs relacionados"
                          aria-label="Información sobre bugs relacionados"
                          onClick={() => showFeedback('Bugs relacionados', 'El contador muestra bugs asociados a este caso. Cada chip separa estado, severidad/prioridad y criticidad.', 'info')}
                        >
                          <Info size={13} />
                        </Button>
                      </span>
                      <Badge bg="danger" className="x-small">{getOpenBugsForCase(selectedTest).length}</Badge>
                    </div>
                    <div className="d-flex flex-column gap-2">
                      {getOpenBugsForCase(selectedTest).slice(0, 4).map((bug: any) => {
                        const statusBadge = getBugStatusBadge(bug)
                        const severityBadge = getBugSeverityBadge(bug.severidad)
                        const priorityBadge = getBugPriorityPresentation(bug.prioridad)
                        const criticalityBadge = getBugCriticalityBadge(bug.criticidad)
                        const detailBadges = [severityBadge, priorityBadge, criticalityBadge].filter(Boolean)
                        return (
                          <div key={bug.id || bug.codigo} className="rounded-2 border p-2 bg-light x-small">
                            <div className="d-flex align-items-center justify-content-between gap-2">
                              <span className="fw-bold text-dark">{bug.codigo}</span>
                              <Badge bg={statusBadge.bg} text={statusBadge.text} className="x-small">
                                {statusBadge.label}
                              </Badge>
                            </div>
                            {detailBadges.length > 0 && (
                              <div className="d-flex flex-wrap gap-1 mt-2">
                                {detailBadges.map((badge: any) => (
                                  <Badge key={badge.label} bg={badge.bg} text={badge.text} title={badge.title || badge.label} className={`x-small ${badge.bg === 'light' ? 'border' : ''}`}>
                                    {badge.label}
                                  </Badge>
                                ))}
                              </div>
                            )}
                            <div className="text-dark mt-1 text-truncate" title={bug.titulo}>{bug.titulo}</div>
                            <div className="text-muted mt-1">
                              {bug.build_code || bug.metadata_json?.build_name || bug.build_id ? `Origen: ${bug.build_code || bug.metadata_json?.build_name || String(bug.build_id).slice(0, 8)}` : 'Origen de build no registrado'}
                            </div>
                          </div>
                        )
                      })}
                      {getOpenBugsForCase(selectedTest).length > 4 && (
                        <div className="text-muted x-small text-center">+ {getOpenBugsForCase(selectedTest).length - 4} bugs relacionados</div>
                      )}
                      {onOpenBugTracker && (
                        <Button variant="outline-danger" size="sm" className="fw-bold d-flex align-items-center justify-content-center gap-1" onClick={onOpenBugTracker}>
                          <Bug size={14} /> Ver en Bug Tracker
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                <div className="p-3 border-bottom">
                  <div className="x-small fw-bold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.7px' }}>Descripción / Objetivo</div>
                  <p className={`x-small mb-0 ${selectedTest.description ? 'text-dark' : 'text-muted fst-italic'}`} style={{ lineHeight: '1.5' }}>
                    {selectedTest.description || 'Sin descripción registrada.'}
                  </p>
                </div>

                {selectedTest.pre && (
                  <div className="p-3 border-bottom">
                    <div className="x-small fw-bold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.7px' }}>Precondiciones</div>
                    <p className="x-small text-dark mb-0" style={{ lineHeight: '1.5' }}>{selectedTest.pre}</p>
                  </div>
                )}

                {selectedTest.post && (
                  <div className="p-3 border-bottom">
                    <div className="x-small fw-bold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.7px' }}>Postcondiciones</div>
                    <p className="x-small text-dark mb-0" style={{ lineHeight: '1.5' }}>{selectedTest.post}</p>
                  </div>
                )}

                <div className="p-3 border-bottom">
                  {(() => {
                    const executionHistory = normalizeExecutionHistory(selectedTest)
                    const { total, passed, failed, successRate } = getExecutionHistoryStats(executionHistory)
                    return (
                      <>
                        <div className="x-small fw-bold text-muted text-uppercase mb-2 d-flex align-items-center justify-content-between" style={{ letterSpacing: '0.7px' }}>
                          <div className="d-flex align-items-center gap-1">
                            <History size={13} /> Historial de ejecuciones
                          </div>
                          {total > 0 && (
                            <Badge bg="light" text="dark" className="border x-small">{total} ejecuciones</Badge>
                          )}
                        </div>

                        {total > 0 && (
                          <div className="d-flex gap-2 mb-3">
                            <div className="flex-grow-1 p-2 rounded-2 text-center" style={{ background: '#e8f5e9', fontSize: '11px' }}>
                              <div className="fw-bold text-success">{successRate}%</div>
                              <div className="text-muted x-small">Tasa de éxito</div>
                            </div>
                            <div className="flex-grow-1 p-2 rounded-2 text-center" style={{ background: '#f8f9fa', fontSize: '11px' }}>
                              <div className="fw-bold text-dark">{total}</div>
                              <div className="text-muted x-small">Total</div>
                            </div>
                            <div className="flex-grow-1 p-2 rounded-2 text-center" style={{ background: '#e8f5e9', fontSize: '11px' }}>
                              <div className="fw-bold text-success">{passed}</div>
                              <div className="text-muted x-small">Pasados</div>
                            </div>
                            <div className="flex-grow-1 p-2 rounded-2 text-center" style={{ background: failed > 0 ? '#ffebee' : '#f8f9fa', fontSize: '11px' }}>
                              <div className={failed > 0 ? 'fw-bold text-danger' : 'fw-bold text-muted'}>{failed}</div>
                              <div className="text-muted x-small">Fallidos</div>
                            </div>
                          </div>
                        )}

                        {total > 0 ? (
                          <div className="d-flex flex-column gap-2">
                            {executionHistory.slice(0, 5).map((historyItem: any, index: number) => {
                              const statusColor = historyItem.status === 'PASO' || historyItem.status === 'OK' ? '#198754' :
                                historyItem.status === 'FALLO' || historyItem.status === 'FALLIDO' ? '#dc3545' :
                                historyItem.status === 'BLOQUEADO' ? '#ffc107' : '#6c757d'
                              return (
                                <div key={`${historyItem.date || 'hist'}-${index}`} className="d-flex align-items-start gap-2 p-2 rounded-2" style={{ background: '#f8f9fa', fontSize: '11px', opacity: 0.9 }}>
                                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, marginTop: '4px', background: statusColor }} />
                                  <div className="flex-grow-1">
                                    <div className="d-flex justify-content-between align-items-center">
                                      <div className="d-flex align-items-center gap-1">
                                        <Badge bg={getStatusColor(historyItem.status)} className="x-small">{historyItem.status?.toUpperCase()}</Badge>
                                        {historyItem.versionExecuted && (
                                          <Badge bg="light" text="dark" className="border x-small">v{historyItem.versionExecuted}</Badge>
                                        )}
                                      </div>
                                      <div className="text-muted" style={{ fontSize: '10px' }}>{historyItem.date}</div>
                                    </div>
                                    {historyItem.executedBy && (
                                      <div className="text-muted mt-1 d-flex align-items-center gap-1" style={{ fontSize: '10px' }}>
                                        <User size={9} />
                                        <span>{historyItem.executedBy}</span>
                                      </div>
                                    )}
                                    {historyItem.duration && (
                                      <div className="text-muted mt-1" style={{ fontSize: '10px' }}>
                                        <Clock size={9} className="me-1" />
                                        <span>{historyItem.duration}</span>
                                      </div>
                                    )}
                                    <div className="text-muted mt-1" style={{ fontSize: '10px' }}>
                                      <span className="fw-semibold text-dark">Obs:</span> {historyItem.observation || 'Sin observaciones registradas'}
                                    </div>
                                    {historyItem.testRunId && (
                                      <Button
                                        variant="link"
                                        size="sm"
                                        className="p-0 x-small text-decoration-none fw-bold mt-1"
                                        onClick={() => onOpenRunHistory(historyItem.testRunId)}
                                      >
                                        Ver ejecucion
                                      </Button>
                                    )}
                                    {(historyItem.evidenceUrl || historyItem.evidencias?.length > 0) && (
                                      <div className="d-flex flex-wrap gap-2 mt-2 pt-2 border-top border-light-subtle">
                                        {historyItem.evidencias?.length > 0 ? (
                                          historyItem.evidencias.map((attachment: AttachmentMeta) => (
                                            isEvidenceAvailable(attachment) && isImageAsset(attachment) ? (
                                              <button
                                                type="button"
                                                key={attachment.id}
                                                className="border rounded-2 bg-white p-0"
                                                title={attachment.filename_original}
                                                onClick={() => onOpenEvidence(attachment)}
                                              >
                                                <img src={resolveAssetUrl(attachment.public_url)} alt={attachment.filename_original} className="rounded-2" style={{ width: 34, height: 34, objectFit: 'cover' }} />
                                              </button>
                                            ) : (
                                              <Button key={attachment.id} variant={isEvidenceAvailable(attachment) ? 'link' : 'outline-warning'} size="sm" className={`${isEvidenceAvailable(attachment) ? 'p-0' : 'py-0 px-1'} x-small text-decoration-none d-flex align-items-center gap-1 fw-bold`} onClick={() => onOpenEvidence(attachment)}>
                                                <FileText size={13}/> {attachment.filename_original || 'Ver evidencia'}
                                                {!isEvidenceAvailable(attachment) && <Badge bg="warning" text="dark">Archivo no disponible</Badge>}
                                              </Button>
                                            )
                                          ))
                                        ) : (
                                          <Button variant="link" size="sm" className="p-0 x-small text-decoration-none d-flex align-items-center gap-1 fw-bold" onClick={() => onOpenEvidence(historyItem.evidenceUrl)}>
                                            <ImagePlus size={13}/> Ver evidencia adjunta
                                          </Button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}

                            {total > 5 && (
                              <div className="text-center x-small text-muted mt-2">
                                + {total - 5} ejecuciones anteriores
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-muted x-small d-flex align-items-center gap-2 p-3 rounded-2" style={{ background: '#f8f9fa' }}>
                            <Clock size={14} className="opacity-50" />
                            <span>Sin ejecuciones registradas aún.</span>
                          </div>
                        )}
                      </>
                    )
                  })()}
                </div>
              </div>

              <div className="p-3 border-top bg-light d-flex flex-column gap-2">
                {isOutdatedExecutionCase(selectedTest) && (
                  <Alert variant="warning" className="py-2 px-3 x-small mb-0 border-0">
                    Este caso fue ejecutado como v{selectedTest.version}. Hay una v{selectedTest.latestVersion}; se agregará a la build antes de ejecutar.
                  </Alert>
                )}
                {canStartAnyExecution && (
                  <Button
                    variant="primary"
                    className="w-100 fw-bold d-flex align-items-center justify-content-center gap-2 shadow-sm rounded-pill border-0"
                    onClick={() => openSingleCaseExecutionSelector(selectedTest)}
                  >
                    <PlayCircle size={18} /> {getExecutionActionLabel(selectedTest)}
                  </Button>
                )}
                {renderInternalBugButton(selectedTest)}
                <div className="x-small text-muted text-center">
                  Build activa: <span className="fw-semibold text-dark">{buildsList.find(build => build.id === currentBuildId)?.name || '—'}</span>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
      <RunDetailModal
        detail={runDetail}
        detailLoading={runDetailLoading}
        detailError={runDetailError}
        getStatusColor={getStatusColor}
        onHide={onCloseRunDetail}
        onOpenEvidence={onOpenEvidence}
      />
    </div>
  )
}
