import { Badge, Button, Card, Col, Form, Modal, Nav, OverlayTrigger, Row, Spinner, Table, Tooltip } from 'react-bootstrap'
import { useEffect, useRef, useState } from 'react'
import { Bug, Clipboard, ExternalLink, FileText, Info, Link as LinkIcon, MessageSquare, PlayCircle, Plus, RefreshCw, Save, X } from 'lucide-react'
import { EvidenceUpload, type AttachmentMeta } from '../../EvidenceUpload'
import { EvidenceViewerModal } from '../../shared/components/EvidenceViewerModal'
import { isEvidenceAvailable } from '../../shared/utils/evidenceAvailability'
import { isImageAsset, resolveAssetUrl } from '../../shared/utils/assets'
import { formatDateTime } from '../../shared/utils/dateTime'
import { BugTransitionModal } from './BugTransitionModal'
import {
  EXTERNAL_ISSUE_PROVIDERS, bugBuildOriginLabel, bugComponentLabel, bugOccurrenceBuilds, bugStatusHelp,
  bugDisplayType, bugTraceLabel, closedStates, externalIssueLabel, priorityOptions, severityOptions, severityVariant, statusOptions,
} from './bugTrackerHelpers'
import { qaDatasetEntriesFromBug } from '../../app/qaDataset'
import { BugConversationalEvidence } from './BugConversationalEvidence'
import { BugApiEvidence } from './BugApiEvidence'
import { BugHistory } from './BugHistory'
import { BugDuplicateModal } from './BugDuplicateModal'
import { BugTrackerListView } from './BugTrackerListView'
import { bugPriorityStyle, createBugLocalizedLabels } from './bugPresentation'

