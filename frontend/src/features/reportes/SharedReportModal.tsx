import { Badge, Button, Col, Form, Modal, Row } from 'react-bootstrap'
import { Copy, Download, Share2, ShieldCheck } from 'lucide-react'
import { RequiredLabel } from '../../shared/ui/RequiredLabel'

type SharedReportType = { type: string; title: string; badge: string; description: string }

type SharedReportModalProps = {
  show: boolean
  sharedReport: any
  sharing: boolean
  buildDefinition: string
  setBuildDefinition: (value: string) => void
  qaComment: string
  setQaComment: (value: string) => void
  qaStatus: any
  hasOutdatedSharedReport: boolean
  buildDefinitionRequiresComment: boolean
  canShare: boolean
  canExport: boolean
  sharedReportTypes: SharedReportType[]
  t: (key: string) => string
  shareableReportUrl: (url: string, type: string) => string
  sharedReportPreview: (report: any, type: string, t: (key: string) => string) => any
  openSharedReport: (url?: string, label?: string) => void
  copyLink: (link?: string, label?: string) => void
  exportSharedReportPdf: (url: string, type: string, label: string) => void
  downloadSharedMarkdown: (report: any, type: string, label: string) => void
  onClose: () => void
  onShare: () => void
  onExportPdf: () => void
  onExportExcel: () => void
}

