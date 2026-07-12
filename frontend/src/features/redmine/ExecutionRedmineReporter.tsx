import type { FormEvent } from 'react'
import { Badge, Button, Col, Form, Modal, Offcanvas, Row, Table } from 'react-bootstrap'
import { AlertCircle, Bug, Plus, Save, Trash2 } from 'lucide-react'
import { EvidenceUpload, type AttachmentMeta } from '../../EvidenceUpload'
import { BUG_PRIORITY_OPTIONS, formatBugPriorityOption } from '../bugs/bugPresentation'

type AdditionalContextRow = {
  key: string
  value: string
}

type ExecutionRedmineReporterProps = {
  showPrompt: boolean
  onHidePrompt: () => void
  showDrawer: boolean
  onHideDrawer: () => void
  currentExecutionCase: any
  selectedTest: any
  onDefer: () => void
  onOpenReport: () => void
  onSubmitInternalBug: (event: FormEvent) => void
  internalBugDraft?: Record<string, any> | null
  onInternalBugDraftChange?: (field: string, value: any) => void
  additionalContextRows?: AdditionalContextRow[]
  onAdditionalContextRowsChange?: (rows: AdditionalContextRow[]) => void
  internalBugEvidence?: AttachmentMeta[]
  onInternalBugEvidenceUploaded?: (attachment: AttachmentMeta) => void
  onInternalBugEvidenceRemoved?: (attachment: AttachmentMeta) => void
  internalBugCreating?: boolean
  appUsers?: any[]
}

