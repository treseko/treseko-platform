import { Badge, Button, Card, Col, Form, Modal, OverlayTrigger, Row, Spinner, Table, Tooltip } from 'react-bootstrap'
import { Bug, Clipboard, ExternalLink, Info, Link as LinkIcon, MessageSquare, Plus, RefreshCw, Save, X } from 'lucide-react'
import { EvidenceUpload, type AttachmentMeta } from '../../EvidenceUpload'
import { EvidenceViewerModal } from '../../shared/components/EvidenceViewerModal'
import { isEvidenceAvailable } from '../../shared/utils/evidenceAvailability'
import { BugTransitionModal } from './BugTransitionModal'
import {
  EXTERNAL_ISSUE_PROVIDERS, bugBuildOriginLabel, bugComponentLabel, bugOccurrenceBuilds, bugStatusHelp,
  bugTraceLabel, closedStates, externalIssueLabel, priorityOptions, severityOptions, severityVariant, statusOptions,
} from './bugTrackerHelpers'
import { formatBugPriorityOption, getBugCriticalityPresentation, getBugPriorityPresentation, getBugSeverityPresentation } from './bugPresentation'

type BugTrackerViewContext = {
  t: any,
  canUse: any,
  canCreate: any,
  canEdit: any,
  canTriage: any,
  canComment: any,
  canAttachBugEvidence: any,
  canLinkExternal: any,
  canExport: any,
  currentBuildLabel: any,
  currentComponentLabel: any,
  appUsers: any,
  bugs: any,
  summary: any,
  loading: any,
  selectedBug: any,
  detailOpen: any,
  filters: any,
  comment: any,
  commentAttachments: any,
  externalForm: any,
  markdown: any,
  detailForm: any,
  additionalContextRows: any,
  viewerEvidence: any,
  savingDetail: any,
  showStatusHelp: any,
  loadBugs: any,
  onOpenManualBugDrawer: any,
  openDetail: any,
  transitionTarget: any,
  transitionForm: any,
  compatibleBuilds: any,
  quickTransitioningBugId: any,
  isCorrected: any,
  setTransitionForm: any,
  setTransitionTarget: any,
  confirmTransition: any,
  setShowStatusHelp: any,
  setDetailOpen: any,
  onDetailClosed: any,
  updateDetailField: any,
  openEvidenceViewer: any,
  setComment: any,
  setCommentAttachments: any,
  addComment: any,
  createExternalLink: any,
  generatePreview: any,
  copyMarkdown: any,
  bugGeneralAttachments: any,
  addBugEvidence: any,
  removeBugEvidence: any,
  saveSelectedBugDetails: any,
  setAdditionalContextRows: any,
  updateAdditionalContextRow: any,
  transitionBug: any,
  transitionBugInline: any,
  modalOnly: any,
  linkingBug: any,
  setLinkingBug: any,
  linkComment: any,
  setLinkComment: any,
  linkingBugId: any,
  onViewRelatedBug: any,
  canLinkCurrentExecution: any,
  onLinkExecutionToBug: any,
  creatingInternalBugContextId: any,
  relatedCaseBugs: any,
  relatedCaseBugsLoading: any,
  onCreateInternalBugFromExecution: any,
  getBugDisplayBuild: any,
  getBugDisplayComponent: any,
  setViewerEvidence: any,
  setExternalForm: any,
  setFilters: any,
}
export function BugTrackerView({ context }: { context: BugTrackerViewContext }) {
  const { t, canUse, canCreate, canEdit, canTriage, canComment, canAttachBugEvidence, canLinkExternal, canExport, currentBuildLabel, currentComponentLabel, appUsers, bugs, summary, loading, selectedBug, detailOpen, filters, comment, commentAttachments, externalForm, markdown, detailForm, additionalContextRows, viewerEvidence, savingDetail, showStatusHelp, loadBugs, onOpenManualBugDrawer, openDetail, transitionTarget, transitionForm, compatibleBuilds, quickTransitioningBugId, isCorrected, setTransitionForm, setTransitionTarget, confirmTransition, setShowStatusHelp, setDetailOpen, onDetailClosed, updateDetailField, openEvidenceViewer, setComment, setCommentAttachments, addComment, createExternalLink, generatePreview, copyMarkdown, bugGeneralAttachments, addBugEvidence, removeBugEvidence, saveSelectedBugDetails, setAdditionalContextRows, updateAdditionalContextRow, transitionBug, transitionBugInline, modalOnly, linkingBug, setLinkingBug, linkComment, setLinkComment, linkingBugId, onViewRelatedBug, canLinkCurrentExecution, onLinkExecutionToBug, creatingInternalBugContextId, relatedCaseBugs, relatedCaseBugsLoading, onCreateInternalBugFromExecution, getBugDisplayBuild, getBugDisplayComponent, setViewerEvidence, setExternalForm, setFilters } = context
  return (
    <div className="p-4 bug-tracker-page" style={modalOnly ? { display: 'none' } : undefined}>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3">
        <div>
          <h2 className="h4 fw-bold text-dark mb-1">{t('bugs.pageTitle')}</h2>
          <div className="small text-muted">{t('bugs.pageDescription')}</div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <Button variant="outline-secondary" size="sm" onClick={() => setShowStatusHelp(true)}>
            <Info size={15} className="me-1" /> {t('bugs.statusHelp')}
          </Button>
          {canCreate && onOpenManualBugDrawer && (
            <Button variant="danger" size="sm" onClick={onOpenManualBugDrawer}>
              <Bug size={15} className="me-1" /> {t('bugs.addBug')}
            </Button>
          )}
          <Button variant="outline-primary" size="sm" onClick={() => loadBugs()} disabled={loading}><RefreshCw size={15} className="me-1" />{t('bugs.refresh')}</Button>
        </div>
      </div>

      <Row className="g-3 mb-3">
        {[
          [t('bugs.open'), summary.abiertos ?? 0],
          [t('bugs.critical'), summary.criticos ?? 0],
          [t('bugs.unassigned'), summary.sin_asignado ?? 0],
          [t('bugs.readyRetest'), summary.listos_retest ?? 0],
          [t('bugs.noEvidence'), summary.sin_evidencia ?? 0],
          [t('bugs.linked'), summary.vinculados_externos ?? 0],
        ].map(([label, value]) => (
          <Col md={2} sm={4} xs={6} key={String(label)}>
            <Card className="border-0 shadow-sm h-100"><Card.Body className="py-3"><div className="small text-muted">{label}</div><div className="h4 fw-bold mb-0">{String(value)}</div></Card.Body></Card>
          </Col>
        ))}
      </Row>

      <Row className="g-3">
        <Col xl={12}>
          <Card className="border-0 shadow-sm">
            <Card.Header className="bg-white border-bottom">
              <Row className="g-2">
                <Col md={5}><Form.Control size="sm" placeholder={t('bugs.searchPlaceholder')} value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} /></Col>
                <Col md={2}><Form.Select size="sm" value={filters.estado} onChange={(e) => setFilters({ ...filters, estado: e.target.value })}><option value="">{t('bugs.statusFilter')}</option>{statusOptions.map(item => <option key={item}>{item}</option>)}</Form.Select></Col>
                <Col md={2}><Form.Select size="sm" value={filters.severidad} onChange={(e) => setFilters({ ...filters, severidad: e.target.value })}><option value="">{t('bugs.severityFilter')}</option>{['CRITICA','ALTA','MEDIA','BAJA','COSMETICA'].map(item => <option key={item}>{item}</option>)}</Form.Select></Col>
                <Col md={2}><Form.Select size="sm" value={filters.prioridad} onChange={(e) => setFilters({ ...filters, prioridad: e.target.value })}><option value="">{t('bugs.priorityFilter')}</option>{priorityOptions.map(item => <option key={item} value={item}>{formatBugPriorityOption(item)}</option>)}</Form.Select></Col>
                <Col md={1}><Button size="sm" variant="dark" className="w-100" onClick={() => loadBugs()}>{t('bugs.filter')}</Button></Col>
              </Row>
            </Card.Header>
            <Card.Body className="p-0">
              {loading ? <div className="p-4 text-center"><Spinner size="sm" /> {t('bugs.loading')}</div> : (
                <div className="table-responsive">
                  <Table hover className="mb-0 align-middle">
                    <thead className="table-light"><tr><th>{t('bugs.bugCol')}</th><th>{t('bugs.statusCol')}</th><th>{t('bugs.sevCol')}</th><th>{t('bugs.priCol')}</th><th>{t('bugs.contextCol')}</th><th>{t('bugs.assignedCol')}</th><th className="text-end">{t('bugs.actionsCol')}</th></tr></thead>
                    <tbody>
                      {bugs.map((bug) => {
                        const severity = getBugSeverityPresentation(bug.severidad, '')
                        const priority = getBugPriorityPresentation(bug.prioridad)
                        return (
                        <tr key={bug.id}>
                          <td><strong>{bug.codigo}</strong><div className="small text-muted">{bug.titulo}</div>{externalIssueLabel(bug) && <Badge bg="light" text="primary" className="border mt-1"><ExternalLink size={11} className="me-1" />{externalIssueLabel(bug)}</Badge>}</td>
                          <td><Badge bg={closedStates.has(bug.estado) ? 'secondary' : 'success'}>{bug.estado}</Badge></td>
                          <td><Badge bg={severityVariant[bug.severidad] || 'secondary'} text={bug.severidad === 'COSMETICA' ? 'dark' : undefined}>{severity?.shortLabel || bug.severidad}</Badge></td>
                          <td>
                            {priority ? (
                              <Badge bg={priority.bg} text={priority.text} title={priority.title} className={priority.bg === 'light' ? 'border' : ''}>
                                {priority.shortLabel}
                              </Badge>
                            ) : t('bugs.noDataset')}
                          </td>
                          <td className="small text-muted">{bug.case_code || t('bugs.noCase')}<br />{bug.build_code || bug.build_id || t('bugs.noBuild')}</td>
                          <td className="small">{bug.asignado_a ? appUsers.find((u: any) => u.id === bug.asignado_a)?.name || t('bugs.assigned') : t('bugs.unassignedLabel')}</td>
                          <td>
                            <div className="d-flex justify-content-end align-items-center gap-2">
                              {canTriage && (
                                <Form.Select
                                  size="sm"
                                  className="bug-inline-status-select"
                                  aria-label={t('bugs.currentStatusChangeAria', { bug: bug.codigo })}
                                  value={bug.estado || 'ABIERTO'}
                                  disabled={quickTransitioningBugId === bug.id}
                                  onChange={(event) => transitionBugInline(bug, event.target.value)}
                                >
                                  {statusOptions.map(item => <option key={item}>{item}</option>)}
                                </Form.Select>
                              )}
                              <Button size="sm" variant="outline-primary" onClick={() => openDetail(bug)}>{t('bugs.view')}</Button>
                            </div>
                          </td>
                        </tr>
                      )})}
                      {bugs.length === 0 && <tr><td colSpan={7} className="text-center text-muted py-4">{t('bugs.noBugsForFilters')}</td></tr>}
                    </tbody>
                  </Table>
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>

      </Row>

      <BugTransitionModal target={transitionTarget} form={transitionForm}
        builds={transitionTarget ? compatibleBuilds(transitionTarget.bug) : []}
        busy={Boolean(transitionTarget && quickTransitioningBugId === transitionTarget.bug.id)}
        isCorrected={isCorrected} onChange={setTransitionForm}
        onClose={() => setTransitionTarget(null)} onConfirm={confirmTransition} />

      <Modal show={showStatusHelp} onHide={() => setShowStatusHelp(false)} centered size="lg">
        <Modal.Header closeButton>
            <Modal.Title className="fw-bold d-flex align-items-center gap-2">
            <Info size={20} /> {t('bugs.statusModalTitle')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="small text-muted mb-3">
            {t('bugs.statusModalDescription')}
          </div>
          <Row className="g-3">
            {bugStatusHelp.map((section) => (
              <Col md={section.group === 'activeGroup' ? 12 : 6} key={section.group}>
                <Card className="border shadow-none h-100">
                  <Card.Body>
                    <h6 className="fw-bold text-secondary mb-3">{t(`bugs.${section.group}`)}</h6>
                    <div className="d-flex flex-column gap-3">
                      {section.items.map(([status, description]) => {
                        const isClosed = closedStates.has(status)
                        const isRetest = ['LISTO_PARA_RETEST', 'EN_RETEST'].includes(status)
                        return (
                          <div key={status} className="d-flex gap-3 align-items-start">
                            <Badge
                              bg={isClosed ? 'secondary' : isRetest ? 'primary' : 'success'}
                              className="mt-1 text-wrap text-start flex-shrink-0"
                              style={{ width: 132, whiteSpace: 'normal', lineHeight: 1.2 }}
                            >
                              {status}
                            </Badge>
                            <div className="small text-muted flex-grow-1">{t(`bugs.${description}`)}</div>
                          </div>
                        )
                      })}
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            ))}
          </Row>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={() => setShowStatusHelp(false)}>{t('bugs.understood')}</Button>
        </Modal.Footer>
      </Modal>

      <Modal show={detailOpen} onHide={() => { setDetailOpen(false); onDetailClosed?.() }} size="xl" centered dialogClassName="bug-detail-modal">
        <Modal.Header closeButton>
          <Modal.Title className="w-100 pe-3">
            <div className="small text-muted">{selectedBug?.codigo}</div>
            {canEdit ? (
              <Form.Control
                size="sm"
                className="fw-bold fs-5 border-0 px-0 shadow-none"
                value={detailForm.titulo || ''}
                onChange={(e) => updateDetailField('titulo', e.target.value)}
              />
            ) : (
              <span>{selectedBug?.codigo} - {selectedBug?.titulo}</span>
            )}
          </Modal.Title>
        </Modal.Header>
        {selectedBug && (
          <Modal.Body style={{ maxHeight: 'calc(100vh - 170px)', overflowY: 'auto' }}>
            <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
              <div className="d-flex flex-wrap gap-2">
                <Badge bg={closedStates.has(selectedBug.estado) ? 'secondary' : 'success'}>{selectedBug.estado}</Badge>
                <Badge bg={severityVariant[selectedBug.severidad] || 'secondary'} text={selectedBug.severidad === 'COSMETICA' ? 'dark' : undefined}>
                  {getBugSeverityPresentation(selectedBug.severidad, '')?.shortLabel || selectedBug.severidad}
                </Badge>
                {(() => {
                  const priority = getBugPriorityPresentation(selectedBug.prioridad)
                  if (!priority) return null
                  return (
                    <Badge bg={priority.bg} text={priority.text} title={priority.title} className={priority.bg === 'light' ? 'border' : ''}>
                      {priority.label}
                    </Badge>
                  )
                })()}
                {selectedBug.criticidad && <Badge bg="light" text="dark" className="border">{getBugCriticalityPresentation(selectedBug.criticidad)?.label || `Crit. ${selectedBug.criticidad}`}</Badge>}
                {selectedBug.external_issue_id && <Badge bg="info">{selectedBug.external_provider}: {selectedBug.external_issue_id}</Badge>}
              </div>
            </div>
            <Row className="g-3">
              <Col lg={7}>
                <h6>{t('bugs.summaryDiagnostic')}</h6>
                <Form.Control
                  as="textarea"
                  rows={4}
                  className="small mb-2"
                  value={detailForm.descripcion || ''}
                  disabled={!canEdit}
                  onChange={(e) => updateDetailField('descripcion', e.target.value)}
                />
                <Row className="g-2 mb-2">
                  <Col md={6}>
                    <h6>{t('bugs.expectedResult')}</h6>
                    <Form.Control as="textarea" rows={3} className="small" value={detailForm.resultado_esperado || ''} disabled={!canEdit} onChange={(e) => updateDetailField('resultado_esperado', e.target.value)} />
                  </Col>
                  <Col md={6}>
                    <h6>{t('bugs.actualResult')}</h6>
                    <Form.Control as="textarea" rows={3} className="small" value={detailForm.resultado_obtenido || ''} disabled={!canEdit} onChange={(e) => updateDetailField('resultado_obtenido', e.target.value)} />
                  </Col>
                </Row>
                <h6>{t('bugs.reproductionSteps')}</h6>
                <Form.Control as="textarea" rows={8} className="small font-monospace mb-2" value={detailForm.pasos_reproduccion || ''} disabled={!canEdit} onChange={(e) => updateDetailField('pasos_reproduccion', e.target.value)} />
                <h6>{t('bugs.preconditions')}</h6>
                <Form.Control as="textarea" rows={3} className="small mb-2" value={detailForm.precondiciones || ''} disabled={!canEdit} onChange={(e) => updateDetailField('precondiciones', e.target.value)} />
                <Row className="g-2 mb-2">
                  <Col md={6}>
                    <h6>{t('bugs.qaNotes')}</h6>
                    <Form.Control as="textarea" rows={4} className="small" value={detailForm.notas_qa || ''} disabled={!canEdit} onChange={(e) => updateDetailField('notas_qa', e.target.value)} />
                  </Col>
                  <Col md={6}>
                    <h6>{t('bugs.logsError')}</h6>
                    <Form.Control as="textarea" rows={4} className="small font-monospace" value={detailForm.logs_relevantes || detailForm.error_tecnico || ''} disabled={!canEdit} onChange={(e) => {
                      updateDetailField('logs_relevantes', e.target.value)
                      updateDetailField('error_tecnico', e.target.value)
                    }} />
                  </Col>
                </Row>
                <h6>{t('bugs.comments')}</h6>
                {(selectedBug.comments || []).map((item: any) => {
                  const attachments = (item.attachments || []).map((link: any) => link.attachment).filter(Boolean)
                  return (
                    <div key={item.id} className="border rounded p-2 mb-2 small bg-white">
                      <div className="white-space-pre-wrap">{item.comentario}</div>
                      {attachments.length > 0 && (
                        <div className="d-flex flex-wrap gap-2 mt-2 pt-2 border-top">
                          {attachments.map((attachment: AttachmentMeta) => (
                            <Button
                              key={attachment.id}
                              variant={isEvidenceAvailable(attachment) ? 'light' : 'outline-warning'}
                              size="sm"
                              className="border d-flex align-items-center gap-1 x-small"
                              onClick={() => openEvidenceViewer(attachment)}
                            >
                              <Clipboard size={12} /> {attachment.filename_original || 'Evidencia'}
                              {!isEvidenceAvailable(attachment) && <Badge bg="warning" text="dark">{t('bugs.attachmentUnavailable')}</Badge>}
                            </Button>
                          ))}
                        </div>
                      )}
                      <div className="text-muted x-small mt-1">{item.created_at}</div>
                    </div>
                  )
                })}
                {canComment && (
                  <div className="border rounded p-2 bg-light">
                    <Form.Control
                      size="sm"
                      as="textarea"
                      rows={2}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder={t('bugs.addCommentPlaceholder')}
                    />
                    {commentAttachments.length > 0 && (
                      <div className="d-flex flex-wrap gap-2 my-2">
                        {commentAttachments.map((attachment) => (
                          <span key={attachment.id} className="badge text-bg-light border d-inline-flex align-items-center gap-1">
                            {attachment.filename_original || t('bugs.evidence')}
                            <button
                              type="button"
                              className="btn btn-link btn-sm p-0 text-danger"
                              onClick={() => setCommentAttachments(prev => prev.filter(item => item.id !== attachment.id))}
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
                      {canAttachBugEvidence && (
                        <EvidenceUpload
                          compact
                          label={t('bugs.attachToComment')}
                          uploadScope="BUG_COMMENT_EVIDENCE"
                          currentAttachments={commentAttachments}
                          onUploadComplete={(attachment) => setCommentAttachments(prev => prev.some(item => item.id === attachment.id) ? prev : [...prev, attachment])}
                          onRemoveAttachment={(attachment) => setCommentAttachments(prev => prev.filter(item => item.id !== attachment.id))}
                        />
                      )}
                      <Button size="sm" onClick={addComment} disabled={!comment.trim() && commentAttachments.length === 0}>
                        <MessageSquare size={14} className="me-1" /> {t('bugs.comment')}
                      </Button>
                    </div>
                  </div>
                )}
              </Col>
              <Col lg={5}>
                <h6>{t('bugs.classificationAssignment')}</h6>
                <Row className="g-2 mb-2">
                  <Col md={4}>
                    <Form.Label className="x-small text-muted fw-bold">{t('bugs.statusCol')}</Form.Label>
                    {canTriage ? (
                      <Form.Select size="sm" value={selectedBug.estado} onChange={(e) => transitionBug(e.target.value)}>
                        {statusOptions.map(item => <option key={item}>{item}</option>)}
                      </Form.Select>
                    ) : (
                      <Form.Control size="sm" value={selectedBug.estado || 'N/D'} readOnly />
                    )}
                  </Col>
                  <Col md={4}>
                    <Form.Label className="x-small text-muted fw-bold">{t('bugs.severity')}</Form.Label>
                    <Form.Select size="sm" value={detailForm.severidad || 'MEDIA'} disabled={!canEdit} onChange={(e) => updateDetailField('severidad', e.target.value)}>
                      {severityOptions.map(item => <option key={item}>{item}</option>)}
                    </Form.Select>
                  </Col>
                  <Col md={4}>
                    <Form.Label className="x-small text-muted fw-bold">{t('bugs.priority')}</Form.Label>
                    <Form.Select size="sm" value={detailForm.prioridad || 'P2'} disabled={!canEdit} onChange={(e) => updateDetailField('prioridad', e.target.value)}>
                      {priorityOptions.map(item => <option key={item} value={item}>{formatBugPriorityOption(item)}</option>)}
                    </Form.Select>
                  </Col>
                  <Col md={6}>
                    <Form.Label className="x-small text-muted fw-bold">{t('bugs.criticality')}</Form.Label>
                    <Form.Select size="sm" value={detailForm.criticidad || 'MEDIA'} disabled={!canEdit} onChange={(e) => updateDetailField('criticidad', e.target.value)}>
                      {['CRITICA','ALTA','MEDIA','BAJA'].map(item => <option key={item}>{item}</option>)}
                    </Form.Select>
                  </Col>
                  <Col md={12}>
                    <Form.Label className="x-small text-muted fw-bold">{t('bugs.assignedTo')}</Form.Label>
                    <Form.Select size="sm" value={detailForm.asignado_a || ''} disabled={!canEdit} onChange={(e) => updateDetailField('asignado_a', e.target.value || '')}>
                      <option value="">{t('bugs.unassignedLabel')}</option>
                      {appUsers.map((item: any) => <option value={item.id} key={item.id}>{item.name || item.nombre_completo || item.email}</option>)}
                    </Form.Select>
                  </Col>
                </Row>

                <h6>{t('bugs.qaContext')}</h6>
                {selectedBug.metadata_json && (
                  <div className="border rounded p-2 mb-2 bg-light small">
                    <div className="fw-semibold text-dark mb-1">{bugTraceLabel(selectedBug, t)}</div>
                    {currentBuildLabel && <div><strong>{t('bugs.pairBuild')}:</strong> {currentBuildLabel}</div>}
                    <div><strong>{t('bugs.originBuild')}:</strong> {bugBuildOriginLabel(selectedBug)}</div>
                    <div><strong>{t('bugs.followups')}:</strong> {bugOccurrenceBuilds(selectedBug).join(', ') || t('bugs.noOccurrences')}</div>
                    <div><strong>{t('bugs.currentComponent')}:</strong> {currentComponentLabel || bugComponentLabel(selectedBug)}</div>
                    <div><strong>{t('common.environment')}:</strong> {selectedBug.metadata_json.environment_name || selectedBug.ambiente_nombre || t('bugs.noDataset')}</div>
                    <div><strong>{t('common.dataset')}:</strong> {selectedBug.metadata_json.dataset_name || t('bugs.noDataset')}</div>
                    {selectedBug.metadata_json.environment_url && <div><strong>URL:</strong> {selectedBug.metadata_json.environment_url}</div>}
                  </div>
                )}
                <Table size="sm" bordered><tbody>{[
                  [t('bugs.pairBuild'), currentBuildLabel || t('bugs.noDataset')], [t('bugs.originBuild'), bugBuildOriginLabel(selectedBug)],
                  [t('bugs.followups'), bugOccurrenceBuilds(selectedBug).join(', ') || t('bugs.noOccurrences')], [t('bugs.currentComponent'), currentComponentLabel || t('bugs.noDataset')],
                  [t('bugs.originComponent'), bugComponentLabel(selectedBug)], [t('common.dataset'), selectedBug.metadata_json?.dataset_name || selectedBug.dataset_id],
                  [t('common.case'), selectedBug.case_code || selectedBug.caso_id], ['TestRun', selectedBug.test_run_id], [t('common.execution'), selectedBug.ejecucion_id],
                  ['Snapshot', selectedBug.snapshot_id], [t('common.step'), selectedBug.numero_paso], [t('common.mode'), selectedBug.execution_mode],
                  [t('common.environment'), selectedBug.metadata_json?.environment_name || selectedBug.ambiente_nombre],
                ].map(([k, v]) => <tr key={k}><td className="fw-bold small">{k}</td><td className="small text-break">{v || 'N/D'}</td></tr>)}</tbody></Table>
                <h6>{t('bugs.technicalData')}</h6>
                <Row className="g-2 mb-2">{[
                  ['url_afectada', 'affectedUrl', 12], ['navegador', 'browser', 6], ['sistema_operativo', 'os', 6], ['dispositivo', 'device', 6],
                  ['resolucion', 'qaResolution', 6], ['reproducibilidad', 'reproducibility', 6], ['frecuencia', 'frequency', 6],
                ].map(([field, label, md]) => <Col md={md as any} key={field as string}><Form.Control size="sm" placeholder={t(`bugs.${label}`)} value={detailForm[field as string] || ''} disabled={!canEdit} onChange={(e) => updateDetailField(field as string, e.target.value)} /></Col>)}
                  <Col md={12}><Form.Control as="textarea" rows={2} size="sm" placeholder={t('bugs.businessImpact')} value={detailForm.impacto_negocio || ''} disabled={!canEdit} onChange={(e) => updateDetailField('impacto_negocio', e.target.value)} /></Col>
                </Row>
                {selectedBug.metadata_json?.dataset_variables && Object.keys(selectedBug.metadata_json.dataset_variables).length > 0 && <><h6>{t('bugs.usedData')}</h6><pre className="small border rounded p-2 bg-light white-space-pre-wrap" style={{ maxHeight: 160, overflow: 'auto' }}>{JSON.stringify(selectedBug.metadata_json.dataset_variables, null, 2)}</pre></>}
                <div className="border rounded p-2 mb-3 bg-light">
                  <div className="d-flex justify-content-between align-items-center mb-2"><h6 className="mb-0">{t('bugs.additionalContext')}</h6>{canEdit && <Button size="sm" variant="outline-primary" onClick={() => setAdditionalContextRows(prev => [...prev, { key: '', value: '' }])}><Plus size={13} /></Button>}</div>
                  {additionalContextRows.length === 0 && <div className="small text-muted border rounded bg-white p-2 mb-2">{t('bugs.noAdditionalContext')}</div>}
                  {additionalContextRows.map((row, index) => <Row className="g-2 mb-2" key={`${index}-${row.key}`}><Col xs={5}><Form.Control size="sm" placeholder={t('bugs.componentDataPlaceholder')} value={row.key} disabled={!canEdit} onChange={(e) => updateAdditionalContextRow(index, 'key', e.target.value)} /></Col><Col xs={6}><Form.Control size="sm" placeholder={t('bugs.versionValuePlaceholder')} value={row.value} disabled={!canEdit} onChange={(e) => updateAdditionalContextRow(index, 'value', e.target.value)} /></Col><Col xs={1} className="d-grid">{canEdit && <Button size="sm" variant="outline-danger" onClick={() => setAdditionalContextRows(prev => prev.filter((_, rowIndex) => rowIndex !== index))}><X size={13} /></Button>}</Col></Row>)}
                </div>
                <h6>{t('bugs.externalLinks')}</h6>
                {(selectedBug.external_links || []).map((item: any) => <div key={item.id} className="small border rounded p-2 mb-2"><ExternalLink size={13} className="me-1" />{item.provider_id}: {item.external_issue_id}</div>)}
                {canLinkExternal && <Row className="g-2 mb-2">
                  <Col md={4}><Form.Select size="sm" value={externalForm.provider_id} onChange={(e) => setExternalForm({ ...externalForm, provider_id: e.target.value })}>{EXTERNAL_ISSUE_PROVIDERS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Form.Select></Col>
                  <Col md={4}><Form.Control size="sm" placeholder={t('bugs.externalId')} value={externalForm.external_issue_id} onChange={(e) => setExternalForm({ ...externalForm, external_issue_id: e.target.value })} /></Col>
                  <Col md={4}><Button size="sm" variant="outline-primary" title={t('bugs.externalTicketButtonTitle')} aria-label={t('bugs.externalTicketButtonTitle')} onClick={createExternalLink}><LinkIcon size={14} className="me-1" />{t('bugs.linkExternalTicket')}</Button></Col>
                </Row>}
                {canExport && <div className="d-flex align-items-center gap-2 mb-2"><Button size="sm" variant="outline-dark" onClick={generatePreview}>{t('bugs.generatePreview')}</Button><Button size="sm" variant="outline-secondary" title={t('bugs.copyMarkdownTitle')} aria-label={t('bugs.copyMarkdownTitle')} onClick={copyMarkdown}><Clipboard size={14} /></Button><OverlayTrigger trigger={['hover', 'focus', 'click']} placement="right" overlay={<Tooltip>{t('bugs.previewInfo')}</Tooltip>}><Button size="sm" variant="link" className="p-0 text-primary" aria-label={t('bugs.previewInfoAria')}><Info size={15} /></Button></OverlayTrigger></div>}
                {markdown && <Form.Control as="textarea" rows={8} value={markdown} readOnly className="small font-monospace" />}
                <h6 className="mt-3">{t('bugs.evidence')}</h6>
                {canUse('bugs.adjuntos', 'edit') ? <EvidenceUpload compact label={t('bugs.attachEvidence')} uploadScope="BUG_EVIDENCE" currentAttachments={bugGeneralAttachments} onUploadComplete={addBugEvidence} onRemoveAttachment={removeBugEvidence} /> : <div className="small text-muted">{t('bugs.permissionAttachEvidence')}</div>}
              </Col>
            </Row>
          </Modal.Body>
        )}
        <Modal.Footer className="d-flex justify-content-between">
          <Button variant="secondary" onClick={() => { setDetailOpen(false); onDetailClosed?.() }}>{t('bugs.close')}</Button>
          {canEdit && selectedBug && (
            <Button variant="success" className="fw-bold" onClick={saveSelectedBugDetails} disabled={savingDetail}>
              <Save size={14} className="me-1" /> {savingDetail ? t('bugs.saving') : t('bugs.saveChanges')}
            </Button>
          )}
        </Modal.Footer>
      </Modal>
      <EvidenceViewerModal evidence={viewerEvidence} onHide={() => setViewerEvidence(null)} />
    </div>
  )
}