export function SharedReportModal({
  show, sharedReport, sharing, buildDefinition, setBuildDefinition, qaComment, setQaComment,
  qaStatus, hasOutdatedSharedReport, buildDefinitionRequiresComment, canShare, canExport,
  sharedReportTypes, t, shareableReportUrl, sharedReportPreview, openSharedReport, copyLink,
  exportSharedReportPdf, downloadSharedMarkdown, onClose, onShare, onExportPdf, onExportExcel,
}: SharedReportModalProps) {
  return (
    <Modal show={show} onHide={onClose} centered size="lg" scrollable>
      <Modal.Header closeButton className="border-0 pb-2"><Modal.Title className="fw-bold d-flex align-items-center gap-2"><Share2 size={20} />{sharedReport ? t('reportes.reusedLinks') : t('reportes.sharedReportTitle')}</Modal.Title></Modal.Header>
      <Modal.Body className="pt-0">
        {!sharedReport ? (
          <>
            <div className="border rounded-3 bg-light p-3 mb-3"><h6 className="fw-bold text-dark mb-2">{t('reportes.defineShareReport')}</h6><p className="small text-muted mb-2">{t('reportes.shareFreezeDescription')}</p><p className="small text-muted mb-0">{t('reportes.shareReuseDescription')}</p></div>
            <div className="border rounded-3 bg-primary bg-opacity-10 p-3 mb-3 small text-primary-emphasis">{t('reportes.reportSettingsFutureSnapshot')}</div>
            {hasOutdatedSharedReport && <div className="border rounded-3 bg-info bg-opacity-10 p-3 mb-3 small text-info-emphasis fw-bold">{t('reportes.newDataSnapshotNotice')}</div>}
            <Row className="g-3 mb-3"><Col md={12}><Form.Label className="small fw-bold">{t('reportes.qaDecision')}</Form.Label><Form.Select name="a11y-sharedreportmodaltsx-49" aria-label={t('reportes.qaDecision')} value={buildDefinition} onChange={(event) => setBuildDefinition(event.target.value)}><option value="">{t('reportes.selectDecisionDefinition')}</option><option value="APROBADA">{t('reportes.decisionApproved')}</option><option value="APROBADA_CON_OBSERVACIONES">{t('reportes.decisionApprovedNotes')}</option><option value="RECHAZADA">{t('reportes.decisionRejected')}</option><option value="BLOQUEADA">{t('reportes.decisionBlocked')}</option><option value="PENDIENTE_DE_VALIDACION">{t('reportes.decisionPending')}</option><option value="EN_ANALISIS">{t('reportes.decisionAnalysis')}</option><option value="NO_APLICA">{t('reportes.decisionNotApplicable')}</option></Form.Select></Col><Col md={12}><Form.Label className="small fw-bold"><RequiredLabel required={buildDefinitionRequiresComment}>{t('reportes.qaComment')}</RequiredLabel></Form.Label><Form.Control name="a11y-sharedreportmodaltsx-49" aria-label={t('reportes.qaComment')} as="textarea" rows={3} value={qaComment} onChange={(event) => setQaComment(event.target.value)} placeholder={t('reportes.qaCommentPlaceholder')} /></Col></Row>
            <div className="border rounded-3 bg-light p-3 mb-3 small"><strong>{t('reportes.suggestedStatus')}:</strong> {qaStatus.label || t('common.notAvailable')}{Array.isArray(qaStatus.reasons) && qaStatus.reasons.length > 0 && <span className="text-muted"> · {qaStatus.reasons.join(' · ')}</span>}<div className="text-muted mt-1">{t('reportes.decisionAppliesToPackage')}</div></div>
            <div className="border rounded-3 bg-warning bg-opacity-10 p-3"><div className="d-flex align-items-start gap-2"><ShieldCheck size={22} className="text-warning flex-shrink-0 mt-1" /><div><h6 className="fw-bold text-dark mb-2">{t('reportes.confirmPublicSnapshot')}</h6><p className="small text-muted mb-2">{t('reportes.publicSnapshotFreezeNotice')}</p><p className="small text-muted mb-0">{t('reportes.chatbotSnapshotDataNotice')}</p></div></div></div>
          </>
        ) : (
          <>
            {sharedReport?.reusedFromHistory ? <div className="border rounded-3 bg-success bg-opacity-10 p-3 mb-3 small text-success fw-bold">{t('reportes.reusedCurrentLinks')}</div> : sharedReport?.reused && <div className="border rounded-3 bg-success bg-opacity-10 p-3 mb-3 small text-success fw-bold">{t('reportes.reusedSnapshot')}</div>}
            <p className="small text-muted">{t('reportes.snapshotVersionNotice')}</p>
            <Row className="g-3">{sharedReportTypes.map(({ type, title, badge, description }) => { const link = sharedReport?.links?.[type]; if (!link) return null; const displayLink = shareableReportUrl(link, type); const preview = sharedReportPreview(sharedReport, type, t); return <Col md={12} key={type}><div className="border rounded-3 p-3 bg-white"><div className="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-2"><div><div className="d-flex align-items-center gap-2 mb-1"><h6 className="fw-bold mb-0 text-dark">{title}</h6><Badge bg={type === 'internal' ? 'secondary' : 'primary'}>{badge}</Badge></div><div className="small text-muted">{description}</div></div><div className="d-flex flex-wrap gap-2"><Button variant="primary" size="sm" onClick={() => openSharedReport(link, title)}>{t('reportes.open')}</Button><Button variant="outline-secondary" size="sm" onClick={() => copyLink(displayLink, title)}><Copy size={14} className="me-1" /> {t('reportes.copy')}</Button>{canExport && <><Button variant="outline-primary" size="sm" onClick={() => exportSharedReportPdf(link, type, title)}><Download size={14} className="me-1" /> PDF</Button><Button variant="outline-primary" size="sm" onClick={() => downloadSharedMarkdown(sharedReport, type, title)}><Download size={14} className="me-1" /> .md</Button></>}</div></div><Form.Control name="a11y-sharedreportmodaltsx-57" aria-label={t('reportes.shareableLink')} readOnly value={displayLink} className="font-monospace small" /><div className="mt-2 rounded-3 border bg-light px-3 py-2 small text-muted"><div className="fw-bold text-dark mb-1">{t('reportes.linkPreview')}</div><div className="d-flex flex-wrap gap-2"><Badge bg="light" text="dark" className="border">{preview.organization}</Badge><Badge bg="light" text="dark" className="border">{preview.project}</Badge><Badge bg="light" text="dark" className="border">{preview.component}</Badge><Badge bg="primary">{preview.build}</Badge><Badge bg={String(preview.qa).toUpperCase().includes('RECHAZ') ? 'danger' : 'success'}>{preview.qa}</Badge></div></div></div></Col> })}</Row>
            {sharedReport?.description && <div className="small text-muted mt-3">{sharedReport.description}</div>}
          </>
        )}
      </Modal.Body>
      <Modal.Footer className="border-0 pt-0"><Button variant="outline-secondary" onClick={onClose}>{t('reportes.close')}</Button>{!sharedReport ? <Button variant="warning" className="fw-bold" onClick={onShare} disabled={sharing || !canShare || !buildDefinition || (buildDefinitionRequiresComment && !qaComment.trim())}>{sharing ? t('reportes.creatingPackage') : t('reportes.createPackage')}</Button> : <>{canExport && <Button variant="outline-primary" onClick={onExportPdf}><Download size={16} className="me-1" /> {t('reportes.pdfCurrentView')}</Button>}{canExport && <Button variant="outline-success" onClick={onExportExcel}><Download size={16} className="me-1" /> {t('reportes.xlsCurrentView')}</Button>}</>}</Modal.Footer>
    </Modal>
  )
}
