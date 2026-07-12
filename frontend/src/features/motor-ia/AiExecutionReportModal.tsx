import { useState } from 'react'
import { Alert, Badge, Button, Card, Col, Modal, Row, Tab, Table, Tabs } from 'react-bootstrap'
import { resolveAssetUrl } from '../../shared/utils/assets'
import { formatDateTime } from '../../shared/utils/dateTime'

type AiExecutionReportModalProps = {
  show: boolean
  loading?: boolean
  error?: string
  report: any | null
  onHide: () => void
  onMarkReviewed?: (executionId: string) => Promise<void> | void
}

const statusColor = (status?: string) => {
  const value = String(status || '').toUpperCase()
  if (value.includes('PASO') || value.includes('PASS')) return 'success'
  if (value.includes('BLOQUE')) return 'warning'
  if (value.includes('FALLO') || value.includes('FAIL') || value.includes('ERROR')) return 'danger'
  return 'secondary'
}

const formatDuration = (seconds?: number) => {
  if (!seconds) return '-'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`
}

const getReport = (payload: any) => payload?.ai_report || payload || {}

const actionTarget = (action?: any) => {
  if (!action) return '-'
  if (action.target_ref) return action.target_ref
  if (action.action === 'click_at' && Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y))) {
    return `${Math.round(Number(action.x))}, ${Math.round(Number(action.y))}`
  }
  return '-'
}

const screenshotSrc = (base64?: string) => {
  if (!base64) return ''
  return String(base64).startsWith('data:') ? base64 : `data:image/png;base64,${base64}`
}

const evidenceSrc = (attempt: any, step: any) => {
  if (attempt?.screenshot_base64) return screenshotSrc(attempt.screenshot_base64)
  return resolveAssetUrl(step?.evidence_url || step?.evidences?.[0]?.public_url || '')
}

export function AiExecutionReportModal({ show, loading, error, report, onHide, onMarkReviewed }: AiExecutionReportModalProps) {
  const [previewImage, setPreviewImage] = useState<{ src: string; title: string; subtitle?: string } | null>(null)
  const aiReport = getReport(report)
  const steps = Array.isArray(aiReport.steps) ? aiReport.steps : []
  const confidence = report?.confidence ?? aiReport.confidence
  const consensus = report?.consensus ?? aiReport.consensus ?? aiReport.status
  const failureCategory = report?.failure_category ?? aiReport.failure_category
  const humanReview = Boolean(report?.human_review_required ?? aiReport.human_review_required)
  const reviewStatus = report?.review_status ?? aiReport.human_review_status ?? (humanReview ? 'REQUIERE_REVISION' : 'NO_REQUIERE_REVISION')
  const executionMode = report?.execution_mode ?? aiReport.execution_mode ?? 'IA'
  const errorCode = report?.error_code ?? aiReport.error_code ?? aiReport.ai_error_code
  const timeline = Array.isArray(aiReport.timeline) ? aiReport.timeline : []
  const agentConversation = Array.isArray(aiReport.agent_conversation) ? aiReport.agent_conversation : timeline
  const workflowSnapshot = aiReport.workflow_snapshot || aiReport.workflow_definition || aiReport.workflowDefinition || aiReport.snapshot_json || {}
  const workflowNodes = Array.isArray(workflowSnapshot.nodes) ? workflowSnapshot.nodes : []
  const metrics = aiReport.metrics || {}
  const parameters = aiReport.parameters || {}
  const dataset = aiReport.dataset || aiReport.data || {}
  const hasMetricValue = (value: any) => value !== undefined && value !== null
  const formatMetricNumber = (value: any) => hasMetricValue(value) ? Number(value || 0).toLocaleString() : 'No informado'
  const formatMetricMs = (value: any) => hasMetricValue(value) ? `${Number(value || 0).toLocaleString()}ms` : 'No informado'
  const formatMetricMoney = (value: any) => hasMetricValue(value) ? `$${Number(value || 0).toFixed(5)}` : 'No informado'

  return (
    <Modal show={show} onHide={onHide} size="xl" centered scrollable>
      <Modal.Header closeButton>
        <Modal.Title className="fw-bold">Reporte IA de ejecucion</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {loading && <div className="text-center text-muted py-5">Cargando reporte IA...</div>}
        {error && <Alert variant="danger">{error}</Alert>}
        {!loading && !error && report && (
          <div className="d-flex flex-column gap-3">
            <Card className="border p-3">
              <div className="d-flex flex-wrap justify-content-between gap-3">
                <div>
                  <div className="d-flex align-items-center gap-2 mb-1">
                    <Badge bg="light" text="primary" className="border">{report.case_code || aiReport.case_code || '-'}</Badge>
                    <span className="fw-bold">{report.case_title || aiReport.case_title || 'Caso IA'}</span>
                  </div>
                  <div className="small text-muted">{aiReport.summary || report.observations || 'Sin resumen disponible.'}</div>
                </div>
                <div className="d-flex flex-wrap gap-2 align-items-start">
                  <Badge bg={statusColor(report.status || aiReport.status)}>{report.status || aiReport.status || '-'}</Badge>
                  <Badge bg={executionMode === 'IA' ? 'primary' : 'secondary'}>Ejecutado por {executionMode === 'IA' ? 'IA' : executionMode}</Badge>
                  <Badge bg={statusColor(consensus)}>Consenso: {consensus || '-'}</Badge>
                  <Badge bg={confidence >= 70 ? 'success' : 'warning'} text={confidence >= 70 ? undefined : 'dark'}>Confianza: {confidence ?? 0}%</Badge>
                  {humanReview && <Badge bg="danger">Requiere revision humana</Badge>}
                  {reviewStatus === 'REVISADA' && <Badge bg="success">Revisado por humano</Badge>}
                  {errorCode && <Badge bg="dark">{errorCode}</Badge>}
                </div>
              </div>
              <Row className="g-2 small mt-3">
                <Col md={3}><span className="text-muted">Duracion:</span> {formatDuration(report.duration_seconds || aiReport.duration_seconds)}</Col>
                <Col md={3}><span className="text-muted">Categoria:</span> {failureCategory || '-'}</Col>
                <Col md={3}><span className="text-muted">Revision:</span> {reviewStatus}</Col>
                <Col md={3}><span className="text-muted">Modelo:</span> {aiReport.model || '-'}</Col>
                <Col md={3}><span className="text-muted">Codigo error:</span> {errorCode || '-'}</Col>
              </Row>
            </Card>

            <Tabs defaultActiveKey="summary" className="mb-2">
              <Tab eventKey="summary" title="Resumen">
                <Row className="g-3 pt-3">
                  {aiReport.repeatability_warning && (
                    <Col md={12}>
                      <Alert variant="warning" className="mb-0">
                        Resultado inestable: este caso tuvo resultados diferentes en ejecuciones recientes con el mismo contexto. Conviene revision humana.
                      </Alert>
                    </Col>
                  )}
                  <Col md={3}><Card className="border p-3 h-100"><div className="x-small text-muted fw-bold text-uppercase">Estado</div><div className="fw-bold">{report.status || aiReport.status || '-'}</div></Card></Col>
                  <Col md={3}><Card className="border p-3 h-100"><div className="x-small text-muted fw-bold text-uppercase">Consenso</div><div className="fw-bold">{consensus || '-'}</div></Card></Col>
                  <Col md={3}><Card className="border p-3 h-100"><div className="x-small text-muted fw-bold text-uppercase">Confianza</div><div className="fw-bold">{confidence ?? 0}%</div></Card></Col>
                  <Col md={3}><Card className="border p-3 h-100"><div className="x-small text-muted fw-bold text-uppercase">Revision humana</div><div className="fw-bold">{reviewStatus}</div></Card></Col>
                  {reviewStatus === 'REQUIERE_REVISION' && onMarkReviewed && report?.execution_id && (
                    <Col md={12}>
                      <Alert variant="warning" className="d-flex justify-content-between align-items-center gap-3 mb-0">
                        <span>Esta ejecucion fue realizada por IA y requiere validacion humana.</span>
                        <Button size="sm" variant="warning" className="fw-bold" onClick={() => onMarkReviewed(report.execution_id)}>
                          Marcar como revisada
                        </Button>
                      </Alert>
                    </Col>
                  )}
                  <Col md={12}>
                    <Card className="border p-3">
                      <div className="x-small text-muted fw-bold text-uppercase mb-1">Motivo / diagnostico</div>
                      <div className="small">{aiReport.summary || report.observations || '-'}</div>
                      {Array.isArray(aiReport.errors) && aiReport.errors.length > 0 && (
                        <Alert variant="danger" className="mt-3 mb-0 small">
                          {aiReport.errors.map((item: any, index: number) => <div key={index}>{String(item)}</div>)}
                        </Alert>
                      )}
                      {Array.isArray(aiReport.previous_recent_results) && aiReport.previous_recent_results.length > 0 && (
                        <div className="mt-3">
                          <div className="x-small text-muted fw-bold text-uppercase mb-1">Resultados recientes comparados</div>
                          {aiReport.previous_recent_results.map((item: any, index: number) => (
                            <div key={index} className="small d-flex justify-content-between border-top py-1">
                              <span>{item.run_name || item.run_id}</span>
                              <span className="fw-bold">{item.status}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
                  </Col>
                </Row>
              </Tab>
              <Tab eventKey="agents" title={`Trazas IA (${agentConversation.length})`}>
                <div className="d-flex flex-column gap-2 pt-3">
                  <Alert variant="light" className="border small text-muted mb-1">
                    Esta vista muestra los eventos emitidos durante esta ejecucion
                    {workflowNodes.length > 0 ? ` (${agentConversation.length} trazas de ${workflowNodes.length} nodos configurados).` : ', no todos los nodos configurados del workflow.'}
                  </Alert>
                  {agentConversation.map((event: any, index: number) => (
                    <Card key={`${event.ts}-${index}`} className="border p-3">
                      <div className="d-flex flex-wrap justify-content-between gap-2 mb-1">
                        <div className="d-flex flex-wrap align-items-center gap-2">
                          <Badge bg="dark">{event.agent || event.source || 'AGENT'}</Badge>
                          <Badge bg={String(event.level || '').toUpperCase() === 'ERROR' ? 'danger' : String(event.level || '').toUpperCase() === 'WARN' ? 'warning' : 'secondary'}>
                            {event.level || 'INFO'}
                          </Badge>
                          {event.step && <Badge bg="light" text="dark" className="border">Paso {event.step}</Badge>}
                          {event.attempt && <Badge bg="light" text="dark" className="border">Intento {event.attempt}</Badge>}
                          {(event.error_code || event.ai_error_code) && <Badge bg="danger">{event.error_code || event.ai_error_code}</Badge>}
                        </div>
                        <span className="x-small text-muted">{formatDateTime(event.ts) || '-'}</span>
                      </div>
                      <div className="small">{event.message || '-'}</div>
                      {(event.reason || typeof event.confidence === 'number') && (
                        <div className="x-small text-muted mt-2">
                          {event.reason && <span>Motivo: {event.reason}</span>}
                          {typeof event.confidence === 'number' && <span>{event.reason ? ' · ' : ''}Confianza: {event.confidence}%</span>}
                        </div>
                      )}
                      {event.metrics && (
                        <div className="x-small text-muted mt-2">
                          Tokens: {formatMetricNumber(event.metrics.totalTokens ?? event.metrics.total_tokens)}
                          {' · '}Latencia: {formatMetricMs(event.metrics.latencyMs ?? event.metrics.latency_ms)}
                          {' · '}Costo: {formatMetricMoney(event.metrics.estimatedCost ?? event.metrics.estimated_cost)}
                        </div>
                      )}
                      {(event.prompt_excerpt || event.raw_response_excerpt) && (
                        <details className="mt-2">
                          <summary className="x-small text-primary fw-bold">Ver prompt/respuesta</summary>
                          {event.prompt_excerpt && <pre className="bg-light border rounded-2 p-2 small mt-2 mb-2">{event.prompt_excerpt}</pre>}
                          {event.raw_response_excerpt && <pre className="bg-light border rounded-2 p-2 small mb-0">{event.raw_response_excerpt}</pre>}
                        </details>
                      )}
                    </Card>
                  ))}
                  {agentConversation.length === 0 && <Alert variant="light" className="border text-muted">No hay conversacion de agentes para esta ejecucion.</Alert>}
                </div>
              </Tab>
              <Tab eventKey="steps" title={`Pasos (${steps.length})`}>
                <div className="d-flex flex-column gap-3 pt-3">
                  {steps.map((step: any) => (
                    <Card key={step.number} className="border p-3">
                      <div className="d-flex justify-content-between gap-2 mb-2">
                        <div className="fw-bold">Paso {step.number}</div>
                        <div className="d-flex gap-2">
                          <Badge bg={statusColor(step.status)}>{step.status}</Badge>
                          <Badge bg="light" text="dark" className="border">{(step.attempts || []).length} intento{(step.attempts || []).length === 1 ? '' : 's'}</Badge>
                          <Badge bg="light" text="dark" className="border">Conf. {step.confidence ?? 0}%</Badge>
                        </div>
                      </div>
                      <div className="small mb-2">{step.observations || '-'}</div>
                      {step.failure_category && <div className="x-small text-muted mb-2">Categoria: {step.failure_category}</div>}
                      <Table responsive size="sm" className="small mb-0">
                        <thead>
                          <tr>
                            <th>Intento</th>
                            <th>Accion</th>
                            <th>Evidencia</th>
                            <th>Resultado tecnico</th>
                            <th>Validacion</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(step.attempts || []).map((attempt: any) => {
                            const evidence = evidenceSrc(attempt, step)
                            const isFallbackEvidence = !attempt.screenshot_base64 && Boolean(evidence)
                            return (
                            <tr key={attempt.attempt}>
                              <td>{attempt.attempt}</td>
                              <td>
                                <div className="fw-bold">{attempt.action?.action || '-'}</div>
                                <div className="x-small text-muted">Target: {actionTarget(attempt.action)}</div>
                                {attempt.action?.value !== undefined && attempt.action?.value !== '' && (
                                  <div className="x-small text-muted">Valor: {String(attempt.action.value)}</div>
                                )}
                                <div className="text-muted">{attempt.action?.reason || '-'}</div>
                              </td>
                              <td style={{ minWidth: 150 }}>
                                {evidence ? (
                                  <button
                                    type="button"
                                    className="border-0 bg-transparent p-0 text-start"
                                    onClick={() => setPreviewImage({
                                      src: evidence,
                                      title: `Paso ${step.number} - Intento ${attempt.attempt}`,
                                      subtitle: isFallbackEvidence ? 'Captura final del paso' : 'Captura del intento',
                                    })}
                                  >
                                    <img
                                      src={evidence}
                                      alt={`Paso ${step.number} intento ${attempt.attempt}`}
                                      className="border rounded-2"
                                      style={{ width: 132, height: 76, objectFit: 'cover' }}
                                    />
                                    {isFallbackEvidence && <div className="x-small text-muted mt-1">Captura final del paso</div>}
                                  </button>
                                ) : (
                                  <span className="text-muted">Sin captura</span>
                                )}
                              </td>
                              <td>
                                <Badge bg={attempt.execution?.ok ? 'success' : 'danger'}>{attempt.execution?.ok ? 'OK' : 'ERROR'}</Badge>
                                <div className="text-muted">{attempt.execution?.message || '-'}</div>
                              </td>
                              <td>{attempt.validation?.reason || '-'}</td>
                            </tr>
                          )})}
                        </tbody>
                      </Table>
                    </Card>
                  ))}
                  {steps.length === 0 && <Alert variant="light" className="border text-muted">No hay pasos detallados en este reporte.</Alert>}
                </div>
              </Tab>
              <Tab eventKey="consensus" title="Consenso">
                <pre className="bg-light border rounded-3 p-3 small mt-3 mb-0">{JSON.stringify(aiReport.consensus_signals || {}, null, 2)}</pre>
              </Tab>
              <Tab eventKey="metrics" title="Metricas">
                <Row className="g-3 pt-3">
                  <Col md={3}><Card className="border p-3"><div className="x-small text-muted fw-bold text-uppercase">Tokens prompt</div><div className="fw-bold">{formatMetricNumber(metrics.promptTokens ?? metrics.prompt_tokens)}</div></Card></Col>
                  <Col md={3}><Card className="border p-3"><div className="x-small text-muted fw-bold text-uppercase">Tokens respuesta</div><div className="fw-bold">{formatMetricNumber(metrics.completionTokens ?? metrics.completion_tokens)}</div></Card></Col>
                  <Col md={3}><Card className="border p-3"><div className="x-small text-muted fw-bold text-uppercase">Tokens total</div><div className="fw-bold">{formatMetricNumber(metrics.totalTokens ?? metrics.total_tokens)}</div></Card></Col>
                  <Col md={3}><Card className="border p-3"><div className="x-small text-muted fw-bold text-uppercase">Llamadas IA</div><div className="fw-bold">{formatMetricNumber(metrics.aiCalls)}</div></Card></Col>
                  <Col md={3}><Card className="border p-3"><div className="x-small text-muted fw-bold text-uppercase">Latencia total</div><div className="fw-bold">{formatMetricMs(metrics.latencyMs ?? metrics.latency_ms)}</div></Card></Col>
                  <Col md={3}><Card className="border p-3"><div className="x-small text-muted fw-bold text-uppercase">Latencia promedio</div><div className="fw-bold">{formatMetricMs(metrics.avg_latency_ms)}</div></Card></Col>
                  <Col md={3}><Card className="border p-3"><div className="x-small text-muted fw-bold text-uppercase">Costo estimado</div><div className="fw-bold">{formatMetricMoney(metrics.estimatedCost ?? metrics.estimated_cost)}</div></Card></Col>
                  <Col md={3}><Card className="border p-3"><div className="x-small text-muted fw-bold text-uppercase">Duracion</div><div className="fw-bold">{formatDuration(metrics.duration_seconds || aiReport.duration_seconds)}</div></Card></Col>
                </Row>
              </Tab>
              <Tab eventKey="data" title="Datos">
                <div className="pt-3 d-flex flex-column gap-3">
                  <Card className="border p-3">
                    <div className="fw-bold small mb-2">Parametros enviados al engine</div>
                    <pre className="bg-light border rounded-3 p-3 small mb-0">{JSON.stringify(parameters, null, 2)}</pre>
                  </Card>
                  <Card className="border p-3">
                    <div className="fw-bold small mb-2">Datos / dataset / variables</div>
                    <pre className="bg-light border rounded-3 p-3 small mb-0">{JSON.stringify(dataset, null, 2)}</pre>
                  </Card>
                  <Card className="border p-3">
                    <div className="fw-bold small mb-2">URLs visitadas</div>
                    {(aiReport.visited_urls || []).length > 0 ? (
                      <ul className="small mb-0">{aiReport.visited_urls.map((url: string, index: number) => <li key={`${url}-${index}`}>{url}</li>)}</ul>
                    ) : <div className="small text-muted">Sin URLs registradas.</div>}
                  </Card>
                </div>
              </Tab>
              <Tab eventKey="raw" title="JSON tecnico">
                <pre className="bg-dark text-light rounded-3 p-3 small mt-3 mb-0" style={{ maxHeight: 520, overflow: 'auto' }}>{JSON.stringify(aiReport, null, 2)}</pre>
              </Tab>
            </Tabs>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide}>Cerrar</Button>
      </Modal.Footer>
      <Modal show={Boolean(previewImage)} onHide={() => setPreviewImage(null)} size="xl" centered>
        <Modal.Header closeButton>
          <Modal.Title className="fw-bold">{previewImage?.title || 'Evidencia'}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="bg-dark p-2">
          {previewImage?.subtitle && <div className="text-light small px-2 pb-2">{previewImage.subtitle}</div>}
          {previewImage?.src && (
            <img
              src={previewImage.src}
              alt={previewImage.title}
              className="d-block w-100 rounded-2"
              style={{ maxHeight: '78vh', objectFit: 'contain' }}
            />
          )}
        </Modal.Body>
      </Modal>
    </Modal>
  )
}
