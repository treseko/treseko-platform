import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Form, Modal } from 'react-bootstrap'
import { Cpu, Info, Loader2, PlayCircle, Terminal } from 'lucide-react'
import { useI18n } from '../../i18n'
import { caseFormatPresentation, normalizeCaseFormat, type CaseFormat } from '../casos/caseFormat'

const formatBadgeVariants: Record<CaseFormat, 'success' | 'info' | 'warning' | 'secondary'> = {
  API: 'success',
  CONVERSACIONAL: 'info',
  PERFORMANCE: 'warning',
  CLASICA: 'secondary'
}

type ExecutionSelectorModalProps = {
  show: boolean
  onHide: () => void
  executionModalTests: any[]
  executionModalCandidateTests: any[]
  isChatbotSelection?: boolean
  hasMixedChatbotSelection?: boolean
  executionModalDiscardedCount: number
  executionLoading: boolean
  environments: any[]
  selectedEnvironmentId: string
  setSelectedEnvironmentId: (environmentId: string) => void
  selectedDatasetId: string
  setSelectedDatasetId: (datasetId: string) => void
  datasetPreview: any
  datasetPreviewLoading: boolean
  getExecutionCaseLabel: (test: any) => string
  isOutdatedExecutionCase: (test: any) => boolean
  removeExecutionModalCase: (testId: string) => void
  restoreExecutionModalCases: (testIds: string[]) => void
  onShowDatasetHelp: () => void
  onStart: (mode: 'manual' | 'automated' | 'ia') => void
  canStartManualExecution: boolean
  canUseAutomatedExecution: boolean
  canUseIaExecution: boolean
  iaEnginePremiumLocked?: boolean
  onScheduleIa: () => void
}

