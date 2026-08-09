import { Badge, Button, Card, Col, ListGroup, Spinner } from 'react-bootstrap'
import { Bug, ChevronDown, ChevronRight, Clock, Eye, FileText, History, ImagePlus, Info, RefreshCw, User, XCircle } from 'lucide-react'
import type { AttachmentMeta } from '../../EvidenceUpload'

export function ManualConsoleSidebar({ context }: { context: any }) {
  const { t,
    leftSectionStyle,
    selectedTest,
    collapsedLeftSections,
    toggleLeftSection,
    selectedTestComponentLabel,
    renderTextBlock,
    renderExecutionDataRows,
    expandedSectionBodyStyle,
    relatedCaseBugs,
    relatedCaseBugsLoading,
    latestRelatedBug,
    closedBugStates,
    isBugLinkedToCurrentExecution,
    getBugDisplayBuild,
    getBugDisplayComponent,
    onViewRelatedBug,
    canViewBugs = true,
    canCreateBugs = true,
    canLinkCurrentExecution,
    executionCanLinkCurrent = canLinkCurrentExecution,
    onLinkExecutionToBug,
    creatingInternalBugContextId,
    setLinkingBug,
    setLinkComment,
    onCreateInternalBugFromExecution,
    executionHistory,
    latestHistoryItem,
    getStatusColor,
    openAttachmentEvidence,
    isEvidenceAvailable,
    isImageAsset,
    resolveAssetUrl,
    openLegacyEvidence } = context
  return (
            <Col xl={3} lg={4} className="manual-console-details-column d-flex flex-column gap-3">
              <Card className="border-0 shadow-sm rounded-4 bg-white d-flex flex-column overflow-hidden" style={leftSectionStyle()}>
                <Card.Header className="bg-white border-bottom py-3 d-flex justify-content-between align-items-center gap-2">
                  <div className="min-w-0">
                    <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2"><Info size={18} className="text-primary"/> {t('ejecutarPruebas.caseDetails')}</h6>
                    {collapsedLeftSections.details && (
                      <div className="x-small text-muted text-truncate mt-1" title={`${selectedTest.code || selectedTest.id} · ${selectedTest.title} · ${selectedTestComponentLabel}`}>
                        {selectedTest.code || selectedTest.id} · {selectedTest.title} · {selectedTestComponentLabel}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="light"
                    size="sm"
                    className="border p-1 flex-shrink-0"
                    aria-label={collapsedLeftSections.details ? 'Expandir detalles del caso' : 'Compactar detalles del caso'}
                    title={collapsedLeftSections.details ? 'Expandir' : 'Compactar'}
                    onClick={() => toggleLeftSection('details')}
                  >
                    {collapsedLeftSections.details ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  </Button>
                </Card.Header>
                {!collapsedLeftSections.details && (
                  <Card.Body className="manual-console-case-details-body p-3" style={expandedSectionBodyStyle}>
                    {renderTextBlock(t('ejecutarPruebas.objectiveDescription'), selectedTest.description || '', t('ejecutarPruebas.noObjective'))}
                    {renderTextBlock('Precondiciones', selectedTest.pre || '', 'Ninguna precondicion especificada.')}
                    {renderTextBlock('Postcondiciones', selectedTest.post || '', 'Ninguna postcondicion especificada.')}
                    <div className="mb-3">
                      <div className="x-small fw-bold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.5px' }}>Datos usados en esta ejecucion</div>
                      {renderExecutionDataRows()}
                    </div>
                    <div>
                      <div className="x-small fw-bold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.5px' }}>Componente Afectado</div>
                      <Badge bg="light" text="dark" className="border shadow-sm">{selectedTestComponentLabel}</Badge>
                    </div>
                  </Card.Body>
                )}
              </Card>

              <Card className="border-0 shadow-sm rounded-4 bg-white d-flex flex-column overflow-hidden" style={leftSectionStyle()}>
                <Card.Header className="bg-white border-bottom py-3 d-flex justify-content-between align-items-center gap-2">
                  <div className="min-w-0">
                    <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2">
                      <Bug size={18} className="text-danger"/> {t('ejecutarPruebas.relatedBugs')}
                    </h6>
                    {collapsedLeftSections.bugs && (
                      <div className="x-small text-muted text-truncate mt-1" title={latestRelatedBug ? `${latestRelatedBug.codigo} · ${latestRelatedBug.estado}` : 'Sin bugs relacionados'}>
                        {latestRelatedBug ? `${latestRelatedBug.codigo} · ${latestRelatedBug.estado}` : 'Sin bugs relacionados'}
                      </div>
                    )}
                  </div>
                  <div className="d-flex align-items-center gap-2 flex-shrink-0">
                    <Badge bg="light" text="danger" className="border shadow-sm">
                      {relatedCaseBugs.length || (relatedCaseBugsLoading ? '...' : 0)}
                    </Badge>
                    <Button
                      variant="light"
                      size="sm"
                      className="border p-1"
                      aria-label={collapsedLeftSections.bugs ? 'Expandir bugs relacionados' : 'Compactar bugs relacionados'}
                      title={collapsedLeftSections.bugs ? 'Expandir' : 'Compactar'}
                      onClick={() => toggleLeftSection('bugs')}
                    >
                      {collapsedLeftSections.bugs ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    </Button>
                  </div>
                </Card.Header>
                {!collapsedLeftSections.bugs && (
                  <Card.Body className="p-3 flex-grow-1" style={expandedSectionBodyStyle}>
                    {relatedCaseBugsLoading && relatedCaseBugs.length > 0 && (
                      <div className="d-flex align-items-center gap-2 text-muted x-small mb-2">
                        <Spinner animation="border" size="sm" /> Actualizando...
                      </div>
                    )}
                    {relatedCaseBugsLoading && relatedCaseBugs.length === 0 && (
                      <div className="d-flex align-items-center gap-2 text-muted x-small">
                        <Spinner animation="border" size="sm" /> Cargando bugs...
                      </div>
                    )}
                    {!relatedCaseBugsLoading && relatedCaseBugs.length === 0 && (
                      <div className="text-muted x-small">Sin bugs relacionados.</div>
                    )}
                    {relatedCaseBugs.length > 0 && (
                      <div className="d-flex flex-column gap-2">
                        {relatedCaseBugs.slice(0, 4).map((bugItem: any) => {
                          const closed = closedBugStates.has(String(bugItem.estado || '').toUpperCase())
                          const linked = isBugLinkedToCurrentExecution(bugItem)
                          return (
                            <div key={bugItem.id || bugItem.codigo} className="border rounded-3 p-2 bg-light">
                              <div className="d-flex justify-content-between align-items-start gap-2">
                                <div className="min-w-0">
                                  <div className="d-flex align-items-center gap-2 flex-wrap">
                                    <span className="fw-bold text-dark x-small">{bugItem.codigo}</span>
                                    <Badge bg={closed ? 'secondary' : 'danger'} className="x-small">
                                      {closed ? 'CERRADO' : bugItem.estado}
                                    </Badge>
                                  </div>
                                  <div className="x-small text-dark text-truncate mt-1" title={bugItem.titulo}>{bugItem.titulo}</div>
                                  <div className="x-small text-muted mt-1">
                                    {getBugDisplayBuild(bugItem)}
                                    {getBugDisplayComponent(bugItem) ? ` · ${getBugDisplayComponent(bugItem)}` : ''}
                                  </div>
                                  {bugItem.external_issue_id && <Badge bg="light" text="primary" className="border x-small mt-1"><Bug size={10} className="me-1" />{bugItem.external_provider || 'Externo'} #{bugItem.external_issue_id}</Badge>}
                                </div>
                                <div className="d-flex align-items-center justify-content-end gap-1 flex-wrap flex-shrink-0">
                                  <Button
                                    variant="outline-secondary"
                                    size="sm"
                                    className="x-small fw-bold py-1 px-2"
                                    onClick={() => onViewRelatedBug?.(bugItem)}
                                    disabled={!canViewBugs}
                                    title={!canViewBugs ? 'Necesitas permiso para ver bugs.' : 'Ver detalle del bug'}
                                  >
                                    <Eye size={12} /> Ver
                                  </Button>
                                  {linked ? (
                                    <Badge bg="success" className="x-small">Actualizado</Badge>
                                  ) : (
                                    <Button
                                      variant="outline-danger"
                                      size="sm"
                                      className="x-small fw-bold py-1 px-2"
                                      disabled={!canLinkCurrentExecution || !onLinkExecutionToBug || Boolean(creatingInternalBugContextId)}
                                      title={canLinkCurrentExecution ? t('ejecutarPruebas.linkBugTitle') : t('ejecutarPruebas.linkBugDisabledTitle')}
                                      onClick={() => {
                                        setLinkingBug(bugItem)
                                        setLinkComment('')
                                      }}
                                    >
                                      <RefreshCw size={12} /> Actualizar
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {executionCanLinkCurrent && (
                      <div className="d-flex gap-2 flex-wrap mt-3">
                        {relatedCaseBugs.length > 0 && (
                          <Button
                            variant="outline-danger"
                            size="sm"
                            className="fw-bold x-small"
                            onClick={() => {
                              setLinkingBug(relatedCaseBugs[0])
                              setLinkComment('')
                            }}
                            disabled={!canLinkCurrentExecution || !onLinkExecutionToBug || Boolean(creatingInternalBugContextId) || relatedCaseBugs.every(isBugLinkedToCurrentExecution)}
                            title={!canCreateBugs ? 'Necesitas permiso para crear o actualizar bugs.' : undefined}
                          >
                            <RefreshCw size={13} /> Actualizar seguimiento
                          </Button>
                        )}
                        {onCreateInternalBugFromExecution && (
                          <Button
                            variant="danger"
                            size="sm"
                            className="fw-bold x-small"
                            onClick={() => onCreateInternalBugFromExecution()}
                            disabled={!canCreateBugs || Boolean(creatingInternalBugContextId)}
                            title={!canCreateBugs ? 'Necesitas permiso para crear bugs.' : undefined}
                          >
                            <Bug size={13} /> Crear bug nuevo
                          </Button>
                        )}
                      </div>
                    )}
                  </Card.Body>
                )}
              </Card>

              <Card className="border-0 shadow-sm rounded-4 bg-white d-flex flex-column overflow-hidden" style={leftSectionStyle()}>
                <Card.Header className="bg-white border-bottom py-3 d-flex justify-content-between align-items-center gap-2">
                  <div className="min-w-0">
                    <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2"><History size={18} className="text-secondary"/> {t('ejecutarPruebas.detailedHistory')}</h6>
                    {collapsedLeftSections.history && (
                      <div className="x-small text-muted text-truncate mt-1" title={latestHistoryItem ? `${latestHistoryItem.status} · ${latestHistoryItem.date}` : 'Sin ejecuciones previas'}>
                        {latestHistoryItem ? t('ejecutarPruebas.latestHistory', { status: latestHistoryItem.status, date: latestHistoryItem.date }) : t('ejecutarPruebas.noPreviousExecutions')}
                      </div>
                    )}
                  </div>
                  <div className="d-flex align-items-center gap-2 flex-shrink-0">
                    <Badge bg="light" text="secondary" className="border shadow-sm">{executionHistory.length}</Badge>
                    <Button
                      variant="light"
                      size="sm"
                      className="border p-1"
                      aria-label={collapsedLeftSections.history ? 'Expandir historial detallado' : 'Compactar historial detallado'}
                      title={collapsedLeftSections.history ? 'Expandir' : 'Compactar'}
                      onClick={() => toggleLeftSection('history')}
                    >
                      {collapsedLeftSections.history ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    </Button>
                  </div>
                </Card.Header>
                {!collapsedLeftSections.history && (
                  <Card.Body className="p-0 flex-grow-1" style={expandedSectionBodyStyle}>
                    <ListGroup variant="flush">
                      {executionHistory.map((historyItem: any, index: number) => (
                      <ListGroup.Item key={index} className="p-3 bg-transparent border-light-subtle">
                        <div className="d-flex justify-content-between align-items-start mb-2">
                          <Badge bg={getStatusColor(historyItem.status)} className="x-small shadow-sm">{historyItem.status?.toUpperCase()}</Badge>
                          <span className="x-small text-muted font-monospace">{historyItem.date}</span>
                        </div>

                        <div className="bg-light p-2 rounded-2 border border-light-subtle x-small mb-2">
                          {(historyItem.status === 'FALLO' || historyItem.status === 'FALLIDO') && (
                            <div className="text-danger fw-bold mb-1 d-flex align-items-center gap-1">
                              <XCircle size={12}/> {historyItem.failedStep ? t('ejecutarPruebas.failedAtStep', { step: historyItem.failedStep }) : t('ejecutarPruebas.validationFailure')}
                            </div>
                          )}

                          <div className="text-dark mb-1">
                            {historyItem.observation || (historyItem.status === 'FALLO' || historyItem.status === 'FALLIDO'
                              ? (relatedCaseBugs.length > 0 ? t('ejecutarPruebas.relatedBugsNotice') : t('ejecutarPruebas.issueWithoutBugNotice'))
                              : t('ejecutarPruebas.executionWithoutIssues'))}
                          </div>

                          {(historyItem.evidenceUrl || historyItem.evidencias?.length > 0) && (
                            <div className="mt-2 pt-2 border-top border-light-subtle">
                              {historyItem.evidencias?.length > 0 ? (
                                <div className="d-flex flex-wrap gap-2">
                                  {historyItem.evidencias.map((attachment: AttachmentMeta) => (
                                    isEvidenceAvailable(attachment) && isImageAsset(attachment) ? (
                                      <button
                                        type="button"
                                        key={attachment.id}
                                        className="border rounded-2 bg-white p-0"
                                        title={attachment.filename_original}
                                        onClick={() => openAttachmentEvidence(attachment)}
                                      >
                                        <img src={resolveAssetUrl(attachment.public_url)} alt={attachment.filename_original} className="rounded-2" style={{ width: 40, height: 40, objectFit: 'cover' }} />
                                      </button>
                                    ) : (
                                      <Button key={attachment.id} variant={isEvidenceAvailable(attachment) ? 'link' : 'outline-warning'} size="sm" className={`${isEvidenceAvailable(attachment) ? 'p-0' : 'py-0 px-1'} x-small text-decoration-none d-flex align-items-center gap-1 fw-bold`} onClick={() => openAttachmentEvidence(attachment)}>
                                        <FileText size={14}/> {attachment.filename_original || 'Ver evidencia'}
                                        {!isEvidenceAvailable(attachment) && <Badge bg="warning" text="dark">Archivo no disponible</Badge>}
                                      </Button>
                                    )
                                  ))}
                                </div>
                              ) : (
                                <Button variant="link" size="sm" className="p-0 x-small text-decoration-none d-flex align-items-center gap-1 fw-bold" onClick={() => openLegacyEvidence(historyItem.evidenceUrl)}>
                                  <ImagePlus size={14}/> Ver evidencia adjunta
                                </Button>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="d-flex justify-content-between align-items-center mt-2">
                          {historyItem.executedBy ? (
                            <div className="x-small text-dark d-flex align-items-center gap-1">
                              <User size={12} className="text-primary"/> <span className="fw-semibold">{historyItem.executedBy}</span>
                            </div>
                          ) : <span className="x-small text-muted">Auto</span>}
                          {historyItem.duration && (
                            <div className="x-small text-muted d-flex align-items-center gap-1">
                              <Clock size={12}/> {historyItem.duration}
                            </div>
                          )}
                        </div>
                      </ListGroup.Item>
                    ))}
                    {executionHistory.length === 0 && (
                      <div className="p-4 text-center text-muted x-small d-flex flex-column align-items-center gap-2">
                        <History size={24} className="opacity-25" />
                        <span>No hay ejecuciones previas registradas.</span>
                      </div>
                    )}
                  </ListGroup>
                </Card.Body>
                )}
              </Card>
            </Col>
  )
}
