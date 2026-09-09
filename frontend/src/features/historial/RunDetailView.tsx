import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner } from 'react-bootstrap'
import { ChevronDown, ChevronRight, FileText, History, Search } from 'lucide-react'
import { AiExecutionReportModal } from '../motor-ia/AiExecutionReportModal'

const localizedExecutionModeLabel = (mode: string | undefined, fallback: string | undefined, t: any) => {
  const value = String(mode || fallback || '').toUpperCase()
  if (['IA', 'AI'].includes(value)) return t('historial.ia')
  if (['AUTOMATIZADA', 'AUTOMATED'].includes(value)) return t('historial.automatedLabel')
  if (['EXTERNA', 'EXTERNAL'].includes(value)) return t('historial.externalLabel')
  if (['MIXTO', 'MIXED'].includes(value)) return t('historial.mixedLabel')
  if (value === 'MANUAL') return t('historial.manualLabel')
  return fallback || t('historial.manual')
}

const localizedResultStatus = (status: string | undefined, t: any) => {
  const value = String(status || '').toUpperCase()
  if (['PASO', 'OK', 'PASSED'].includes(value)) return t('historial.pass')
  if (['FALLO', 'FALLIDO', 'FAILED'].includes(value)) return t('historial.fail')
  if (['BLOQUEADO', 'BLOCKED'].includes(value)) return t('historial.blocked')
  if (['SIN_CORRER', 'NOT_RUN', 'NO_EJECUTADO', 'SKIPPED'].includes(value)) return t('historial.notRun')
  if (['ERROR', 'TIMEOUT'].includes(value)) return t('historial.fail')
  if (['REQUIERE_REVISION', 'PENDING_REVIEW'].includes(value)) return t('historial.pendingReview')
  if (['EN_PROGRESO', 'EN_CURSO', 'IN_PROGRESS', 'RUNNING', 'EJECUTANDO'].includes(value)) return t('historial.inProgress')
  if (value === 'EJECUTANDO_AI') return t('historial.aiInProgress')
  return status || '-'
}

const localizedCaseTypeLabel = (label: string | undefined, t: any) => {
  const value = String(label || '').trim().toUpperCase()
  if (['AUTOMATIZADA_IA', 'AUTOMATED_AI'].includes(value)) return t('historial.caseTypeAutomatedAi')
  if (['AUTOMATIZADA', 'AUTOMATED'].includes(value)) return t('historial.caseTypeAutomated')
  if (['EXTERNA', 'EXTERNAL'].includes(value)) return t('historial.caseTypeExternal')
  if (['MANUAL', 'MANUAL_TEST'].includes(value)) return t('historial.caseTypeManual')
  return label || t('historial.manualLabel')
}