export function ExecutionSelectorModal({
  show,
  onHide,
  executionModalTests,
  executionModalCandidateTests,
  isChatbotSelection = false,
  hasMixedChatbotSelection = false,
  executionModalDiscardedCount,
  executionLoading,
  environments,
  selectedEnvironmentId,
  setSelectedEnvironmentId,
  selectedDatasetId,
  setSelectedDatasetId,
  datasetPreview,
  datasetPreviewLoading,
  getExecutionCaseLabel,
  isOutdatedExecutionCase,
  removeExecutionModalCase,
  restoreExecutionModalCases,
  onShowDatasetHelp,
  onStart,
  canStartManualExecution,
  canUseAutomatedExecution,
  canUseIaExecution,
  iaEnginePremiumLocked = false,
  onScheduleIa
}: ExecutionSelectorModalProps) {
  const { t } = useI18n()
  const [startingMode, setStartingMode] = useState<'manual' | 'automated' | 'ia' | null>(null)
  const lastAutoEnvironmentKey = useRef('')
  const lastAutoEnvironmentId = useRef('')
  useEffect(() => {
    if (!executionLoading) setStartingMode(null)
  }, [executionLoading])
  const startExecution = (mode: 'manual' | 'automated') => {
    setStartingMode(mode)
    onStart(mode)
  }
  const scheduleIa = () => {
    setStartingMode('ia')
    onScheduleIa()
  }
  const isStarting = (mode: 'manual' | 'automated' | 'ia') => executionLoading && startingMode === mode
  const hasOutdatedCases = executionModalTests.some(isOutdatedExecutionCase)
  const getCaseFormat = (test: any): CaseFormat => normalizeCaseFormat(test?.format || test?.formato_prueba)
  const [knownFormatCases, setKnownFormatCases] = useState<Record<string, any[]>>({})
  const knownFormatCasesRef = useRef<Record<string, any[]>>({})
  useEffect(() => {
    if (!show) {
      knownFormatCasesRef.current = {}
      setKnownFormatCases({})
      return
    }
    setKnownFormatCases(() => {
      const next = { ...knownFormatCasesRef.current }
      let changed = false
      const candidateTests = executionModalCandidateTests.length > 0 ? executionModalCandidateTests : executionModalTests
      candidateTests.forEach(test => {
        const format = getCaseFormat(test)
        const id = String(test?.id || '')
        if (!id || next[format]?.some(caseItem => String(caseItem?.id) === id)) return
        next[format] = [...(next[format] || []), test]
        changed = true
      })
      if (changed) knownFormatCasesRef.current = next
      return changed ? next : knownFormatCasesRef.current
    })
  }, [executionModalCandidateTests, executionModalTests, show])
  const formatGroups = useMemo(() => {
    const selectedIdsByFormat = new Map<string, string[]>()
    executionModalTests.forEach(test => {
      const format = getCaseFormat(test)
      const ids = selectedIdsByFormat.get(format) || []
      ids.push(String(test.id))
      selectedIdsByFormat.set(format, ids)
    })
    const formats = Array.from(new Set([...Object.keys(knownFormatCases), ...selectedIdsByFormat.keys()]))
    return formats.map(format => {
      const selectedCaseIds = selectedIdsByFormat.get(format) || []
      const knownCases = knownFormatCases[format] || []
      const selectedCases = executionModalTests.filter(test => getCaseFormat(test) === format)
      const allCases = knownCases.length > 0 ? knownCases : selectedCases
      return {
        format,
        count: selectedCaseIds.length,
        totalCount: allCases.length,
        caseIds: allCases.map(test => String(test?.id)),
        cases: allCases,
      }
    })
  }, [executionModalTests, knownFormatCases])
  const allFormatCases = formatGroups.flatMap(group => group.cases)
  const totalKnownCaseCount = allFormatCases.length || executionModalTests.length
  const selectedFormatGroups = formatGroups.filter(group => group.count > 0)
  const hasMixedFormats = selectedFormatGroups.length > 1
  const hasNoCases = executionModalTests.length === 0
  const hasInvalidSelection = hasMixedFormats || hasNoCases
  const isApiSelection = selectedFormatGroups.length === 1 && selectedFormatGroups[0].format === 'API'
  const apiEnvironmentHint = useMemo(() => {
    if (!isApiSelection) return ''
    const hints = executionModalTests
      .map(test => test?.configuracion_api?.metadata?.environment_name || test?.apiConfig?.metadata?.environment_name)
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean)
    return hints.length > 0 && hints.every(value => value === hints[0]) ? hints[0] : ''
  }, [executionModalTests, isApiSelection])
  const apiEnvironment = useMemo(() => {
    if (!apiEnvironmentHint) return null
    return environments.find(environment => {
      const name = String(environment?.name || environment?.nombre || '').toLowerCase()
      const url = String(environment?.url || '').toLowerCase()
      return name.includes(apiEnvironmentHint) || (apiEnvironmentHint.includes('httpbin') && url.includes('httpbin'))
    }) || null
  }, [apiEnvironmentHint, environments])
  const executionSelectionKey = executionModalTests.map(test => String(test?.id || '')).sort().join('|')
  useEffect(() => {
    if (!show || !isApiSelection || !apiEnvironment?.id) return
    if (lastAutoEnvironmentKey.current === executionSelectionKey) return
    const canReplaceCurrentSelection = !selectedEnvironmentId || selectedEnvironmentId === lastAutoEnvironmentId.current
    if (canReplaceCurrentSelection) {
      setSelectedEnvironmentId(String(apiEnvironment.id))
      lastAutoEnvironmentId.current = String(apiEnvironment.id)
    }
    lastAutoEnvironmentKey.current = executionSelectionKey
  }, [apiEnvironment, executionSelectionKey, isApiSelection, selectedEnvironmentId, setSelectedEnvironmentId, show])
  const selectedEnvironment = environments.find(env => env.id === selectedEnvironmentId)
  const environmentDatasets = selectedEnvironment?.datasets || []
  const resolvedVariables = datasetPreview?.variables_resueltas || {}
  const revealResolvedRows = (rows: any[]) => rows.map((item: any) => {
    const value = String(item?.value ?? '')
    const isMasked = /^\*+$/.test(value)
    const resolvedValue = resolvedVariables[item?.key]
    return {
      ...item,
      value: isMasked && resolvedValue != null ? String(resolvedValue) : value
    }
  })
  const environmentDatasetRows = revealResolvedRows(datasetPreview?.dataset_ambiente || [])
  const caseDatasetRows = revealResolvedRows(datasetPreview?.dataset_caso_resuelto || [])
  const hasPreviewData = environmentDatasetRows.length > 0 || caseDatasetRows.length > 0
  const renderDatasetRows = (rows: any[]) => (
    <div className="bg-white border rounded-2 p-2 font-monospace x-small text-break">
      {rows.map((item: any) => (
        <div key={`${item.key}-${item.value}`}>
          <span className="text-secondary">{item.key}=</span>
          <span className="text-primary">{item.value}</span>
        </div>
      ))}
    </div>
  )
  const toggleFormatSelection = (format: CaseFormat, checked: boolean) => {
    const group = formatGroups.find(item => item.format === format)
    if (!group) return
    if (checked) {
      restoreExecutionModalCases(group.caseIds)
      return
    }
    group.caseIds.forEach(removeExecutionModalCase)
  }

  return (
    <Modal show={show} onHide={onHide} centered backdrop="static" size="xl">
      <Modal.Header closeButton closeLabel={t('ejecutarPruebas.closeModal')} className="border-0 pb-0 text-dark">
        <Modal.Title className="fw-bold text-dark">{t('ejecutarPruebas.executionEngine')}</Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-4 d-flex flex-column gap-3 text-dark">
        <div className="small text-muted bg-light border rounded-3 p-2">
          {t('ejecutarPruebas.selectedCasesSummary', { selected: executionModalTests.length, total: totalKnownCaseCount })}
          {executionModalDiscardedCount > 0 && (
            <span className="text-warning ms-2">({executionModalDiscardedCount} {t('ejecutarPruebas.discardedByBuild')})</span>
          )}
        </div>

          {(executionModalTests.length > 0 || formatGroups.length > 0) && (
          <div className="border rounded-3 bg-white p-3">
            <div className="d-flex flex-column gap-2 mb-2">
              <div className="x-small fw-bold text-muted text-uppercase">{t('ejecutarPruebas.casesToExecute')}</div>
              <div className="d-flex flex-wrap justify-content-start align-items-center gap-2">
                {formatGroups.map(({ format, count, totalCount, caseIds }) => {
                  const normalizedFormat = format as CaseFormat
                  const meta = caseFormatPresentation[normalizedFormat]
                  const isSelected = count > 0
                  const Icon = meta.icon
                  return (
                    <div key={format} className="d-inline-flex align-items-center gap-1 flex-shrink-0">
                      <Form.Check
                        id={`execution-format-${format.toLowerCase()}`}
                        type="checkbox"
                        checked={isSelected}
                        onChange={(event) => toggleFormatSelection(normalizedFormat, event.currentTarget.checked)}
                        aria-label={`${t(meta.labelKey)}: ${isSelected ? t('ejecutarPruebas.selected') : t('ejecutarPruebas.notSelected')}`}
                        title={isSelected ? t('ejecutarPruebas.deselectFormatCases', { format: t(meta.labelKey) }) : t('ejecutarPruebas.reselectFormatCases', { format: t(meta.labelKey) })}
                        className="mb-0"
                      />
                      <label htmlFor={`execution-format-${format.toLowerCase()}`} className="mb-0" style={{ cursor: 'pointer' }}>
                        <Badge bg={formatBadgeVariants[format]} className="d-inline-flex align-items-center gap-1"><Icon size={12} aria-hidden="true" />{t(meta.labelKey)}: {count}/{totalCount}</Badge>
                      </label>
                    </div>
                  )
                })}
              </div>
            </div>
            {allFormatCases.length > 0 ? (
              <div className="d-flex flex-column gap-2" style={{ maxHeight: '150px', overflow: 'auto' }}>
                {allFormatCases.map((test: any) => {
                  const isSelected = executionModalTests.some(selectedTest => String(selectedTest?.id) === String(test?.id))
                  const meta = caseFormatPresentation[getCaseFormat(test)]
                  const Icon = meta.icon
                  return (
                  <div key={test.id} className={`d-flex align-items-center gap-2 small rounded-2 px-1 ${isSelected ? '' : 'bg-light text-muted'}`} aria-label={isSelected ? undefined : `${getExecutionCaseLabel(test)}: ${t('ejecutarPruebas.notExecuted')}`}>
                  <Badge bg={formatBadgeVariants[getCaseFormat(test)]} className="d-inline-flex align-items-center gap-1 flex-shrink-0"><Icon size={12} aria-hidden="true" />{t(meta.labelKey)}</Badge>
                  <Badge bg="light" text="primary" className="border font-monospace">{getExecutionCaseLabel(test)}</Badge>
                  <span className={`${isSelected ? 'text-dark' : 'text-muted'} text-truncate flex-grow-1`} style={{ minWidth: 0 }}>{test.title}</span>
                  {!isSelected && <Badge bg="secondary" className="ms-auto flex-shrink-0 x-small">{t('ejecutarPruebas.notExecuted')}</Badge>}
                  {isSelected && isOutdatedExecutionCase(test) && (
                    <Badge bg="warning" text="dark" className="border x-small ms-1 flex-shrink-0">{t('ejecutarPruebas.updateToVersion')}{test.latestVersion}</Badge>
                  )}
                  </div>
                  )
                })}
              </div>
            ) : (
              <div className="small text-muted">{t('ejecutarPruebas.noCasesToShow')}</div>
            )}
          </div>
        )}

        {hasOutdatedCases && (
          <Alert variant="warning" className="py-2 px-3 small mb-0 border-0">
            {t('ejecutarPruebas.outdatedCases')}
          </Alert>
        )}

        {isChatbotSelection && (
          <Alert variant="info" className="py-2 px-3 small mb-0">
            {t('ejecutarPruebas.chatbotSelectionNotice')}
          </Alert>
        )}
        {hasMixedFormats && (
          <Alert variant="warning" className="py-2 px-3 small mb-0">
            <strong>{t('ejecutarPruebas.mixedFormatsTitle')}</strong><br />
            {t('ejecutarPruebas.mixedFormatsDetail')}
          </Alert>
        )}
        {hasNoCases && (
          <Alert variant="warning" className="py-2 px-3 small mb-0">
            <strong>{t('ejecutarPruebas.noCasesSelectedTitle')}</strong><br />
            {t('ejecutarPruebas.noCasesSelectedDetail')}
          </Alert>
        )}

        <div className="border rounded-3 bg-light p-3">
          <div className="d-flex align-items-center justify-content-between gap-3 mb-2">
            <div className="d-flex align-items-center gap-2">
              <Form.Label htmlFor="execution-environment" className="x-small fw-bold text-muted text-uppercase mb-0">{t('ejecutarPruebas.executionEnvironment')}</Form.Label>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="p-0 text-primary shadow-none"
                title={t('ejecutarPruebas.datasetHelp')}
                aria-label={t('ejecutarPruebas.datasetHelp')}
                onClick={onShowDatasetHelp}
              >
                <Info size={14} aria-hidden="true" />
              </Button>
            </div>
            <Form.Select
              id="execution-environment"
              name="executionEnvironment"
              aria-label={t('ejecutarPruebas.executionEnvironment')}
              size="sm"
              className="fw-bold"
              style={{ maxWidth: 180 }}
              value={selectedEnvironmentId}
              onChange={event => setSelectedEnvironmentId(event.target.value)}
            >
              <option value="">{t('ejecutarPruebas.noEnvironment')}</option>
              {environments.map(env => (
                <option key={env.id} value={env.id}>{env.name}</option>
              ))}
            </Form.Select>
          </div>
          <div className="d-flex align-items-center justify-content-end gap-2 mb-2">
            <Form.Label htmlFor="execution-dataset" className="x-small fw-bold text-muted text-uppercase mb-0">{t('ejecutarPruebas.dataset')}</Form.Label>
            <Form.Select
              id="execution-dataset"
              name="executionDataset"
              aria-label={t('ejecutarPruebas.dataset')}
              size="sm"
              className="fw-bold"
              style={{ maxWidth: 240 }}
              value={selectedDatasetId}
              onChange={event => setSelectedDatasetId(event.target.value)}
              disabled={!selectedEnvironmentId || environmentDatasets.length === 0}
            >
              <option value="">{t('ejecutarPruebas.noDataset')}</option>
              {environmentDatasets.map((dataset: any) => (
                <option key={dataset.id} value={dataset.id}>{dataset.name}{dataset.isDefault ? ` (${t('ejecutarPruebas.defaultLabel')})` : ''}</option>
              ))}
            </Form.Select>
          </div>
          {datasetPreviewLoading ? (
            <div className="bg-white border rounded-2 p-2 font-monospace x-small text-muted">{t('ejecutarPruebas.resolvingDataset')}</div>
          ) : datasetPreview?.error ? (
            <Alert variant="danger" className="py-2 px-3 small mb-0">
              <strong>{t('ejecutarPruebas.datasetResolveFailed')}</strong> {datasetPreview.error}
              <div className="mt-1">{t('ejecutarPruebas.datasetReviewEnvironment')}</div>
            </Alert>
          ) : hasPreviewData ? (
            <div className="d-flex flex-column gap-2">
              {environmentDatasetRows.length > 0 && (
                <div>
                  <div className="x-small text-muted mb-1">
                    {t('ejecutarPruebas.environmentDataset')} <strong>{datasetPreview?.dataset_nombre || t('ejecutarPruebas.unnamed')}</strong>
                  </div>
                  {renderDatasetRows(environmentDatasetRows)}
                </div>
              )}
              {caseDatasetRows.length > 0 && (
                <div>
                  <div className="x-small text-muted mb-1">
                    {t('ejecutarPruebas.caseDataset')}
                  </div>
                  {renderDatasetRows(caseDatasetRows)}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white border rounded-2 p-2 font-monospace x-small text-muted">{t('ejecutarPruebas.noPreviewData')}</div>
          )}
        </div>

        {executionLoading && (
          <Alert variant="info" className="py-2 px-3 small mb-0 d-flex align-items-center gap-2" role="status" aria-live="polite">
            <Loader2 size={16} className="spin" aria-hidden="true" />
            <span>{t('ejecutarPruebas.preparingExecution')}</span>
          </Alert>
        )}

        <Button variant="outline-success" className="execution-mode-option execution-mode-option--manual p-3 text-start border-2 shadow-sm shadow-none" disabled={executionLoading || !canStartManualExecution || hasInvalidSelection} title={!canStartManualExecution ? t('ejecutarPruebas.manualPermission') : hasInvalidSelection ? t('ejecutarPruebas.homogeneousSelectionRequired') : undefined} onClick={() => startExecution('manual')}>
          <div className="d-flex align-items-center gap-3">
            {isStarting('manual') ? <Loader2 size={32} className="text-success spin" aria-hidden="true" /> : <PlayCircle size={32} className="text-success" aria-hidden="true" />}
            <div>
              <strong className="text-dark">{isStarting('manual') ? t('ejecutarPruebas.preparingExecution') : isApiSelection ? t('ejecutarPruebas.apiManualExecution') : isChatbotSelection ? t('ejecutarPruebas.chatbotManualExecution') : t('ejecutarPruebas.manualExecution')}</strong>
              <br />
              <small className="text-muted">{isApiSelection ? t('ejecutarPruebas.apiManualDescription') : isChatbotSelection ? t('ejecutarPruebas.chatbotManualDescription') : t('ejecutarPruebas.createRunFreeze')}</small>
            </div>
          </div>
        </Button>

        {!isApiSelection && !canUseAutomatedExecution && (
          <Alert variant="warning" className="py-2 px-3 small mb-0 border-0">
            {t('ejecutarPruebas.executionPermission')}
          </Alert>
        )}

        <Button
          variant="outline-secondary"
          className="execution-mode-option execution-mode-option--automated p-3 text-start border-2 shadow-sm shadow-none"
          disabled={executionLoading || !canUseAutomatedExecution || hasInvalidSelection}
          title={!canUseAutomatedExecution ? t('ejecutarPruebas.automatedPermission') : hasInvalidSelection ? t('ejecutarPruebas.homogeneousSelectionRequired') : undefined}
          onClick={() => startExecution('automated')}
        >
          <div className="d-flex align-items-center gap-3">
            {isStarting('automated') ? <Loader2 size={32} className="text-secondary spin" aria-hidden="true" /> : <Terminal size={32} className="text-secondary" aria-hidden="true" />}
            <div>
              <strong className="text-dark">{isStarting('automated') ? t('ejecutarPruebas.preparingExecution') : isApiSelection ? t('ejecutarPruebas.apiAutomatedExecution') : isChatbotSelection ? t('ejecutarPruebas.chatbotAutomatedExecution') : t('ejecutarPruebas.automatedExecution')}</strong>
              <br />
              <small className="text-muted">{isApiSelection ? t('ejecutarPruebas.apiAutomatedDescription') : isChatbotSelection ? t('ejecutarPruebas.chatbotAutomatedDescription') : t('ejecutarPruebas.automatedDescription')}</small>
            </div>
          </div>
        </Button>

        {iaEnginePremiumLocked && (
          <Alert variant="warning" className="py-2 px-3 small mb-0 border-0">
            {t('ejecutarPruebas.iaUnavailableInstance')}
          </Alert>
        )}

        {!isApiSelection && <Button variant="outline-primary" className="execution-mode-option execution-mode-option--ia p-3 text-start border-2 shadow-sm bg-primary bg-opacity-10 shadow-none" disabled={executionLoading || !canUseIaExecution || hasInvalidSelection} title={!canUseIaExecution ? (iaEnginePremiumLocked ? t('ejecutarPruebas.iaUnavailableTitle') : t('ejecutarPruebas.iaPermission')) : hasInvalidSelection ? t('ejecutarPruebas.homogeneousSelectionRequired') : undefined} onClick={scheduleIa}>
          <div className="d-flex align-items-center gap-3 text-primary">
            {isStarting('ia') ? <Loader2 size={32} className="text-primary spin" aria-hidden="true" /> : <Cpu size={32} className="text-primary" aria-hidden="true" />}
            <div>
              <strong className="text-primary">{isStarting('ia') ? t('ejecutarPruebas.preparingExecution') : isChatbotSelection ? t('ejecutarPruebas.chatbotIaExecution') : t('ejecutarPruebas.iaAgentEngine')} {iaEnginePremiumLocked && <Badge bg="warning" text="dark" className="ms-1">{t('ejecutarPruebas.blockedLabel')}</Badge>}</strong>
              <br />
              <small className="text-primary fw-bold">{iaEnginePremiumLocked ? t('ejecutarPruebas.iaUnavailable') : isChatbotSelection ? t('ejecutarPruebas.chatbotIaDescription') : t('ejecutarPruebas.iaDescription')}</small>
            </div>
          </div>
        </Button>}
      </Modal.Body>
    </Modal>
  )
}
