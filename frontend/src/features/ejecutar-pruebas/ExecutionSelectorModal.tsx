import { Alert, Badge, Button, Form, Modal } from 'react-bootstrap'
import { Cpu, Info, PlayCircle, Terminal } from 'lucide-react'
import { useI18n } from '../../i18n'

type ExecutionSelectorModalProps = {
  show: boolean
  onHide: () => void
  executionModalTests: any[]
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
  onShowDatasetHelp,
  onStart,
  canStartManualExecution,
  canUseAutomatedExecution,
  canUseIaExecution,
  iaEnginePremiumLocked = false,
  onScheduleIa
}: ExecutionSelectorModalProps) {
  const { t } = useI18n()
  const hasOutdatedCases = executionModalTests.some(isOutdatedExecutionCase)
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

  return (
    <Modal show={show} onHide={onHide} centered backdrop="static">
      <Modal.Header closeButton className="border-0 pb-0 text-dark">
        <Modal.Title className="fw-bold text-dark">{t('ejecutarPruebas.executionEngine')}</Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-4 d-flex flex-column gap-3 text-dark">
        <div className="small text-muted bg-light border rounded-3 p-2">
          {t('ejecutarPruebas.selectedCases')} <strong className="text-dark">{executionModalTests.length}</strong>
          {executionModalDiscardedCount > 0 && (
            <span className="text-warning ms-2">({executionModalDiscardedCount} {t('ejecutarPruebas.discardedByBuild')})</span>
          )}
        </div>

        {executionModalTests.length > 0 && (
          <div className="border rounded-3 bg-white p-3">
            <div className="x-small fw-bold text-muted text-uppercase mb-2">{t('ejecutarPruebas.casesToExecute')}</div>
            <div className="d-flex flex-column gap-2" style={{ maxHeight: '150px', overflow: 'auto' }}>
              {executionModalTests.map((test: any) => (
                <div key={test.id} className="d-flex align-items-center gap-2 small">
                  <Badge bg="light" text="primary" className="border font-monospace">{getExecutionCaseLabel(test)}</Badge>
                  <span className="text-dark text-truncate">{test.title}</span>
                  {isOutdatedExecutionCase(test) && (
                  <Badge bg="warning" text="dark" className="border x-small ms-auto">{t('ejecutarPruebas.updateToVersion')}{test.latestVersion}</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {hasOutdatedCases && (
          <Alert variant="warning" className="py-2 px-3 small mb-0 border-0">
            {t('ejecutarPruebas.outdatedCases')}
          </Alert>
        )}

        <div className="border rounded-3 bg-light p-3">
          <div className="d-flex align-items-center justify-content-between gap-3 mb-2">
            <div className="d-flex align-items-center gap-2">
              <div className="x-small fw-bold text-muted text-uppercase">{t('ejecutarPruebas.executionEnvironment')}</div>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="p-0 text-primary shadow-none"
                title={t('ejecutarPruebas.datasetHelp')}
                onClick={onShowDatasetHelp}
              >
                <Info size={14} />
              </Button>
            </div>
            <Form.Select
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
            <div className="x-small fw-bold text-muted text-uppercase">{t('ejecutarPruebas.dataset')}</div>
            <Form.Select
              size="sm"
              className="fw-bold"
              style={{ maxWidth: 240 }}
              value={selectedDatasetId}
              onChange={event => setSelectedDatasetId(event.target.value)}
              disabled={!selectedEnvironmentId || environmentDatasets.length === 0}
            >
              <option value="">{t('ejecutarPruebas.noDataset')}</option>
              {environmentDatasets.map((dataset: any) => (
                <option key={dataset.id} value={dataset.id}>{dataset.name}{dataset.isDefault ? ' (default)' : ''}</option>
              ))}
            </Form.Select>
          </div>
          {datasetPreviewLoading ? (
            <div className="bg-white border rounded-2 p-2 font-monospace x-small text-muted">{t('ejecutarPruebas.resolvingDataset')}</div>
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

        <Button variant="outline-success" className="execution-mode-option execution-mode-option--manual p-3 text-start border-2 shadow-sm shadow-none" disabled={executionLoading || !canStartManualExecution} title={!canStartManualExecution ? t('ejecutarPruebas.manualPermission') : undefined} onClick={() => onStart('manual')}>
          <div className="d-flex align-items-center gap-3">
            <PlayCircle size={32} className="text-success" />
            <div>
              <strong className="text-dark">{t('ejecutarPruebas.manualExecution')}</strong>
              <br />
              <small className="text-muted">{t('ejecutarPruebas.createRunFreeze')}</small>
            </div>
          </div>
        </Button>

        {!canUseAutomatedExecution && (
          <Alert variant="warning" className="py-2 px-3 small mb-0 border-0">
            {t('ejecutarPruebas.executionPermission')}
          </Alert>
        )}

        <Button
          variant="outline-secondary"
          className="execution-mode-option execution-mode-option--automated p-3 text-start border-2 shadow-sm shadow-none"
          disabled={executionLoading || !canUseAutomatedExecution}
          title={!canUseAutomatedExecution ? t('ejecutarPruebas.automatedPermission') : undefined}
          onClick={() => onStart('automated')}
        >
          <div className="d-flex align-items-center gap-3">
            <Terminal size={32} className="text-secondary" />
            <div>
              <strong className="text-dark">{t('ejecutarPruebas.automatedExecution')}</strong>
              <br />
              <small className="text-muted">{t('ejecutarPruebas.automatedDescription')}</small>
            </div>
          </div>
        </Button>

        {iaEnginePremiumLocked && (
          <Alert variant="warning" className="py-2 px-3 small mb-0 border-0">
            {t('ejecutarPruebas.iaUnavailableInstance')}
          </Alert>
        )}

        <Button variant="outline-primary" className="execution-mode-option execution-mode-option--ia p-3 text-start border-2 shadow-sm bg-primary bg-opacity-10 shadow-none" disabled={executionLoading || !canUseIaExecution} title={!canUseIaExecution ? (iaEnginePremiumLocked ? t('ejecutarPruebas.iaUnavailableTitle') : t('ejecutarPruebas.iaPermission')) : undefined} onClick={onScheduleIa}>
          <div className="d-flex align-items-center gap-3 text-primary">
            <Cpu size={32} className="text-primary" />
            <div>
              <strong className="text-primary">{t('ejecutarPruebas.iaAgentEngine')} {iaEnginePremiumLocked && <Badge bg="warning" text="dark" className="ms-1">{t('ejecutarPruebas.blockedLabel')}</Badge>}</strong>
              <br />
              <small className="text-primary fw-bold">{iaEnginePremiumLocked ? t('ejecutarPruebas.iaUnavailable') : t('ejecutarPruebas.iaDescription')}</small>
            </div>
          </div>
        </Button>
      </Modal.Body>
    </Modal>
  )
}