export function RunDetailView({ options }: { options: any }) {
  const { t, detail, detailLoading, detailError, onHide, focusedCase, focusError, displayCases, canViewEvidence, onOpenEvidence, getStatusColor, runStateLabel, executionModeBadge, executionModeCopy, caseTypeBadge, caseTypeCopy, effectiveExecutionMode, getExecutionId, buildHistoryAiReportPayload, createChatbotBug, markAiReviewed, markingReviewIds, reviewActionError, reviewConfirmCase, setReviewConfirmCase, reviewNote, setReviewNote, aiReportCase, setAiReportCase, showExecutionSnapshot, setShowExecutionSnapshot, showTechnicalVariables, setShowTechnicalVariables, frozenVariables, frozenSearch, setFrozenSearch, canRevealSecrets, revealedSecrets, revealSecret, FrozenDataCard, FrozenValue, EvidenceList, isAiRun, onMarkAiReviewed, showFeedback, focusedExecutionId, isNestedModalOpen, setRevealedSecrets, formatDate, formatSeconds } = options
  return (
    <>
      <Modal
        show={!isNestedModalOpen && (!!detail || detailLoading || !!detailError)}
        onHide={onHide}
        size="xl"
        centered
        scrollable
      >
        <Modal.Header closeButton>
          <Modal.Title className="fw-bold d-flex align-items-center gap-2">
            <History size={20} /> {t('historial.runDetail')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {detailLoading && <div className="text-center py-5"><Spinner className="mb-2" /><div className="small text-muted">{t('historial.loadingDetail')}</div></div>}
          {detailError && <Alert variant="danger">{detailError}</Alert>}
          {reviewActionError && <Alert variant="danger">{reviewActionError}</Alert>}
          {detail && (
            <div className="d-flex flex-column gap-3">
            {focusError ? (
              <Alert variant="danger" className="mb-0">
                {t('historial.selectedExecutionUnavailable')}
              </Alert>
            ) : focusedCase && (
              <Alert variant="info" className="mb-0 py-2 small">
                {t('historial.showingExecution')} <strong>{focusedCase.codigo || focusedCase.caso_id?.slice(0, 8) || t('historial.selectedCase')}</strong>.
              </Alert>
            )}
            <Card className="border p-3">
              <Row className="g-3 small">
                <Col md={3}><div className="text-muted x-small text-uppercase fw-bold">{t('historial.runId')}</div><div className="fw-bold">{detail.nombre}</div></Col>
                <Col md={3}><div className="text-muted x-small text-uppercase fw-bold">{t('historial.build')}</div><div>{detail.build?.nombre || '-'}</div></Col>
                <Col md={2}><div className="text-muted x-small text-uppercase fw-bold">{t('historial.component')}</div><div>{detail.componente?.nombre || '-'}</div></Col>
                <Col md={2}><div className="text-muted x-small text-uppercase fw-bold">{t('historial.environment')}</div><div>{detail.entorno?.nombre || '-'}</div></Col>
                <Col md={2}><div className="text-muted x-small text-uppercase fw-bold">{t('historial.dataset')}</div><div>{detail.dataset?.nombre || t('historial.noDataset')}</div></Col>
                <Col md={3}><div className="text-muted x-small text-uppercase fw-bold">{t('historial.executor')}</div><div>{detail.creado_por_nombre || '-'}</div></Col>
                <Col md={3}><div className="text-muted x-small text-uppercase fw-bold">{t('historial.creation')}</div><div>{formatDate(detail.fecha_creacion)}</div></Col>
                <Col md={2}><div className="text-muted x-small text-uppercase fw-bold">{t('historial.runOrigin')}</div><Badge bg="light" text="dark" className="border">{detail.origen}</Badge></Col>
                <Col md={2}><div className="text-muted x-small text-uppercase fw-bold">{t('historial.runStatus')}</div><Badge bg="secondary">{runStateLabel(detail.estado_run, t)}</Badge></Col>
                <Col md={2}><div className="text-muted x-small text-uppercase fw-bold">{t('historial.executedWith')}</div><Badge bg={isAiRun(detail) ? 'primary' : detail.execution_mode_summary === 'MIXTO' ? 'warning' : executionModeBadge(detail.execution_mode_summary)} text={detail.execution_mode_summary === 'MIXTO' && !isAiRun(detail) ? 'dark' : undefined}>{localizedExecutionModeLabel(detail.execution_mode_summary, detail.execution_mode_label, t)}</Badge></Col>
              </Row>
            </Card>

            <Card className="border p-2">
              <div className="d-flex align-items-start justify-content-between gap-2">
                <div>
                  <div className="fw-bold small">{t('historial.executionSnapshot')}</div>
                  <div className="x-small text-muted">
                    {t('historial.snapshotDescription')}
                  </div>
                </div>
                <div className="d-flex align-items-center gap-1 flex-shrink-0">
                  <Badge bg="light" text="dark" className="border">{t('historial.visibleCount', { count: frozenVariables.visibleFunctionalCount })}</Badge>
                  <Badge bg="light" text="dark" className="border">{t('historial.technicalCount', { count: frozenVariables.total })}</Badge>
                  <Button variant="outline-secondary" size="sm" className="fw-bold ms-1" onClick={() => setShowExecutionSnapshot(current => !current)}>
                    {showExecutionSnapshot ? <ChevronDown size={14} className="me-1" /> : <ChevronRight size={14} className="me-1" />}
                    {showExecutionSnapshot ? t('historial.hide') : t('historial.view')}
                  </Button>
                </div>
              </div>
              {showExecutionSnapshot && (
                <>
                  <div className="position-relative mt-2 mb-2">
                    <Search size={15} className="position-absolute text-muted" style={{ left: 12, top: 10 }} />
                    <Form.Control name="a11y-rundetailviewtsx-72" aria-label={t('historial.searchVariable')}
                      size="sm"
                      className="ps-5"
                      placeholder={t('historial.searchVariable')}
                      value={frozenSearch}
                      onChange={(event) => setFrozenSearch(event.target.value)}
                    />
                  </div>
                  {frozenVariables.total === 0 ? (
                    <div className="small text-muted">{t('historial.noFrozenVariables')}</div>
                  ) : (
                    <>
                      <Row className="g-2">
                        {frozenVariables.groups.map(group => (
                          <Col md={6} key={group.id}>
                            <FrozenDataCard
                              group={group}
                              canRevealSecrets={canRevealSecrets}
                              revealedSecrets={revealedSecrets}
                              onRevealSecret={revealSecret}
                              t={t}
                            />
                          </Col>
                        ))}
                      </Row>
                      <div className="border rounded-3 bg-light p-2 mt-2">
                        <div className="d-flex align-items-center justify-content-between gap-2">
                          <div>
                            <div className="fw-bold small">{t('historial.technicalVariables')}</div>
                            <div className="x-small text-muted">{t('historial.originalDictionary')}</div>
                          </div>
                          <Button variant="outline-secondary" size="sm" className="fw-bold" onClick={() => setShowTechnicalVariables(current => !current)}>
                            {showTechnicalVariables ? t('historial.hideTechnicalVariables') : t('historial.viewTechnicalVariables')}
                          </Button>
                        </div>
                        {showTechnicalVariables && (
                          <div className="table-responsive mt-3">
                            <table className="table table-sm table-bordered bg-white mb-0 small">
                              <thead>
                                <tr>
                                  <th style={{ width: 260 }}>{t('historial.variable')}</th>
                                  <th>{t('historial.value')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {frozenVariables.technicalRows.map(row => (
                                  <tr key={row.key}>
                                    <td>
                                      <div className="font-monospace">{row.key}</div>
                                      <div className="x-small text-muted">{row.label}</div>
                                    </td>
                                    <td>
                                      <FrozenValue
                                        fieldKey={row.key}
                                        value={row.value}
                                        sensitive={row.sensitive}
                                        canRevealSecrets={canRevealSecrets}
                                        revealedSecrets={revealedSecrets}
                                        onRevealSecret={revealSecret}
                                        t={t}
                                      />
                                    </td>
                                  </tr>
                                ))}
                                {frozenVariables.technicalRows.length === 0 && (
                                  <tr><td colSpan={2} className="text-muted">{t('historial.noMatchingVariables')}</td></tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </Card>

            {!focusError && displayCases.map((caso: any) => {
              const executionMode = effectiveExecutionMode(detail, caso)
              const executionLabel = localizedExecutionModeLabel(executionMode, caso.execution_mode_label, t)
              const executionId = getExecutionId(caso)
              return (
              <Card key={executionId || caso.caso_id} className="border shadow-sm">
                <Card.Header className="bg-white d-flex justify-content-between align-items-start gap-3">
                  <div>
                    <div className="d-flex align-items-center gap-2">
                      <Badge bg="light" text="primary" className="border">{caso.codigo || caso.caso_id?.slice(0, 8)}</Badge>
                      <span className="fw-bold">{caso.titulo}</span>
                      <Badge bg={caseTypeBadge(caso.case_type)}>{caseTypeCopy(localizedCaseTypeLabel(caso.case_type_label, t), t)}</Badge>
                      {caso.formato_prueba === 'CONVERSACIONAL' && <Badge bg="dark">{t('historial.caseLabel', { label: 'Chatbot' })}</Badge>}
                      <Badge bg={executionModeBadge(executionMode)}>{executionModeCopy(executionMode, executionLabel, t)}</Badge>
                      {caso.ai_review_status === 'REVISADA' && <Badge bg="success">{t('historial.aiReviewed')}</Badge>}
                      {caso.ai_human_review_required && <Badge bg="danger">{t('historial.humanReviewPending')}</Badge>}
                    </div>
                    <div className="x-small text-muted mt-1">{t('historial.executedVersionMeta', { version: caso.version_ejecutada, date: formatDate(caso.fecha_ejecucion), duration: formatSeconds(caso.duracion_segundos) })}</div>
                  </div>
                  <Badge bg={getStatusColor(caso.estado)}>{localizedResultStatus(caso.estado, t)}</Badge>
                </Card.Header>
                <Card.Body className="d-flex flex-column gap-3">
                  {caso.formato_prueba === 'CONVERSACIONAL' && (
                    <Alert variant="warning" className="mb-0 small">
                      {t('historial.conversationalEvaluationWarning')}
                    </Alert>
                  )}
                  {caso.has_ai_report && (
                    <Alert variant={caso.ai_human_review_required ? 'warning' : 'info'} className="mb-0">
                      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                        <div>
                            <div className="fw-bold small">{t('historial.aiReportAvailable')}</div>
                          <div className="x-small">
                            {t('historial.consensus')}: {localizedResultStatus(caso.ai_consensus || caso.ai_report?.consensus || caso.estado, t)}
                            {' · '}{t('historial.confidence')}: {caso.ai_confidence ?? caso.ai_report.confidence ?? 0}%
                            {caso.ai_failure_category ? ` · ${t('historial.failureCategory')}: ${caso.ai_failure_category}` : ''}
                          </div>
                        </div>
                        <div className="d-flex align-items-center gap-2">
                          {onMarkAiReviewed && (caso.ai_human_review_required || caso.ai_review_status === 'REQUIERE_REVISION') && (
                            <Button variant="warning" size="sm" className="fw-bold" disabled={!!markingReviewIds[executionId]} onClick={() => setReviewConfirmCase(caso)}>
                              {markingReviewIds[executionId] && <Spinner size="sm" className="me-1" />}
                              {t('historial.markAsReviewed')}
                            </Button>
                          )}
                          <Button variant="outline-primary" size="sm" onClick={() => setAiReportCase({
                            execution_id: executionId,
                            case_id: caso.caso_id,
                            case_code: caso.codigo,
                            case_title: caso.titulo,
                            status: caso.estado,
                            observations: caso.observaciones,
                            duration_seconds: caso.duracion_segundos,
                            confidence: caso.ai_confidence,
                            consensus: caso.ai_consensus,
                            failure_category: caso.ai_failure_category,
                            error_code: caso.ai_error_code,
                            execution_mode: executionMode,
                            review_status: caso.ai_review_status,
                            human_review_required: caso.ai_human_review_required,
                            ai_report: caso.ai_report,
                            formato_prueba: caso.formato_prueba,
                            chatbot_config_snapshot: caso.chatbot_config_snapshot,
                            chatbot_resultado: caso.chatbot_resultado,
                          })}>
                            {t('historial.viewAiReport')}
                          </Button>
                        </div>
                      </div>
                    </Alert>
                  )}
                  {!caso.has_ai_report && executionMode === 'IA' && (
                    <Alert variant="info" className="mb-0">
                      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                        <div>
                          <div className="fw-bold small">{t('historial.aiReportAvailable')}</div>
                          <div className="x-small">{t('historial.aiReportReconstructed')}</div>
                        </div>
                        <div className="d-flex align-items-center gap-2">
                          {onMarkAiReviewed && (caso.ai_human_review_required || caso.ai_review_status === 'REQUIERE_REVISION') && (
                            <Button variant="warning" size="sm" className="fw-bold" disabled={!!markingReviewIds[executionId]} onClick={() => setReviewConfirmCase(caso)}>
                              {markingReviewIds[executionId] && <Spinner size="sm" className="me-1" />}
                              {t('historial.markAsReviewed')}
                            </Button>
                          )}
                          <Button variant="outline-primary" size="sm" onClick={() => setAiReportCase(buildHistoryAiReportPayload(detail, caso, t))}>
                            {t('historial.viewAiReport')}
                          </Button>
                        </div>
                      </div>
                    </Alert>
                  )}
                  {(caso.descripcion || caso.precondiciones || caso.postcondiciones) && (
                    <Row className="g-2 small">
                      {caso.descripcion && <Col md={4}><div className="fw-bold text-muted x-small text-uppercase">{t('historial.objective')}</div><div>{caso.descripcion}</div></Col>}
                      {caso.precondiciones && <Col md={4}><div className="fw-bold text-muted x-small text-uppercase">{t('ejecutarPruebas.preconditions')}</div><div>{caso.precondiciones}</div></Col>}
                      {caso.postcondiciones && <Col md={4}><div className="fw-bold text-muted x-small text-uppercase">{t('ejecutarPruebas.postconditions')}</div><div>{caso.postcondiciones}</div></Col>}
                    </Row>
                  )}
                  {(caso.dataset_resuelto || []).length > 0 && (
                    <div>
                      <div className="fw-bold text-muted x-small text-uppercase mb-1">{t('historial.usedCaseData')}</div>
                      <div className="d-flex flex-wrap gap-1">
                        {caso.dataset_resuelto.map((item: any, index: number) => <Badge key={`${item.key}-${index}`} bg="light" text="dark" className="border font-monospace">{item.key}={item.value}</Badge>)}
                      </div>
                    </div>
                  )}
                  {(caso.snapshots || []).map((snapshot: any) => (
                    <div key={snapshot.id} className="border rounded-3 p-3">
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <div className="fw-bold small">{t('ejecutarPruebas.steps')} {snapshot.numero_paso}</div>
                        <Badge bg={getStatusColor(snapshot.estado_paso)}>{localizedResultStatus(snapshot.estado_paso, t)}</Badge>
                      </div>
                      <Row className="g-3 small">
                        <Col md={4}><div className="text-muted x-small fw-bold text-uppercase">{t('historial.action')}</div><div>{snapshot.accion_congelada || t('historial.undefinedAction')}</div></Col>
                        <Col md={4}><div className="text-muted x-small fw-bold text-uppercase">{t('historial.resolvedData')}</div><div className="font-monospace">{snapshot.datos_resueltos || '-'}</div></Col>
                        <Col md={4}><div className="text-muted x-small fw-bold text-uppercase">{t('historial.expectedResult')}</div><div>{snapshot.resultado_esperado_congelado || '-'}</div></Col>
                        {(snapshot.comentarios || snapshot.error_log) && <Col md={12}><div className="text-muted x-small fw-bold text-uppercase">{t('historial.observations')}</div><div>{snapshot.comentarios || snapshot.error_log}</div></Col>}
                        <Col md={6}><div className="text-muted x-small fw-bold text-uppercase mb-1">{t('historial.references')}</div>{canViewEvidence ? <EvidenceList items={[...(snapshot.action_references || []), ...(snapshot.expected_references || [])]} onOpenEvidence={onOpenEvidence} /> : <span className="text-muted x-small">{t('historial.noAccess')}</span>}</Col>
                        <Col md={6}><div className="text-muted x-small fw-bold text-uppercase mb-1">{t('historial.evidenceCol')}</div>{canViewEvidence ? <EvidenceList items={snapshot.evidencias || []} onOpenEvidence={onOpenEvidence} /> : <span className="text-muted x-small">{t('historial.noAccess')}</span>}</Col>
                      </Row>
                    </div>
                  ))}
                </Card.Body>
              </Card>
              )
            })}
            </div>
          )}
        </Modal.Body>
      </Modal>
      <AiExecutionReportModal
        show={!!aiReportCase}
        report={aiReportCase}
        onHide={() => setAiReportCase(null)}
        onMarkReviewed={onMarkAiReviewed ? (executionId: string) => markAiReviewed(executionId) : undefined}
        onCreateBug={createChatbotBug}
      />
      <Modal show={!!reviewConfirmCase} onHide={() => setReviewConfirmCase(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="fw-bold">{t('historial.confirmAiReview')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="small mb-3">
            {t('historial.confirmAiReviewDescription')}
          </p>
          <Form.Group>
            <Form.Label className="small fw-bold">{t('historial.optionalNote')}</Form.Label>
            <Form.Control name="a11y-rundetailviewtsx-288" aria-label={t('historial.optionalNote')}
              as="textarea"
              rows={3}
              value={reviewNote}
              onChange={event => setReviewNote(event.target.value)}
              placeholder={t('historial.reviewNotePlaceholder')}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setReviewConfirmCase(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="warning"
            className="fw-bold"
            disabled={!!markingReviewIds[getExecutionId(reviewConfirmCase)]}
            onClick={() => markAiReviewed(getExecutionId(reviewConfirmCase), reviewNote)}
          >
            {markingReviewIds[getExecutionId(reviewConfirmCase)] && <Spinner size="sm" className="me-1" />}
            {t('historial.confirmReview')}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}
