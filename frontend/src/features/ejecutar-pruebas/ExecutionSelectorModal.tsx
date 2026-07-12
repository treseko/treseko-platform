import { Alert, Badge, Button, Form, Modal } from 'react-bootstrap'
import { Cpu, Info, PlayCircle, Terminal } from 'lucide-react'

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
  automationDebugMode: boolean
  setAutomationDebugMode: (value: boolean) => void
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
  automationDebugMode,
  setAutomationDebugMode,
  canStartManualExecution,
  canUseAutomatedExecution,
  canUseIaExecution,
  iaEnginePremiumLocked = false,
  onScheduleIa
}: ExecutionSelectorModalProps) {
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
        <Modal.Title className="fw-bold text-dark">Motor de ejecución</Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-4 d-flex flex-column gap-3 text-dark">
        <div className="small text-muted bg-light border rounded-3 p-2">
          Casos ejecutables seleccionados: <strong className="text-dark">{executionModalTests.length}</strong>
          {executionModalDiscardedCount > 0 && (
            <span className="text-warning ms-2">({executionModalDiscardedCount} omitidos por build/componente)</span>
          )}
        </div>

        {executionModalTests.length > 0 && (
          <div className="border rounded-3 bg-white p-3">
            <div className="x-small fw-bold text-muted text-uppercase mb-2">Casos que se ejecutarán</div>
            <div className="d-flex flex-column gap-2" style={{ maxHeight: '150px', overflow: 'auto' }}>
              {executionModalTests.map((test: any) => (
                <div key={test.id} className="d-flex align-items-center gap-2 small">
                  <Badge bg="light" text="primary" className="border font-monospace">{getExecutionCaseLabel(test)}</Badge>
                  <span className="text-dark text-truncate">{test.title}</span>
                  {isOutdatedExecutionCase(test) && (
                    <Badge bg="warning" text="dark" className="border x-small ms-auto">Actualizar a v{test.latestVersion}</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {hasOutdatedCases && (
          <Alert variant="warning" className="py-2 px-3 small mb-0 border-0">
            Hay casos con una versión nueva disponible. Antes de ejecutar se agregará la última versión a la build actual.
          </Alert>
        )}

        <div className="border rounded-3 bg-light p-3">
          <div className="d-flex align-items-center justify-content-between gap-3 mb-2">
            <div className="d-flex align-items-center gap-2">
              <div className="x-small fw-bold text-muted text-uppercase">Ambiente de ejecución</div>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="p-0 text-primary shadow-none"
                title="Ayuda de dataset por ambiente"
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
              <option value="">Sin ambiente</option>
              {environments.map(env => (
                <option key={env.id} value={env.id}>{env.name}</option>
              ))}
            </Form.Select>
          </div>
          <div className="d-flex align-items-center justify-content-end gap-2 mb-2">
            <div className="x-small fw-bold text-muted text-uppercase">Dataset</div>
            <Form.Select
              size="sm"
              className="fw-bold"
              style={{ maxWidth: 240 }}
              value={selectedDatasetId}
              onChange={event => setSelectedDatasetId(event.target.value)}
              disabled={!selectedEnvironmentId || environmentDatasets.length === 0}
            >
              <option value="">Sin dataset</option>
              {environmentDatasets.map((dataset: any) => (
                <option key={dataset.id} value={dataset.id}>{dataset.name}{dataset.isDefault ? ' (default)' : ''}</option>
              ))}
            </Form.Select>
          </div>
          {datasetPreviewLoading ? (
            <div className="bg-white border rounded-2 p-2 font-monospace x-small text-muted">Resolviendo dataset...</div>
          ) : hasPreviewData ? (
            <div className="d-flex flex-column gap-2">
              {environmentDatasetRows.length > 0 && (
                <div>
                  <div className="x-small text-muted mb-1">
                    Dataset del ambiente: <strong>{datasetPreview?.dataset_nombre || 'Sin nombre'}</strong>
                  </div>
                  {renderDatasetRows(environmentDatasetRows)}
                </div>
              )}
              {caseDatasetRows.length > 0 && (
                <div>
                  <div className="x-small text-muted mb-1">
                    Datos especificos del caso
                  </div>
                  {renderDatasetRows(caseDatasetRows)}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white border rounded-2 p-2 font-monospace x-small text-muted">Sin datos para previsualizar.</div>
          )}
        </div>

        <Button variant="outline-success" className="p-3 text-start border-2 shadow-sm shadow-none" disabled={executionLoading || !canStartManualExecution} title={!canStartManualExecution ? 'No tienes permiso para iniciar ejecuciones manuales' : undefined} onClick={() => onStart('manual')}>
          <div className="d-flex align-items-center gap-3">
            <PlayCircle size={32} className="text-success" />
            <div>
              <strong className="text-dark">{hasOutdatedCases ? 'Actualizar y ejecutar manual' : 'Ejecución manual'}</strong>
              <br />
              <small className="text-muted">Crea run, congela snapshots y registra resultado por paso.</small>
            </div>
          </div>
        </Button>

        {!canUseAutomatedExecution && (
          <Alert variant="warning" className="py-2 px-3 small mb-0 border-0">
            Necesitas permiso de ejecucion y acceso de lectura a automatizacion para enviar pruebas a workers.
          </Alert>
        )}

        <Form.Check
          type="switch"
          id="automation-debug-mode"
          checked={automationDebugMode}
          onChange={event => setAutomationDebugMode(event.target.checked)}
          label="Modo debug visual: abrir navegador visible en la maquina del worker"
          className="small text-muted"
          disabled={executionLoading || !canUseAutomatedExecution}
        />

        <Button
          variant="outline-secondary"
          className="p-3 text-start border-2 shadow-sm shadow-none"
          disabled={executionLoading || !canUseAutomatedExecution}
          title={!canUseAutomatedExecution ? 'No tienes permiso para usar workers automatizados' : undefined}
          onClick={() => onStart('automated')}
        >
          <div className="d-flex align-items-center gap-3">
            <Terminal size={32} className="text-secondary" />
            <div>
              <strong className="text-dark">Ejecución automatizada</strong>
              <br />
              <small className="text-muted">Crea run y despacha al motor automatizado disponible.</small>
            </div>
          </div>
        </Button>

        {iaEnginePremiumLocked && (
          <Alert variant="warning" className="py-2 px-3 small mb-0 border-0">
            La ejecucion IA no esta habilitada para esta instancia. Revisa permisos o licencia antes de iniciar.
          </Alert>
        )}

        <Button variant="outline-primary" className="p-3 text-start border-2 shadow-sm bg-primary bg-opacity-10 shadow-none" disabled={executionLoading || !canUseIaExecution} title={!canUseIaExecution ? (iaEnginePremiumLocked ? 'Ejecucion IA no habilitada en esta instancia' : 'No tienes permiso para iniciar ejecuciones IA') : undefined} onClick={onScheduleIa}>
          <div className="d-flex align-items-center gap-3 text-primary">
            <Cpu size={32} className="text-primary" />
            <div>
              <strong className="text-primary">IA Agent Engine {iaEnginePremiumLocked && <Badge bg="warning" text="dark" className="ms-1">Bloqueado</Badge>}</strong>
              <br />
              <small className="text-primary fw-bold">{iaEnginePremiumLocked ? 'Ejecucion IA no disponible en esta instancia.' : 'Ejecucion IA basica con cola y cuota semanal.'}</small>
            </div>
          </div>
        </Button>
      </Modal.Body>
    </Modal>
  )
}