type BugTrackerViewContext = {
  list: any,
  isDetailDirty: boolean,
  resetDetailDraft: () => void,
  fetchWithAuth: any,
  canMarkDuplicate: boolean,
  t: any,
  canUse: any,
  canCreate: any,
  canEdit: any,
  canTriage: any,
  canAssign: any,
  canTake: any,
  canResolve: any,
  canClose: any,
  canTransitionTo: (status: string, bug?: any) => boolean,
  canComment: any,
  canAttachBugEvidence: any,
  canLinkExternal: any,
  canExport: any,
  currentBuildLabel: any,
  currentComponentLabel: any,
  buildsList: any[],
  appUsers: any,
  bugs: any,
  summary: any,
  loading: any,
  selectedBug: any,
  conversationalContext: any,
  conversationalContextLoading: boolean,
  apiContext: any,
  apiContextLoading: boolean,
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
  setViewerEvidence: any,
  setExternalForm: any,
  setFilters: any,
  takeBug: (bug: any) => void,
  onOpenRelatedCase?: (bug: any) => void,
  onOpenRelatedExecution?: (bug: any) => void,
}
export function BugTrackerView({ context }: { context: BugTrackerViewContext }) {
  const { t, canUse, canCreate, canEdit, canTriage, canAssign, canTake, canResolve, canClose, canTransitionTo, canComment, canAttachBugEvidence, canLinkExternal, canExport, currentBuildLabel, currentComponentLabel, buildsList, appUsers, bugs, summary, loading, selectedBug, conversationalContext, conversationalContextLoading, apiContext, apiContextLoading, detailOpen, filters, comment, commentAttachments, externalForm, markdown, detailForm, additionalContextRows, viewerEvidence, savingDetail, showStatusHelp, loadBugs, onOpenManualBugDrawer, openDetail, transitionTarget, transitionForm, compatibleBuilds, quickTransitioningBugId, isCorrected, setTransitionForm, setTransitionTarget, confirmTransition, setShowStatusHelp, setDetailOpen, onDetailClosed, updateDetailField, openEvidenceViewer, setComment, setCommentAttachments, addComment, createExternalLink, generatePreview, copyMarkdown, bugGeneralAttachments, addBugEvidence, removeBugEvidence, saveSelectedBugDetails, setAdditionalContextRows, updateAdditionalContextRow, transitionBug, transitionBugInline, takeBug, modalOnly, setViewerEvidence, setExternalForm, setFilters, onOpenRelatedCase, onOpenRelatedExecution } = context
  const { status: statusLabel, severity: severityLabel, priority: priorityLabel } = createBugLocalizedLabels(t)
  const selectedBugType = bugDisplayType(selectedBug, Boolean(apiContext))
  const isConversationalBug = selectedBugType === 'CONVERSACIONAL'
  const isApiBug = selectedBugType === 'API'
  const qaDatasetEntries = qaDatasetEntriesFromBug(selectedBug)
  const [detailTab, setDetailTab] = useState<'summary' | 'context' | 'conversation' | 'api' | 'history'>('summary')
  const [detailEditing, setDetailEditing] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [duplicateBug, setDuplicateBug] = useState<any>(null)
  const detailBodyRef = useRef<HTMLDivElement>(null)
  const detailScroll = useRef(0)
  const detailVisible = detailOpen && !pendingAction && !duplicateBug && !transitionTarget && !viewerEvidence
  useEffect(() => {
    if (detailVisible && detailBodyRef.current) detailBodyRef.current.scrollTop = detailScroll.current
  }, [detailVisible])
  const guardAction = (action: () => void, includeComment = true) => {
    if (context.isDetailDirty || (includeComment && (comment.trim() || commentAttachments.length))) setPendingAction(() => action)
    else action()
  }
  useEffect(() => { setDetailEditing(false); setDetailTab('summary'); detailScroll.current = 0 }, [selectedBug?.id])
  useEffect(() => {
    if (detailOpen && isConversationalBug && conversationalContext) setDetailTab('conversation')
    if (detailOpen && isApiBug && apiContext) setDetailTab('api')
  }, [detailOpen, isConversationalBug, conversationalContext, isApiBug, apiContext])
  const closeDetail = () => {
    if (savingDetail) return
    guardAction(() => {
      setDetailEditing(false); setDetailTab('summary'); setDetailOpen(false); onDetailClosed?.()
    })
  }
  const cancelDetailEditing = () => {
    guardAction(() => { setDetailEditing(false); context.resetDetailDraft() }, false)
  }
  const saveDetail = async () => {
    const saved = await saveSelectedBugDetails()
    if (saved !== false) setDetailEditing(false)
  }
  const contextValue = (value: unknown, fallback = t('bugs.noDataset')) => {
    const text = String(value ?? '').trim()
    return text || fallback
  }
  return (
    <>
    <BugTrackerListView context={context} />

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
                              {statusLabel(status)}
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

      <Modal animation={false} show={detailVisible} onHide={closeDetail} size="xl" centered dialogClassName="bug-detail-modal" scrollable>
        <Modal.Header closeButton>
          <Modal.Title className="w-100 pe-3 text-break">
            <div className="small text-muted">{selectedBug?.codigo}</div>
            {detailEditing ? (
              <Form.Control
                size="sm"
                className="fw-bold fs-5 border-0 px-0 shadow-none"
                id="bug-detail-title"
                name="bugTitle"
                aria-label={t('bugs.titleLabel')}
                disabled={savingDetail}
                value={detailForm.titulo || ''}
                onChange={(e) => updateDetailField('titulo', e.target.value)}
              />
            ) : (
              <span>{selectedBug?.titulo}</span>
            )}
          </Modal.Title>
        </Modal.Header>
        {selectedBug && (
          <Modal.Body ref={detailBodyRef} onScroll={event => { detailScroll.current = event.currentTarget.scrollTop }} className="bug-detail-body"><fieldset disabled={savingDetail} className="border-0 p-0 m-0 w-100">
            <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
              <div className="d-flex flex-wrap gap-2">
                <Badge bg={closedStates.has(selectedBug.estado) ? 'secondary' : 'success'}>{statusLabel(selectedBug.estado)}</Badge>
                <Badge bg={severityVariant[selectedBug.severidad] || 'secondary'} text={selectedBug.severidad === 'COSMETICA' ? 'dark' : undefined}>
                  {severityLabel(selectedBug.severidad)}
                </Badge>
                {(() => {
                  const priority = selectedBug.prioridad ? { value: String(selectedBug.prioridad).toUpperCase(), ...bugPriorityStyle(String(selectedBug.prioridad).toUpperCase()) } : null
                  if (!priority) return null
                  return (
                    <Badge bg={priority.bg} text={priority.text} title={`${priority.value} · ${priorityLabel(priority.value)}`} className={priority.bg === 'light' ? 'border' : ''}>
                      {priorityLabel(priority.value)}
                    </Badge>
                  )
                })()}
                {selectedBug.criticidad && <Badge bg="light" text="dark" className="border">{t('bugs.criticality')}: {severityLabel(selectedBug.criticidad)}</Badge>}
                {selectedBugType === 'CONVERSACIONAL' ? <Badge bg="info" text="dark">{t('bugs.conversationalType')}</Badge> : selectedBugType === 'API' ? <Badge bg="success">API</Badge> : <Badge bg="light" text="dark" className="border">{t('bugs.classicType')}</Badge>}
                {selectedBug.external_issue_id && <Badge bg="info">{selectedBug.external_provider}: {selectedBug.external_issue_id}</Badge>}
              </div>
              <div className="d-flex flex-wrap justify-content-end gap-2">
                {selectedBug.caso_id && onOpenRelatedCase && (
                  <Button size="sm" variant="outline-secondary" onClick={() => guardAction(() => onOpenRelatedCase(selectedBug))}>
                    <FileText size={14} className="me-1" aria-hidden="true" />{t('bugs.viewCase')}
                  </Button>
                )}
                {(selectedBug.ejecucion_id || selectedBug.test_run_id) && onOpenRelatedExecution && (
                  <Button size="sm" variant="outline-primary" onClick={() => guardAction(() => onOpenRelatedExecution(selectedBug))}>
                    <PlayCircle size={14} className="me-1" aria-hidden="true" />{t('bugs.viewExecution')}
                  </Button>
                )}
                {context.canMarkDuplicate && selectedBug.estado !== 'DUPLICADO' && <Button size="sm" variant="outline-secondary" onClick={() => guardAction(() => setDuplicateBug(selectedBug))}>{t('bugs.markDuplicate')}</Button>}
                {canEdit && !detailEditing && <Button size="sm" variant="outline-primary" onClick={() => setDetailEditing(true)}>{t('bugs.editBug')}</Button>}
              </div>
            </div>
            <Nav role="tablist" variant="tabs" activeKey={detailTab} onSelect={(key) => key && setDetailTab(key as typeof detailTab)} className="bug-detail-tabs mb-3">
              <Nav.Item><Nav.Link eventKey="summary">{t('bugs.summaryTab')}</Nav.Link></Nav.Item>
              <Nav.Item><Nav.Link eventKey="context">{t('bugs.contextTab')}</Nav.Link></Nav.Item>
              {isConversationalBug && <Nav.Item><Nav.Link eventKey="conversation">{t('bugs.conversationContextTab')}</Nav.Link></Nav.Item>}
              {isApiBug && <Nav.Item><Nav.Link eventKey="api">{t('bugs.apiEvidence')}</Nav.Link></Nav.Item>}
            <Nav.Item><Nav.Link eventKey="history">{t('bugs.historyTab')}</Nav.Link></Nav.Item>
            </Nav>

            {detailTab === 'summary' && <>
              <Row className="g-3">
              <Col lg={8}>
                <h6>{t('bugs.summaryDiagnostic')}</h6>
                <Form.Control
                  as="textarea"
                  id="bug-detail-description"
                  name="bugDescription" aria-label={t('bugs.summaryDiagnostic')}
                  rows={4}
                  className="small mb-2"
                  value={detailForm.descripcion || ''}
                  readOnly={isConversationalBug || !detailEditing}
                  onChange={(e) => updateDetailField('descripcion', e.target.value)}
                />
                <Row className="g-2 mb-2">
                  <Col md={6}>
                    <h6>{t('bugs.expectedResult')}</h6>
                    <Form.Control id="bug-detail-expected" name="bugExpectedResult" aria-label={t('bugs.expectedResult')} as="textarea" rows={3} className="small" value={detailForm.resultado_esperado || ''} readOnly={isConversationalBug || !detailEditing} onChange={(e) => updateDetailField('resultado_esperado', e.target.value)} />
                  </Col>
                  <Col md={6}>
                    <h6>{t('bugs.actualResult')}</h6>
                    <Form.Control id="bug-detail-actual" name="bugActualResult" aria-label={t('bugs.actualResult')} as="textarea" rows={3} className="small" value={detailForm.resultado_obtenido || ''} readOnly={isConversationalBug || !detailEditing} onChange={(e) => updateDetailField('resultado_obtenido', e.target.value)} />
                  </Col>
                </Row>
                <h6>{t('bugs.reproductionSteps')}</h6>
                <Form.Control id="bug-detail-reproduction" name="bugReproductionSteps" aria-label={t('bugs.reproductionSteps')} as="textarea" rows={6} className="small font-monospace mb-2" value={detailForm.pasos_reproduccion || ''} readOnly={isConversationalBug || !detailEditing} onChange={(e) => updateDetailField('pasos_reproduccion', e.target.value)} />
                <h6>{t('bugs.preconditions')}</h6>
                <Form.Control id="bug-detail-preconditions" name="bugPreconditions" aria-label={t('bugs.preconditions')} as="textarea" rows={3} className="small mb-2" value={detailForm.precondiciones || ''} readOnly={isConversationalBug || !detailEditing} onChange={(e) => updateDetailField('precondiciones', e.target.value)} />
                <Row className="g-2 mb-2">
                  <Col md={6}><h6>{t('bugs.qaNotes')}</h6><Form.Control id="bug-detail-qa-notes" name="bugQaNotes" aria-label={t('bugs.qaNotes')} as="textarea" rows={3} className="small" value={detailForm.notas_qa || ''} readOnly={!detailEditing} onChange={(e) => updateDetailField('notas_qa', e.target.value)} /></Col>
                  <Col md={6}><h6>{t('bugs.logsError')}</h6><Form.Control id="bug-detail-logs" name="bugLogs" aria-label={t('bugs.logsError')} as="textarea" rows={3} className="small font-monospace" value={detailForm.logs_relevantes || detailForm.error_tecnico || ''} readOnly={isConversationalBug || !detailEditing} onChange={(e) => { updateDetailField('logs_relevantes', e.target.value); updateDetailField('error_tecnico', e.target.value) }} /></Col>
                </Row>
              </Col>
              <Col lg={4}>
                <h6>{t('bugs.classificationAssignment')}</h6>
                <Row className="g-2 mb-2">
                  <Col md={4}>
                    <Form.Label htmlFor="bug-detail-status" className="x-small text-muted fw-bold">{t('bugs.statusCol')}</Form.Label>
                    {statusOptions.some(item => item !== selectedBug.estado && canTransitionTo(item, selectedBug)) ? (
                      <Form.Select id="bug-detail-status" name="bugStatus" size="sm" disabled={Boolean(quickTransitioningBugId)} value={selectedBug.estado} onChange={(e) => transitionBug(e.target.value)}>
                        {statusOptions.filter(item => item === selectedBug.estado || canTransitionTo(item, selectedBug)).map(item => <option key={item} value={item}>{statusLabel(item)}</option>)}
                      </Form.Select>
                    ) : (
                      <Form.Control id="bug-detail-status" name="bugStatus" size="sm" value={selectedBug.estado ? statusLabel(selectedBug.estado) : t('common.notAvailable')} readOnly />
                    )}
                  </Col>
                  <Col md={4}>
                    <Form.Label htmlFor="bug-detail-severity" className="x-small text-muted fw-bold">{t('bugs.severity')}</Form.Label>
                    <Form.Select id="bug-detail-severity" name="bugSeverity" size="sm" value={detailForm.severidad || 'MEDIA'} disabled={!detailEditing} onChange={(e) => updateDetailField('severidad', e.target.value)}>
                      {severityOptions.map(item => <option key={item} value={item}>{severityLabel(item)}</option>)}
                    </Form.Select>
                  </Col>
                  <Col md={4}>
                    <Form.Label htmlFor="bug-detail-priority" className="x-small text-muted fw-bold">{t('bugs.priority')}</Form.Label>
                    <Form.Select id="bug-detail-priority" name="bugPriority" size="sm" value={detailForm.prioridad || 'P2'} disabled={!detailEditing} onChange={(e) => updateDetailField('prioridad', e.target.value)}>
                      {priorityOptions.map(item => <option key={item} value={item}>{item} · {priorityLabel(item)}</option>)}
                    </Form.Select>
                  </Col>
                  <Col md={6}>
                    <Form.Label htmlFor="bug-detail-criticality" className="x-small text-muted fw-bold">{t('bugs.criticality')}</Form.Label>
                    <Form.Select id="bug-detail-criticality" name="bugCriticality" size="sm" value={detailForm.criticidad || 'MEDIA'} disabled={!detailEditing} onChange={(e) => updateDetailField('criticidad', e.target.value)}>
                      {['CRITICA','ALTA','MEDIA','BAJA'].map(item => <option key={item} value={item}>{severityLabel(item)}</option>)}
                    </Form.Select>
                  </Col>
                  <Col md={12}>
                    <Form.Label htmlFor="bug-detail-assignee" className="x-small text-muted fw-bold">{t('bugs.assignedTo')}</Form.Label>
                    <Form.Select id="bug-detail-assignee" name="bugAssignee" size="sm" value={detailForm.asignado_a || ''} disabled={!detailEditing || !canAssign} onChange={(e) => updateDetailField('asignado_a', e.target.value || '')}>
                      <option value="">{t('bugs.unassignedLabel')}</option>
                      {appUsers.map((item: any) => <option value={item.id} key={item.id}>{item.name || item.nombre_completo || item.email}</option>)}
                    </Form.Select>
                  </Col>
                  {canTake && !selectedBug.asignado_a && <Col md={12}><Button size="sm" variant="outline-success" onClick={() => takeBug(selectedBug)}>{t('bugs.takeIncident')}</Button></Col>}
                </Row>

                <div className="border rounded p-3 bg-light small">
                  <div className="fw-semibold text-dark mb-2">{bugTraceLabel(selectedBug, t)}</div>
                  <div className="bug-context-grid">
                    <div><span>{t('bugs.originBuild')}</span><strong>{contextValue(bugBuildOriginLabel(selectedBug))}</strong></div>
                    <div><span>{t('bugs.currentComponent')}</span><strong>{contextValue(currentComponentLabel || bugComponentLabel(selectedBug))}</strong></div>
                    <div><span>{t('common.environment')}</span><strong>{contextValue(selectedBug.metadata_json?.environment_name || selectedBug.ambiente_nombre)}</strong></div>
                    <div><span>{t('common.dataset')}</span><strong>{contextValue(selectedBug.metadata_json?.dataset_name)}</strong></div>
                  </div>
                </div>
              </Col>
              </Row>

              <section className="bug-summary-activity mt-4" aria-labelledby="bug-summary-activity-title">
                <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
                  <div>
                    <h6 id="bug-summary-activity-title" className="mb-1">{t('bugs.activityEvidence')}</h6>
                    <div className="small text-muted">{t('bugs.activityEvidenceDescription')}</div>
                  </div>
                  <div className="d-flex flex-wrap gap-2 small text-muted">
                    <span>{(selectedBug.comments || []).length} {t('bugs.commentsCount')}</span>
                    <span>·</span>
                    <span>{bugGeneralAttachments.length} {t('bugs.evidenceCount')}</span>
                    <span>·</span>
                    <span>{(selectedBug.external_links || []).length} {t('bugs.linksCount')}</span>
                  </div>
                </div>
                <Row className="g-3">
                  <Col lg={7}>
                    <h6>{t('bugs.comments')}</h6>
                    {(selectedBug.comments || []).map((item: any) => {
                      const attachments = (item.attachments || []).map((link: any) => link.attachment).filter(Boolean)
                      const author = item.autor?.display_name || item.autor?.nombre_completo || t('bugs.systemAuthor')
                      const createdAt = formatDateTime(item.created_at) || t('bugs.noDate')
                      return <div key={item.id} className="border rounded p-2 mb-2 small bg-white"><div className="white-space-pre-wrap">{item.comentario}</div>{attachments.length > 0 && <div className="d-flex flex-wrap gap-2 mt-2 pt-2 border-top">{attachments.map((attachment: AttachmentMeta) => <Button key={attachment.id} variant={isEvidenceAvailable(attachment) ? 'light' : 'outline-warning'} size="sm" className="border d-flex align-items-center gap-1 x-small" onClick={() => openEvidenceViewer(attachment)}><Clipboard size={12} /> {attachment.filename_original || t('bugs.evidence')}{!isEvidenceAvailable(attachment) && <Badge bg="warning" text="dark">{t('bugs.attachmentUnavailable')}</Badge>}</Button>)}</div>}<div className="text-muted x-small mt-1">{author} · {createdAt}</div></div>
                    })}
                    {canComment && <div className="border rounded p-2 bg-light"><Form.Control id="bug-comment" name="bugComment" aria-label={t('bugs.addCommentPlaceholder')} size="sm" as="textarea" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('bugs.addCommentPlaceholder')} />{commentAttachments.length > 0 && <div className="d-flex flex-wrap gap-2 my-2">{commentAttachments.map((attachment) => <span key={attachment.id} className="badge text-bg-light border d-inline-flex align-items-center gap-1">{attachment.filename_original || t('bugs.evidence')}<button type="button" className="btn btn-link btn-sm p-0 text-danger" aria-label={t('bugs.remove')} onClick={() => setCommentAttachments(prev => prev.filter(item => item.id !== attachment.id))}><X size={12} /></button></span>)}</div>}<div className="d-flex flex-wrap align-items-center gap-2 mt-2">{canAttachBugEvidence && <EvidenceUpload compact label={t('bugs.attachToComment')} uploadScope="BUG_COMMENT_EVIDENCE" currentAttachments={commentAttachments} onUploadComplete={(attachment) => setCommentAttachments(prev => prev.some(item => item.id === attachment.id) ? prev : [...prev, attachment])} onRemoveAttachment={(attachment) => setCommentAttachments(prev => prev.filter(item => item.id !== attachment.id))} />}<Button size="sm" onClick={addComment} disabled={!comment.trim() && commentAttachments.length === 0}><MessageSquare size={14} className="me-1" /> {t('bugs.comment')}</Button></div></div>}
                  </Col>
                  <Col lg={5}>
                    <h6>{t('bugs.externalLinks')}</h6>
                    {(selectedBug.external_links || []).map((item: any) => <div key={item.id} className="small border rounded p-2 mb-2"><ExternalLink size={13} className="me-1" />{item.provider_id}: {item.external_issue_id}</div>)}
                    {canLinkExternal && <Row className="g-2 mb-2"><Col md={4}><Form.Select id="bug-external-provider" name="bugExternalProvider" aria-label={t('bugs.externalLinks')} size="sm" value={externalForm.provider_id} onChange={(e) => setExternalForm({ ...externalForm, provider_id: e.target.value })}>{EXTERNAL_ISSUE_PROVIDERS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Form.Select></Col><Col md={4}><Form.Control id="bug-external-id" name="bugExternalId" aria-label={t('bugs.externalId')} size="sm" placeholder={t('bugs.externalId')} value={externalForm.external_issue_id} onChange={(e) => setExternalForm({ ...externalForm, external_issue_id: e.target.value })} /></Col><Col md={4}><Button size="sm" variant="outline-primary" title={t('bugs.externalTicketButtonTitle')} aria-label={t('bugs.externalTicketButtonTitle')} onClick={createExternalLink}><LinkIcon size={14} className="me-1" />{t('bugs.linkExternalTicket')}</Button></Col></Row>}
                    {canExport && <div className="d-flex align-items-center gap-2 mb-2"><Button size="sm" variant="outline-dark" onClick={generatePreview}>{t('bugs.generatePreview')}</Button><Button size="sm" variant="outline-secondary" title={t('bugs.copyMarkdownTitle')} aria-label={t('bugs.copyMarkdownTitle')} onClick={copyMarkdown}><Clipboard size={14} /></Button><OverlayTrigger trigger={['hover', 'focus', 'click']} placement="right" overlay={<Tooltip>{t('bugs.previewInfo')}</Tooltip>}><Button size="sm" variant="link" className="p-0 text-primary" aria-label={t('bugs.previewInfoAria')}><Info size={15} /></Button></OverlayTrigger></div>}
                    {markdown && <Form.Control name="a11y-bugtrackerviewtsx-426" aria-label={t('common.formField')} as="textarea" rows={8} value={markdown} readOnly className="small font-monospace mb-3" />}
                    <h6>{t('bugs.evidence')}</h6>
                    {bugGeneralAttachments.length > 0 && <div className="d-flex flex-column gap-2 mb-2" aria-label={t('bugs.evidence')}>
                      {bugGeneralAttachments.map((attachment: AttachmentMeta) => (
                        <Button
                          key={attachment.id}
                          variant={isEvidenceAvailable(attachment) ? 'light' : 'outline-warning'}
                          size="sm"
                          className="border d-flex align-items-center gap-2 text-start p-2"
                          onClick={() => openEvidenceViewer(attachment)}
                          disabled={!isEvidenceAvailable(attachment)}
                        >
                          <span className="border rounded bg-white d-flex align-items-center justify-content-center flex-shrink-0" style={{ width: 64, height: 48, overflow: 'hidden' }}>
                            {isEvidenceAvailable(attachment) && isImageAsset(attachment) ? <img src={resolveAssetUrl(attachment.public_url)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <FileText size={18} className="text-secondary" />}
                          </span>
                          <span className="text-truncate flex-grow-1">{attachment.filename_original || t('bugs.evidence')}</span>
                          {!isEvidenceAvailable(attachment) && <Badge bg="warning" text="dark">{t('bugs.attachmentUnavailable')}</Badge>}
                        </Button>
                      ))}
                    </div>}
                    {canUse('bugs.adjuntos', 'edit') ? <EvidenceUpload compact label={t('bugs.attachEvidence')} uploadScope="BUG_EVIDENCE" currentAttachments={bugGeneralAttachments} onUploadComplete={addBugEvidence} onRemoveAttachment={removeBugEvidence} /> : <div className="small text-muted">{t('bugs.permissionAttachEvidence')}</div>}
                  </Col>
                </Row>
              </section>
            </>}

            {detailTab === 'context' && <div>
              <h6>{t('bugs.qaContext')}</h6>
              <div className="border rounded p-3 mb-3 bg-light small">
                <div className="bug-context-grid">
                  {[[t('bugs.pairBuild'), currentBuildLabel], [t('bugs.originBuild'), bugBuildOriginLabel(selectedBug)], [t('bugs.followups'), bugOccurrenceBuilds(selectedBug).join(', ') || t('bugs.noOccurrences')], [t('bugs.currentComponent'), currentComponentLabel || bugComponentLabel(selectedBug)], [t('bugs.originComponent'), bugComponentLabel(selectedBug)], [t('common.environment'), selectedBug.metadata_json?.environment_name || selectedBug.ambiente_nombre], [t('common.dataset'), selectedBug.metadata_json?.dataset_name], [t('common.case'), selectedBug.case_title || selectedBug.metadata_json?.case_title || selectedBug.case_code]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{contextValue(value)}</strong></div>)}
                </div>
              </div>
              <h6>{t('bugs.usedData')}</h6>
                {qaDatasetEntries.length > 0 ? (
                  <Table size="sm" bordered className="mb-3 bg-light">
                    <thead><tr><th>{t('bugs.dataKey')}</th><th>{t('bugs.dataValue')}</th></tr></thead>
                    <tbody>{qaDatasetEntries.map((entry) => <tr key={entry.key}><td className="fw-semibold text-break">{entry.key}</td><td className="text-break">{entry.value === null || entry.value === undefined || entry.value === '' ? t('common.notAvailable') : String(entry.value)}</td></tr>)}</tbody>
                  </Table>
                ) : <div className="small text-muted border rounded bg-light p-2 mb-3">{t('bugs.noQaData')}</div>}
              <div className="border rounded p-2 mb-3 bg-light">
                  <div className="d-flex justify-content-between align-items-center mb-2"><h6 className="mb-0">{t('bugs.additionalContext')}</h6>{detailEditing && <Button size="sm" variant="outline-primary" aria-label={t('bugs.add')} onClick={() => setAdditionalContextRows(prev => [...prev, { id: `context-${Date.now()}-${prev.length}`, key: '', value: '' }])}><Plus size={13} /></Button>}</div>
                  {additionalContextRows.length === 0 && <div className="small text-muted border rounded bg-white p-2 mb-2">{t('bugs.noAdditionalContext')}</div>}
                  {additionalContextRows.map((row, index) => <Row className="g-2 mb-2" key={row.id || `context-${index}`}><Col xs={5}><Form.Control id={`bug-context-key-${row.id || index}`} name={`bugContextKey-${row.id || index}`} aria-label={t('bugs.componentDataPlaceholder')} size="sm" placeholder={t('bugs.componentDataPlaceholder')} value={row.key} disabled={!detailEditing} onChange={(e) => updateAdditionalContextRow(index, 'key', e.target.value)} /></Col><Col xs={6}><Form.Control id={`bug-context-value-${row.id || index}`} name={`bugContextValue-${row.id || index}`} aria-label={t('bugs.versionValuePlaceholder')} size="sm" placeholder={t('bugs.versionValuePlaceholder')} value={row.value} disabled={!detailEditing} onChange={(e) => updateAdditionalContextRow(index, 'value', e.target.value)} /></Col><Col xs={1} className="d-grid">{detailEditing && <Button size="sm" variant="outline-danger" aria-label={t('bugs.remove')} onClick={() => setAdditionalContextRows(prev => prev.filter((_, rowIndex) => rowIndex !== index))}><X size={13} /></Button>}</Col></Row>)}
              </div>
              <details className="bug-technical-details">
                <summary>{t('bugs.technicalDetails')}</summary>
                <Table size="sm" bordered className="mt-2"><tbody>{[
                  [t('common.execution'), selectedBug.ejecucion_id], ['Snapshot', selectedBug.snapshot_id], [t('common.step'), selectedBug.numero_paso], [t('common.mode'), selectedBug.execution_mode], ['TestRun', selectedBug.test_run_id], [t('common.environment'), selectedBug.metadata_json?.environment_url || selectedBug.ambiente_url],
                ].map(([k, v]) => <tr key={String(k)}><td className="fw-semibold small">{k}</td><td className="small text-break">{contextValue(v)}</td></tr>)}</tbody></Table>
              </details>
              {detailEditing && <Row className="g-2 mt-3">{[
                ['url_afectada', 'affectedUrl', 12], ['navegador', 'browser', 6], ['sistema_operativo', 'os', 6], ['dispositivo', 'device', 6], ['resolucion_pantalla', 'qaResolution', 6], ['reproducibilidad', 'reproducibility', 6], ['frecuencia', 'frequency', 6],
              ].map(([field, label, md]) => <Col md={md as any} key={field as string}><Form.Control name={`bugDetail-${field}`} aria-label={t(`bugs.${label}`)} size="sm" placeholder={t(`bugs.${label}`)} value={detailForm[field as string] || ''} onChange={(e) => updateDetailField(field as string, e.target.value)} /></Col>)}<Col md={12}><Form.Control aria-label={t('bugs.businessImpact')} as="textarea" rows={2} size="sm" placeholder={t('bugs.businessImpact')} value={detailForm.impacto_negocio || ''} onChange={(e) => updateDetailField('impacto_negocio', e.target.value)} /></Col></Row>}
            </div>}

            {detailTab === 'history' && <BugHistory bug={selectedBug} users={appUsers} fetchWithAuth={context.fetchWithAuth} t={t} />}
            {selectedBug.duplicate_of_id && <Button size="sm" variant="link" onClick={() => guardAction(() => openDetail({ id: selectedBug.duplicate_of_id }))}>{t('bugs.viewOriginal')}</Button>}
            {detailTab === 'conversation' && <BugConversationalEvidence t={t} context={conversationalContext} selectedBug={selectedBug} loading={conversationalContextLoading} />}
            {detailTab === 'api' && <BugApiEvidence context={apiContext} loading={apiContextLoading} />}

          </fieldset></Modal.Body>
        )}
        <Modal.Footer className="d-flex justify-content-between">
          <Button variant="secondary" onClick={closeDetail}>{t('bugs.close')}</Button>
          {detailEditing && selectedBug && <div className="d-flex gap-2"><Button variant="outline-secondary" onClick={cancelDetailEditing} disabled={savingDetail}>{t('bugs.cancel')}</Button><Button variant="success" className="fw-bold" onClick={saveDetail} disabled={savingDetail}><Save size={14} className="me-1" /> {savingDetail ? t('bugs.saving') : t('bugs.saveChanges')}</Button></div>}
        </Modal.Footer>
      </Modal>
      <Modal animation={false} show={Boolean(pendingAction)} onHide={() => setPendingAction(null)} centered>
        <Modal.Header closeButton><Modal.Title>{t('bugs.unsavedTitle')}</Modal.Title></Modal.Header>
        <Modal.Body>{t('bugs.unsavedMessage')}</Modal.Body>
        <Modal.Footer><Button variant="secondary" onClick={() => setPendingAction(null)}>{t('bugs.keepEditing')}</Button><Button variant="danger" onClick={() => { const action = pendingAction; setPendingAction(null); context.resetDetailDraft(); setComment(''); setCommentAttachments([]); action?.() }}>{t('bugs.discardChanges')}</Button></Modal.Footer>
      </Modal>
      <BugDuplicateModal bug={duplicateBug} fetchWithAuth={context.fetchWithAuth} onClose={() => setDuplicateBug(null)} onSaved={async (updated: any) => { setDuplicateBug(null); setDetailEditing(false); await openDetail(updated); await context.list.loadBugs({ silent: true }) }} />
      <EvidenceViewerModal evidence={viewerEvidence} onHide={() => setViewerEvidence(null)} />
    </>
  )
}
