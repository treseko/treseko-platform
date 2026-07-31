import { Badge, Button, Card, Col, Form, Row } from 'react-bootstrap'
import { AlertCircle, Save } from 'lucide-react'
import { EvidenceUpload } from '../../EvidenceUpload'

export function ManualConsoleExecutionPanel({ context }: { context: any }) {
  const {
    t,
    executionSnapshots,
    getSnapshotStatus,
    resolvePlaceholders,
    hasPlaceholder,
    getSnapshotReferences,
    renderCaseReferences,
    requireFailureDocumentation,
    isEvidenceRequiredStatus,
    hasUserDocumentationNote,
    snapshotNotes,
    snapshotAttachments,
    handleSnapshotStatusChange,
    handleSnapshotNoteChange,
    handleSnapshotNoteBlur,
    attachmentConfig,
    handleSnapshotAttachmentUpload,
    handleRemoveSnapshotAttachment,
    generalExecutionStatus,
    setGeneralExecutionStatus,
    generalDocumentationMissing,
    generalExecutionNote,
    setGeneralExecutionNote,
    generalExecutionSnapshot,
    generalExecutionAttachments,
    handleGeneralExecutionAttachmentUpload,
    handleRemoveGeneralExecutionAttachment,
    evidenceBlockMessage,
    finishDisabled,
    handleCompleteCase,
  } = context

  return (
    <>
      <Card.Body className="p-0 bg-light">
        {executionSnapshots.map((snapshot: any, index: number) => {
          const hasBlockingPreviousStep = executionSnapshots.slice(0, index).some((previous: any) => {
            const previousStatus = getSnapshotStatus(previous)
            return !previousStatus || previousStatus === 'SIN_CORRER' || previousStatus === 'FALLO' || previousStatus === 'BLOQUEADO'
          })
          const isBlocked = index > 0 && hasBlockingPreviousStep
          const currentResult = getSnapshotStatus(snapshot)
          const hasFailed = currentResult === 'FALLO' || currentResult === 'BLOQUEADO'
          const actionText = snapshot.accion_congelada || t('historial.undefinedAction')
          const stepDataText = String(snapshot.datos_congelados || '').trim()
          const rawResolvedStepData = String(snapshot.datos_resueltos || (stepDataText ? resolvePlaceholders(stepDataText) : '')).trim()
          const resolvedStepDataText = rawResolvedStepData && rawResolvedStepData !== stepDataText && !hasPlaceholder(rawResolvedStepData)
            ? rawResolvedStepData
            : ''
          const visibleStepDataText = resolvedStepDataText || stepDataText
          const expectedText = snapshot.resultado_esperado_congelado || 'Sin resultado esperado definido'
          const actionReferences = getSnapshotReferences(snapshot, 'action')
          const expectedReferences = getSnapshotReferences(snapshot, 'expected')
          const snapshotDocumentationMissing = Boolean(
            requireFailureDocumentation &&
            isEvidenceRequiredStatus(currentResult) &&
            !hasUserDocumentationNote(snapshotNotes[snapshot.numero_paso]) &&
            (snapshotAttachments[snapshot.id] || []).length === 0 &&
            !snapshot.evidencia_url
          )

          return (
            <div key={snapshot.id} className={`manual-console-step p-4 border-bottom bg-white transition-all ${isBlocked ? 'opacity-50' : ''}`}>
              <div className="manual-console-step-main d-flex gap-3">
                <div className="flex-shrink-0 mt-1">
                  <Badge bg={currentResult === 'PASO' ? 'success' : currentResult === 'FALLO' ? 'danger' : 'secondary'} className="rounded-circle p-2 fs-5 d-flex align-items-center justify-content-center shadow-sm" style={{width: '36px', height: '36px'}}>
                    {snapshot.numero_paso}
                  </Badge>
                </div>

                <div className="flex-grow-1">
                  <Row className="g-3">
                    <Col lg={stepDataText ? 5 : 6} md={stepDataText ? 5 : 6}>
                      <div className="x-small fw-bold text-muted text-uppercase mb-2" style={{ letterSpacing: '0.5px' }}>{t('ejecutarPruebas.actionToExecute')}</div>
                      <div className={`small fw-bold bg-light p-3 rounded-3 border border-light-subtle ${snapshot.accion_congelada ? 'text-dark' : 'text-muted'}`}>
                        {actionText}
                      </div>
                      {renderCaseReferences('Referencia del caso', actionReferences)}
                    </Col>
                    {visibleStepDataText && (
                      <Col lg={3} md={3}>
                        <div className="x-small fw-bold text-muted text-uppercase mb-2" style={{ letterSpacing: '0.5px' }}>Datos</div>
                        <div className="small bg-white px-3 py-2 rounded-3 border border-success border-opacity-25 font-monospace text-primary text-break shadow-sm" style={{ minHeight: '44px', maxHeight: '96px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                          {visibleStepDataText}
                        </div>
                      </Col>
                    )}
                    <Col lg={stepDataText ? 4 : 6} md={stepDataText ? 4 : 6}>
                      <div className="x-small fw-bold text-muted text-uppercase mb-2" style={{ letterSpacing: '0.5px' }}>Resultado esperado</div>
                      <div className={`small p-3 rounded-3 border border-light-subtle bg-white ${snapshot.resultado_esperado_congelado ? 'text-secondary' : 'text-muted'}`}>
                        {expectedText}
                      </div>
                      {renderCaseReferences('Referencia esperada', expectedReferences)}
                    </Col>
                  </Row>

                  <div className={`mt-4 p-3 rounded-4 border shadow-sm transition-all ${snapshotDocumentationMissing ? 'bg-danger bg-opacity-10 border-danger border-opacity-50' : 'bg-light border-light-subtle'}`}>
                    <Row className="g-3 align-items-start">
                      <Col md={3}>
                        <Form.Label className="x-small fw-bold text-dark text-uppercase">Veredicto</Form.Label>
                        <Form.Select size="sm" className={`fw-bold shadow-sm cursor-pointer border-2 p-2 ${currentResult === 'PASO' ? 'text-success border-success' : currentResult === 'FALLO' ? 'text-danger border-danger' : 'text-secondary border-secondary'}`} disabled={isBlocked} value={currentResult} onChange={(event) => handleSnapshotStatusChange(snapshot, event.target.value)}>
                          <option value="SIN_CORRER">{t('ejecutarPruebas.pending')}</option>
                          <option value="PASO">{t('ejecutarPruebas.pass')}</option>
                          <option value="FALLO">{t('ejecutarPruebas.fail')}</option>
                          <option value="BLOQUEADO">{t('ejecutarPruebas.blocked')}</option>
                        </Form.Select>
                      </Col>
                      <Col md={9}>
                        <Form.Label className="x-small fw-bold text-dark text-uppercase d-flex justify-content-between w-100">
                          <span>{t('ejecutarPruebas.observationsEvidence')}</span>
                        </Form.Label>
                        <Form.Control as="textarea" rows={2} size="sm" placeholder={hasFailed ? 'Detalla la falla encontrada y adjunta evidencia para Redmine...' : 'Notas opcionales del comportamiento...'} className={`shadow-sm text-dark ${snapshotDocumentationMissing ? 'bg-white border-danger' : 'bg-white border-light-subtle'}`} disabled={isBlocked} value={snapshotNotes[snapshot.numero_paso] || ''} onChange={(event) => handleSnapshotNoteChange(snapshot.numero_paso, event.target.value)} onBlur={() => handleSnapshotNoteBlur(snapshot)} />
                        <div className="mt-2">
                          <EvidenceUpload compact label="Adjuntar evidencia" uploadScope="EXECUTION_EVIDENCE" maxFileSize={attachmentConfig.max_file_size_mb} enablePaste={attachmentConfig.enable_clipboard_paste} disabled={isBlocked} currentEvidence={snapshot.evidencia_url} currentAttachments={snapshotAttachments[snapshot.id] || []} onUploadComplete={(attachment) => handleSnapshotAttachmentUpload(snapshot, attachment)} onRemoveAttachment={(attachment) => handleRemoveSnapshotAttachment(snapshot, attachment)} />
                        </div>
                        {snapshotDocumentationMissing && (
                          <div className="text-danger fw-semibold x-small mt-2 d-flex align-items-center gap-1">
                            <AlertCircle size={14} />
                            {t('ejecutarPruebas.missingFailureDoc')}
                          </div>
                        )}
                      </Col>
                    </Row>
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {executionSnapshots.length === 0 && (
          <div className="p-5 bg-white">
            <div className="d-flex align-items-start gap-3 mb-4">
              <div className="bg-warning bg-opacity-10 p-3 rounded-circle border border-warning border-opacity-25">
                <AlertCircle size={28} className="text-warning"/>
              </div>
              <div>
                <h5 className="fw-bold text-dark mb-1">{t('ejecutarPruebas.executionWithoutSteps')}</h5>
                <p className="small text-muted mb-0">{t('ejecutarPruebas.executionWithoutStepsDescription')}</p>
              </div>
            </div>
            <Row className="g-3">
              <Col md={4}>
                <Form.Label className="x-small fw-bold text-dark text-uppercase">Veredicto general</Form.Label>
                <Form.Select size="sm" className="fw-bold shadow-sm border-2 p-2 text-dark" value={generalExecutionStatus} onChange={(event) => setGeneralExecutionStatus(event.target.value)}>
                  <option value="SIN_CORRER">{t('ejecutarPruebas.pending')}</option>
                  <option value="PASO">{t('ejecutarPruebas.pass')}</option>
                  <option value="FALLO">{t('ejecutarPruebas.fail')}</option>
                  <option value="BLOQUEADO">{t('ejecutarPruebas.blocked')}</option>
                </Form.Select>
              </Col>
              <Col md={8}>
                <Form.Label className="x-small fw-bold text-dark text-uppercase">{t('ejecutarPruebas.generalObservation')}</Form.Label>
                <Form.Control as="textarea" rows={3} size="sm" className={`shadow-sm text-dark bg-white ${generalDocumentationMissing ? 'border-danger' : 'border-light-subtle'}`} value={generalExecutionNote} onChange={(event) => setGeneralExecutionNote(event.target.value)} placeholder={generalExecutionStatus === 'FALLO' || generalExecutionStatus === 'BLOQUEADO' ? t('ejecutarPruebas.failureOrBlockPlaceholder') : t('ejecutarPruebas.generalNotesPlaceholder')} />
                {(requireFailureDocumentation && isEvidenceRequiredStatus(generalExecutionStatus)) && (
                  <div className={`mt-2 rounded-3 ${generalDocumentationMissing ? 'p-2 bg-danger bg-opacity-10 border border-danger border-opacity-25' : ''}`}>
                    <EvidenceUpload compact label="Adjuntar evidencia general" uploadScope="EXECUTION_EVIDENCE" maxFileSize={attachmentConfig.max_file_size_mb} enablePaste={attachmentConfig.enable_clipboard_paste} currentEvidence={generalExecutionSnapshot?.evidencia_url} currentAttachments={generalExecutionAttachments} onUploadComplete={handleGeneralExecutionAttachmentUpload} onRemoveAttachment={handleRemoveGeneralExecutionAttachment} />
                  </div>
                )}
                {generalDocumentationMissing && (
                  <div className="text-danger fw-semibold x-small mt-2 d-flex align-items-center gap-1">
                    <AlertCircle size={14} />
                    {t('ejecutarPruebas.missingFailureDoc')}
                  </div>
                )}
              </Col>
            </Row>
          </div>
        )}
      </Card.Body>

      <Card.Footer className="manual-console-footer bg-white p-4 text-end border-top d-flex justify-content-between align-items-center gap-3">
        <span className={`small fw-bold text-start ${evidenceBlockMessage ? 'text-danger' : 'text-muted'}`} style={{ minHeight: '20px' }}>
          {evidenceBlockMessage || (requireFailureDocumentation
            ? 'Si marcas FALLO o BLOQUEADO, agrega un comentario o adjunta evidencia.'
            : t('ejecutarPruebas.documentEvidenceHint'))}
        </span>
        <Button variant="success" className="px-5 fw-bold shadow py-3 rounded-pill d-flex align-items-center gap-2 fs-6" onClick={handleCompleteCase} disabled={finishDisabled} title={evidenceBlockMessage ? t('ejecutarPruebas.missingFailureDoc') : undefined}>
          <Save size={20}/> {t('ejecutarPruebas.finishAndSave')}
        </Button>
      </Card.Footer>
    </>
  )
}
