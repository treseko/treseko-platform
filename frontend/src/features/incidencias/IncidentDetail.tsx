import { useRef, useState } from 'react'
import { Alert, Badge, Button, Col, Modal, Nav, Row } from 'react-bootstrap'
import { Download, ExternalLink } from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { BugApiEvidence } from '../bugs/BugApiEvidence'
import { BugConversationalEvidence } from '../bugs/BugConversationalEvidence'
import { BugDuplicateModal } from '../bugs/BugDuplicateModal'
import { EvidenceViewerModal, type EvidenceViewerItem } from '../../shared/components/EvidenceViewerModal'
import { INCIDENT_PRIORITY_KEYS, INCIDENT_SEVERITY_KEYS, INCIDENT_STATUS_KEYS, incidentBuildLabel,
  incidentCaseLabel, incidentComponentLabel, incidentErrorMessage } from './incidentCenterHelpers'
import { IncidentActions } from './IncidentActions'
import { IncidentEvidence } from './IncidentEvidence'
import { useIncidentDraft } from './useIncidentDraft'

export function IncidentDetail({ incident, detail, t, onClose, onOpenCase, onOpenExecution, canExport, onUpdated, ...props }: any) {
  const [tab, setTab] = useState('diagnosis')
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null)
  const [evidence, setEvidence] = useState<EvidenceViewerItem | null>(null)
  const [duplicate, setDuplicate] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exporting, setExporting] = useState(false)
  const draft = useIncidentDraft(incident)
  const scrollRef = useRef(0)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const requestLeave = (action: () => void) => {
    if (props.actionLoading) return
    if (draft.dirty) setPendingLeave(() => action)
    else action()
  }
  const download = async () => {
    setExporting(true); setExportError('')
    try {
      const response = await props.fetchWithAuth(`${API_BASE}/bugs/${incident.id}/export-markdown/`)
      if (!response.ok) throw new Error(await incidentErrorMessage(response, t('incidencias.exportError')))
      const href = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = href; anchor.download = `${incident.codigo || 'bug'}.md`
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(href)
    } catch (cause: any) { setExportError(cause.message || t('incidencias.exportError')) }
    finally { setExporting(false) }
  }
  const metadata = incident.metadata_json || {}
  const contextType = String(incident.tipo_contexto || metadata.format || '').toUpperCase()
  const block = (key: string, value: any) => <div className="incident-developer-block" key={key}>
    <div className="small text-muted fw-semibold">{t(`incidencias.${key}`)}</div>
    <div className="text-break incident-pre-wrap">{value === undefined || value === null || value === '' ? '—' : String(value)}</div>
  </div>
  const context = [
    ['version', incident.version_app || incident.build_name], ['environment', incident.ambiente_nombre || metadata.environment_name],
    ['build', incidentBuildLabel(incident)], ['case', incidentCaseLabel(incident)],
    ['component', incidentComponentLabel(incident)], ['dataset', metadata.dataset_name],
    ['executionMode', incident.execution_mode], ['executionType', contextType || incident.origen],
  ]
  const tabs = [['diagnosis', 'diagnosisTab'], ['reproduction', 'reproductionTab'], ['technical', 'technicalTab'], ['evidence', 'evidenceTab'], ['actions', 'actionsTab']]
  if (contextType === 'API') tabs.push(['structured-api', 'apiContextTab'])
  if (contextType === 'CONVERSACIONAL') tabs.push(['structured-conversation', 'conversationContextTab'])
  const childOpen = Boolean(pendingLeave || evidence || duplicate)
  return <>
    <Modal show={!childOpen} onHide={() => requestLeave(onClose)} animation={false} centered size="xl" fullscreen="lg-down" scrollable className="incident-detail-modal" aria-labelledby="incident-modal-title" onEntered={() => { if (bodyRef.current) bodyRef.current.scrollTop = scrollRef.current }}>
      <Modal.Header closeButton={!props.actionLoading}>
        <Modal.Title id="incident-modal-title" className="h5 text-break"><span className="small text-muted d-block" translate="no">{incident.codigo}</span>{incident.titulo}</Modal.Title>
        {canExport && <Button variant="outline-primary" size="sm" disabled={exporting} className="ms-auto" onClick={() => void download()}><Download size={14} className="me-1" />{t('incidencias.exportIncident')}</Button>}
      </Modal.Header>
      <Modal.Body ref={bodyRef} onScroll={event => { scrollRef.current = event.currentTarget.scrollTop }}>
        {exportError && <Alert variant="danger" role="alert">{exportError}</Alert>}
        {props.actionError && <Alert variant="danger" role="alert">{props.actionError}</Alert>}
        <div className="d-flex gap-2 flex-wrap mb-3">
          <Badge bg="secondary">{t(`incidencias.${INCIDENT_STATUS_KEYS[incident.estado] || 'statusUnknown'}`)}</Badge>
          <Badge bg="light" text="dark" className="border">{t(`incidencias.${INCIDENT_SEVERITY_KEYS[incident.severidad] || 'severityUnknown'}`)}</Badge>
          <Badge bg="light" text="dark" className="border">{t(`incidencias.${INCIDENT_PRIORITY_KEYS[incident.prioridad] || 'priorityUnknown'}`)}</Badge>
          {draft.dirty && <Badge bg="warning" text="dark">{t('bugs.unsavedTitle')}</Badge>}
        </div>
        <Nav variant="tabs" activeKey={tab} onSelect={key => key && setTab(key)} className="incident-developer-tabs mb-3" role="tablist">
          {tabs.map(([key, label]) => <Nav.Item key={key}><Nav.Link active={tab === key} eventKey={key} onClick={() => setTab(key)} role="tab" id={`incident-tab-${key}`} aria-controls={`incident-panel-${key}`} aria-selected={tab === key}>{t(`incidencias.${label}`)}</Nav.Link></Nav.Item>)}
        </Nav>
        <section role="tabpanel" id={`incident-panel-${tab}`} aria-labelledby={`incident-tab-${tab}`}>
          {tab === 'diagnosis' && <>
            <div className="d-grid gap-2 mb-3">{block('descriptionLabel', incident.descripcion || t('incidencias.noDescription'))}</div>
            <Row className="g-2 mb-3">{context.map(([key, value]) => <Col sm={6} lg={3} key={key}>{block(String(key), value)}</Col>)}</Row>
            <div className="d-grid gap-2">{block('expectedResult', incident.resultado_esperado)}{block('actualResult', incident.resultado_obtenido || incident.comportamiento_actual)}{block('businessImpact', incident.impacto_negocio)}{block('solutionNotes', incident.resolucion)}{block('qaNotes', incident.notas_qa)}</div>
          </>}
          {tab === 'reproduction' && <div className="d-grid gap-2">
            {block('testData', incident.datos_prueba)}{block('preconditions', incident.precondiciones)}{block('reproductionSteps', incident.pasos_reproduccion)}
            <Row className="g-2">{[
              ['affectedUrl', incident.url_afectada || incident.ambiente_url || metadata.environment_url], ['browser', incident.navegador],
              ['operatingSystem', incident.sistema_operativo], ['device', incident.dispositivo], ['resolution', incident.resolucion_pantalla],
              ['reproducibility', incident.reproducibilidad], ['frequency', incident.frecuencia], ['module', incident.modulo_funcional],
              ['blocksRelease', t(incident.bloquea_release ? 'incidencias.yes' : 'incidencias.no')],
              ['blocksCase', t(incident.bloquea_caso ? 'incidencias.yes' : 'incidencias.no')],
            ].map(([key, value]) => <Col sm={6} lg={3} key={key}>{block(String(key), value)}</Col>)}</Row>
          </div>}
          {tab === 'technical' && <div className="d-grid gap-2">{block('technicalError', incident.error_tecnico)}{block('logs', incident.logs_relevantes)}{block('stackTrace', incident.stack_trace)}{block('sourceBug', incident.origen)}</div>}
          {tab === 'evidence' && <IncidentEvidence incident={incident} detail={detail} {...props} t={t} onEvidence={setEvidence} />}
          {tab === 'actions' && <IncidentActions incident={incident} draft={draft} {...props} t={t} builds={detail?.availableBuilds || []} onDuplicate={() => setDuplicate(true)} />}
          {tab === 'structured-api' && <BugApiEvidence context={detail?.specialContext} loading={detail?.specialContextLoading} />}
          {tab === 'structured-conversation' && <BugConversationalEvidence t={t} context={detail?.specialContext} selectedBug={incident} loading={detail?.specialContextLoading} />}
          {(tab === 'structured-api' || tab === 'structured-conversation') && props.detailError && <Alert variant="danger" role="alert">{props.detailError}<Button size="sm" variant="outline-danger" className="ms-2" onClick={props.onReloadDetail}>{t('bugs.retry')}</Button></Alert>}
        </section>
        <section className="border-top pt-3 mt-3" aria-label={t('incidencias.traceability')}>
          <h3 className="h6 fw-bold">{t('incidencias.traceability')}</h3>
          <div className="d-flex flex-wrap gap-2">
            {incident.caso_id && onOpenCase && <Button size="sm" variant="outline-primary" onClick={() => requestLeave(() => onOpenCase(incident))}><ExternalLink size={14} className="me-1" />{t('incidencias.viewCase')}</Button>}
            {(incident.ejecucion_id || incident.test_run_id) && onOpenExecution && <Button size="sm" variant="outline-primary" onClick={() => requestLeave(() => onOpenExecution(incident))}><ExternalLink size={14} className="me-1" />{t('incidencias.viewExecution')}</Button>}
          </div>
        </section>
      </Modal.Body>
      <Modal.Footer><Button variant="secondary" disabled={props.actionLoading} onClick={() => requestLeave(onClose)}>{t('incidencias.closeDetail')}</Button></Modal.Footer>
    </Modal>
    <Modal show={Boolean(pendingLeave)} animation={false} centered onHide={() => setPendingLeave(null)}>
      <Modal.Header closeButton><Modal.Title>{t('bugs.unsavedTitle')}</Modal.Title></Modal.Header>
      <Modal.Body>{t('bugs.unsavedMessage')}</Modal.Body>
      <Modal.Footer><Button variant="secondary" onClick={() => setPendingLeave(null)}>{t('bugs.keepEditing')}</Button><Button variant="danger" onClick={() => { const leave = pendingLeave; setPendingLeave(null); leave?.() }}>{t('bugs.discardChanges')}</Button></Modal.Footer>
    </Modal>
    <EvidenceViewerModal evidence={evidence} onHide={() => setEvidence(null)} />
    {duplicate && <BugDuplicateModal bug={incident} fetchWithAuth={props.fetchWithAuth} searchInIncidentCenter onClose={() => setDuplicate(false)} onSaved={async (updated: any) => { await onUpdated(updated); setDuplicate(false) }} />}
  </>
}