export function ExecutionRedmineReporter({
  showPrompt,
  onHidePrompt,
  showDrawer,
  onHideDrawer,
  currentExecutionCase,
  selectedTest,
  onDefer,
  onOpenReport,
  onSubmitInternalBug,
  internalBugDraft,
  onInternalBugDraftChange,
  additionalContextRows = [],
  onAdditionalContextRowsChange,
  internalBugEvidence = [],
  onInternalBugEvidenceUploaded,
  onInternalBugEvidenceRemoved,
  internalBugCreating,
  appUsers = [],
}: ExecutionRedmineReporterProps) {
  const draft = internalBugDraft || {}
  const isManualBug = Boolean(draft._context?.manual)
  const metadata = draft.metadata_json || {}
  const executedSteps = Array.isArray(metadata.executed_steps) ? metadata.executed_steps : []
  const datasetVariables = metadata.dataset_variables && typeof metadata.dataset_variables === 'object' ? metadata.dataset_variables : null
  const displaySelectedTest = isManualBug ? null : selectedTest
  const preloadedAttachmentIds = Array.isArray(draft._context?.preloadedAttachmentIds)
    ? draft._context.preloadedAttachmentIds.map((id: any) => String(id))
    : []
  const hasPreloadedEvidence = internalBugEvidence.some((attachment) => preloadedAttachmentIds.includes(String(attachment?.id || '')))
  const evidenceLabel = hasPreloadedEvidence ? 'Evidencias del fallo' : 'Evidencia general'
  const uploadLabel = hasPreloadedEvidence ? 'Adjuntar evidencia adicional' : 'Adjuntar evidencia'
  const updateField = (field: string, value: any) => onInternalBugDraftChange?.(field, value)
  const updateContextRow = (index: number, field: keyof AdditionalContextRow, value: string) => {
    const nextRows = additionalContextRows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row)
    onAdditionalContextRowsChange?.(nextRows)
  }
  const addContextRow = () => onAdditionalContextRowsChange?.([...additionalContextRows, { key: '', value: '' }])
  const removeContextRow = (index: number) => onAdditionalContextRowsChange?.(additionalContextRows.filter((_, rowIndex) => rowIndex !== index))

  return (
    <>
      <Modal show={showPrompt} onHide={onHidePrompt} centered backdrop="static">
        <Modal.Header className="border-0 bg-warning bg-opacity-10 text-dark">
          <Modal.Title className="fw-bold d-flex align-items-center gap-2">
            <AlertCircle size={22} className="text-warning" />
            Fallo guardado
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="px-4 pb-2 text-dark">
          <p className="small mb-0">
            La ejecución quedó guardada con resultado <strong>{currentExecutionCase?.estado_resultado || 'FALLO'}</strong>. Puedes dejarla pendiente o crear ahora un bug interno con el contexto QA de esta ejecución.
          </p>
        </Modal.Body>
        <Modal.Footer className="border-0 px-4 pb-4 d-flex justify-content-end gap-2">
          <Button variant="outline-primary" className="fw-bold rounded-pill px-4 shadow-none" onClick={onDefer}>
            Reportar después
          </Button>
          <Button variant="danger" className="fw-bold rounded-pill px-4 shadow-none" disabled={internalBugCreating} onClick={onOpenReport}>
            <Bug size={16} className="me-2" /> {internalBugCreating ? 'Preparando...' : 'Reportar ahora'}
          </Button>
        </Modal.Footer>
      </Modal>

      <Offcanvas show={showDrawer} onHide={onHideDrawer} placement="end" style={{ width: '620px' }}>
        <Offcanvas.Header closeButton className="bg-danger text-white border-0 py-4 shadow-sm">
          <Offcanvas.Title className="fw-bold d-flex align-items-center gap-2 text-white">
            <Bug size={24} className="text-white" /> Reportar bug interno
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body className="p-4 small bg-light text-dark text-start">
          <div className="alert alert-warning border-0 shadow-sm x-small mb-4 fw-bold text-start">
            El bug se creará en el Bug Tracker interno. Luego podrás vincularlo o generar preview para Redmine desde el detalle del bug.
          </div>

          <Form className="text-dark text-start" onSubmit={onSubmitInternalBug}>
            <Form.Group className="mb-3">
              <Form.Label className="text-muted fw-bold x-small uppercase">Título del bug</Form.Label>
              <Form.Control size="sm" value={draft.titulo || ''} onChange={(e) => updateField('titulo', e.target.value)} className="bg-white border-0 shadow-sm fw-bold text-dark fs-6" required />
            </Form.Group>

            <Row className="g-2 mb-3">
              <Col md={4}>
                <Form.Label className="text-muted fw-bold x-small uppercase">Severidad</Form.Label>
                <Form.Select size="sm" value={draft.severidad || 'MEDIA'} onChange={(e) => updateField('severidad', e.target.value)}>
                  {['BAJA', 'MEDIA', 'ALTA', 'CRITICA'].map(item => <option key={item}>{item}</option>)}
                </Form.Select>
              </Col>
              <Col md={4}>
                <Form.Label className="text-muted fw-bold x-small uppercase">Prioridad</Form.Label>
                <Form.Select size="sm" value={draft.prioridad || 'P2'} onChange={(e) => updateField('prioridad', e.target.value)}>
                  {BUG_PRIORITY_OPTIONS.slice(0, 4).map(item => <option key={item} value={item}>{formatBugPriorityOption(item)}</option>)}
                </Form.Select>
              </Col>
              <Col md={4}>
                <Form.Label className="text-muted fw-bold x-small uppercase">Criticidad</Form.Label>
                <Form.Select size="sm" value={draft.criticidad || 'MEDIA'} onChange={(e) => updateField('criticidad', e.target.value)}>
                  {['BAJA', 'MEDIA', 'ALTA', 'CRITICA'].map(item => <option key={item}>{item}</option>)}
                </Form.Select>
              </Col>
              <Col md={12}>
                <Form.Label className="text-muted fw-bold x-small uppercase">Asignado a</Form.Label>
                <Form.Select size="sm" value={draft.asignado_a || ''} onChange={(e) => updateField('asignado_a', e.target.value || null)}>
                  <option value="">Sin asignar</option>
                  {appUsers.map((item: any) => <option value={item.id} key={item.id}>{item.name || item.nombre_completo || item.email}</option>)}
                </Form.Select>
              </Col>
            </Row>

            <Form.Group className="mb-3">
              <Form.Label className="text-muted fw-bold x-small uppercase d-flex justify-content-between">
                <span>Resumen del problema</span>
                <Badge bg="light" text="primary" className="border">Editable</Badge>
              </Form.Label>
              <Form.Control as="textarea" rows={3} value={draft.descripcion || ''} onChange={(e) => updateField('descripcion', e.target.value)} className="bg-white border-0 shadow-sm text-dark" required />
            </Form.Group>

            <Row className="g-2 mb-3">
              <Col md={6}>
                <Form.Label className="text-muted fw-bold x-small uppercase">Resultado esperado</Form.Label>
                <Form.Control as="textarea" rows={3} value={draft.resultado_esperado || ''} onChange={(e) => updateField('resultado_esperado', e.target.value)} className="bg-white border-0 shadow-sm text-dark" />
              </Col>
              <Col md={6}>
                <Form.Label className="text-muted fw-bold x-small uppercase">Resultado obtenido</Form.Label>
                <Form.Control as="textarea" rows={3} value={draft.resultado_obtenido || ''} onChange={(e) => updateField('resultado_obtenido', e.target.value)} className="bg-white border-0 shadow-sm text-dark" required />
              </Col>
            </Row>

            <Form.Group className="mb-3">
              <Form.Label className="text-muted fw-bold x-small uppercase">Notas QA opcionales</Form.Label>
              <Form.Control as="textarea" rows={3} value={draft.notas_qa || ''} onChange={(e) => updateField('notas_qa', e.target.value)} className="bg-white border-0 shadow-sm text-dark" />
            </Form.Group>

            <div className="bg-white border rounded p-3 mb-3">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h6 className="fw-bold mb-0">Contexto QA autocompletado</h6>
                <Badge bg="light" text="dark" className="border">{displaySelectedTest?.code || displaySelectedTest?.codigo || (isManualBug ? 'Manual' : 'Caso')}</Badge>
              </div>
              <Table size="sm" bordered className="mb-0">
                <tbody>
                  {[
                    ['Proyecto', metadata.project_name || draft.proyecto_nombre],
                    ['Build/version evaluada', metadata.build_name || draft.version_app || draft.build_code],
                    ['Componente principal', metadata.component_name || draft.modulo_funcional],
                    ['Ambiente', metadata.environment_name || draft.ambiente_nombre],
                    ['URL', metadata.environment_url || draft.ambiente_url],
                    ['Dataset', metadata.dataset_name],
                    ['Caso', draft.case_code || displaySelectedTest?.code || displaySelectedTest?.codigo],
                    ['Ejecución', draft.ejecucion_id],
                    ['Snapshot', draft.snapshot_id],
                    ['Paso', draft.numero_paso],
                  ].map(([label, value]) => (
                    <tr key={label}>
                      <td className="fw-bold text-muted" style={{ width: 170 }}>{label}</td>
                      <td className="text-break">{value || 'N/D'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {datasetVariables && Object.keys(datasetVariables).length > 0 && (
                <pre className="small border rounded p-2 bg-light mt-2 mb-0 white-space-pre-wrap" style={{ maxHeight: 120, overflow: 'auto' }}>
                  {JSON.stringify(datasetVariables, null, 2)}
                </pre>
              )}
            </div>

            {executedSteps.length > 0 && (
              <div className="bg-white border rounded p-3 mb-3">
                <h6 className="fw-bold mb-2">Pasos ejecutados</h6>
                <div className="table-responsive">
                  <Table size="sm" bordered className="mb-0">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Acción</th>
                        <th>Datos</th>
                        <th>Esperado</th>
                        <th>Veredicto</th>
                        <th>Observación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {executedSteps.map((step: any) => (
                        <tr key={step.numero_paso || step.step || step.action}>
                          <td>{step.numero_paso || step.step || 'N/D'}</td>
                          <td>{step.accion || step.action || 'N/D'}</td>
                          <td>{step.datos || step.data || 'N/D'}</td>
                          <td>{step.esperado || step.expected || 'N/D'}</td>
                          <td>{step.veredicto || step.status || 'N/D'}</td>
                          <td>{step.observacion || step.note || 'N/D'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </div>
            )}

            <div className="bg-white border rounded p-3 mb-3">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h6 className="fw-bold mb-0">Contexto adicional del sistema</h6>
                <Button type="button" size="sm" variant="outline-primary" onClick={addContextRow}>
                  <Plus size={14} className="me-1" /> Agregar
                </Button>
              </div>
              <div className="text-muted x-small mb-2">Ejemplos: Base de datos = PostgreSQL 16, Cache = Redis 7, API externa = sandbox.</div>
              {additionalContextRows.length === 0 && (
                <div className="small text-muted border rounded bg-light p-2 mb-2">
                  Sin contexto adicional. Agrega filas solo si necesitas documentar versiones o servicios relacionados.
                </div>
              )}
              {additionalContextRows.map((row, index) => (
                <Row className="g-2 mb-2" key={`${index}-${row.key}`}>
                  <Col xs={5}>
                    <Form.Control size="sm" placeholder="Componente o dato" value={row.key} onChange={(e) => updateContextRow(index, 'key', e.target.value)} />
                  </Col>
                  <Col xs={6}>
                    <Form.Control size="sm" placeholder="Versión / valor / ambiente" value={row.value} onChange={(e) => updateContextRow(index, 'value', e.target.value)} />
                  </Col>
                  <Col xs={1} className="d-grid">
                    <Button type="button" size="sm" variant="outline-danger" onClick={() => removeContextRow(index)}>
                      <Trash2 size={14} />
                    </Button>
                  </Col>
                </Row>
              ))}
            </div>

            <Form.Group className="mb-4">
              <Form.Label className="text-muted fw-bold x-small uppercase">{evidenceLabel}</Form.Label>
              <EvidenceUpload
                uploadScope="BUG_EVIDENCE"
                currentAttachments={internalBugEvidence}
                onUploadComplete={(attachment) => onInternalBugEvidenceUploaded?.(attachment)}
                onRemoveAttachment={(attachment) => onInternalBugEvidenceRemoved?.(attachment)}
                label={uploadLabel}
                compact
              />
            </Form.Group>

            <Button type="submit" variant="danger" className="w-100 fw-bold shadow-lg py-3 border-0 rounded-pill text-white shadow-none d-flex justify-content-center align-items-center gap-2" disabled={internalBugCreating}>
              <Save size={18} /> {internalBugCreating ? 'Creando bug interno...' : (isManualBug ? 'Crear bug interno' : 'Crear bug interno y continuar')}
            </Button>
          </Form>
          <Button variant="outline-secondary" className="w-100 fw-bold mt-3 rounded-pill shadow-none" onClick={onDefer}>
            {isManualBug ? 'Cancelar' : 'Reportar después'}
          </Button>
        </Offcanvas.Body>
      </Offcanvas>
    </>
  )
}
