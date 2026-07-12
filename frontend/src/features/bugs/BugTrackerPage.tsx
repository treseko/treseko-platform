import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Card, Col, Form, Modal, Row, Spinner, Table } from 'react-bootstrap'
import { Bug, Clipboard, ExternalLink, Info, Link as LinkIcon, MessageSquare, Plus, RefreshCw, Save, X } from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { EvidenceUpload, type AttachmentMeta } from '../../EvidenceUpload'
import { EvidenceViewerModal, type EvidenceViewerItem } from '../../shared/components/EvidenceViewerModal'
import { isEvidenceAvailable } from '../../shared/utils/evidenceAvailability'
import {
  BUG_PRIORITY_OPTIONS,
  formatBugPriorityOption,
  getBugCriticalityPresentation,
  getBugPriorityPresentation,
  getBugSeverityPresentation,
} from './bugPresentation'

type BugTrackerPageProps = {
  currentProjectId?: string
  currentBuildId?: string
  currentCompId?: string
  buildsList?: any[]
  componentsList?: any[]
  appUsers?: any[]
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
  canAccessCapability?: (capabilityId: string, level?: string) => boolean
  onOpenManualBugDrawer?: () => void
  refreshToken?: number
  onBugsChanged?: () => void
  deepLinkBugId?: string
  onDeepLinkConsumed?: () => void
}

const severityVariant: Record<string, string> = {
  CRITICA: 'danger',
  ALTA: 'warning',
  MEDIA: 'primary',
  BAJA: 'secondary',
  COSMETICA: 'light',
}

const closedStates = new Set(['RESUELTO', 'CERRADO', 'DUPLICADO', 'NO_REPRODUCIBLE', 'NO_CORRESPONDE'])
const statusOptions = ['ABIERTO','TRIAGE','ASIGNADO','EN_PROGRESO','LISTO_PARA_RETEST','EN_RETEST','RESUELTO','REABIERTO','CERRADO','DUPLICADO','NO_REPRODUCIBLE','NO_CORRESPONDE','BLOQUEADO']
const bugStatusHelp = [
  { group: 'Activos', items: [
    ['ABIERTO', 'Bug registrado y pendiente de primera revisión. Todavía requiere triage o asignación.'],
    ['TRIAGE', 'Se está evaluando si corresponde, severidad, prioridad, alcance y responsable.'],
    ['ASIGNADO', 'Ya tiene responsable definido y queda en espera de análisis o corrección.'],
    ['EN_PROGRESO', 'El responsable está trabajando en el diagnóstico o la corrección.'],
    ['BLOQUEADO', 'No se puede avanzar por dependencia externa, falta de información, ambiente o decisión pendiente.'],
    ['REABIERTO', 'El bug se había dado por resuelto/cerrado, pero volvió a fallar o la corrección no alcanzó.'],
  ]},
  { group: 'Retest', items: [
    ['LISTO_PARA_RETEST', 'Desarrollo o QA marcó que hay una corrección disponible y QA debe volver a ejecutar la prueba.'],
    ['EN_RETEST', 'QA está validando la corrección en la build o ambiente correspondiente.'],
  ]},
  { group: 'Cierre', items: [
    ['RESUELTO', 'La causa fue corregida o se aplicó una solución; normalmente queda listo para cierre tras validación.'],
    ['CERRADO', 'Bug finalizado y sin acción pendiente. Ya no cuenta como bug abierto.'],
    ['DUPLICADO', 'Representa el mismo problema que otro bug y debe seguirse desde el ticket principal.'],
    ['NO_REPRODUCIBLE', 'No se pudo reproducir con la información o ambiente disponible.'],
    ['NO_CORRESPONDE', 'No aplica como defecto: puede ser comportamiento esperado, caso inválido o reporte incorrecto.'],
  ]},
]
const severityOptions = ['CRITICA','ALTA','MEDIA','BAJA','COSMETICA']
const priorityOptions = BUG_PRIORITY_OPTIONS
const compactUnique = (items: string[]) => Array.from(new Set(items.map(item => String(item || '').trim()).filter(Boolean)))
const bugBuildOriginLabel = (bug: any) => (
  bug?.metadata_json?.build_name ||
  bug?.version_app ||
  bug?.build_name ||
  bug?.build_code ||
  'N/D'
)
const bugComponentLabel = (bug: any) => (
  bug?.metadata_json?.component_name ||
  bug?.modulo_funcional ||
  'N/D'
)
const bugOccurrenceBuilds = (bug: any) => {
  const occurrences = bug?.metadata_json?.linked_execution_occurrences || []
  if (!Array.isArray(occurrences)) return []
  const origin = bugBuildOriginLabel(bug)
  return compactUnique(
    occurrences
      .map((item: any) => item?.build_name || item?.build_code || item?.build || '')
      .filter((item: string) => item && item !== origin)
  )
}
const bugTraceLabel = (bug: any) => {
  const origin = bugBuildOriginLabel(bug)
  const occurrences = bugOccurrenceBuilds(bug)
  if (occurrences.length === 0) return `Detectado en ${origin}.`
  return `Detectado en ${origin}. Se continua observando en ${occurrences.join(', ')}.`
}
const apiErrorMessage = async (response: Response) => {
  const text = await response.text()
  try {
    const payload = JSON.parse(text)
    return payload?.detail || payload?.message || text
  } catch {
    return text
  }
}

export function BugTrackerPage({
  currentProjectId,
  currentBuildId = '',
  currentCompId = '',
  buildsList = [],
  componentsList = [],
  appUsers = [],
  fetchWithAuth,
  showFeedback,
  canAccessCapability,
  onOpenManualBugDrawer,
  refreshToken = 0,
  onBugsChanged,
  deepLinkBugId = '',
  onDeepLinkConsumed,
}: BugTrackerPageProps) {
  const canUse = canAccessCapability || (() => true)
  const canView = canUse('bugs.ver', 'read')
  const canCreate = canUse('bugs.crear', 'edit')
  const canEdit = canUse('bugs.editar', 'edit')
  const canTriage = canUse('bugs.triage', 'edit')
  const canComment = canUse('bugs.comentar', 'edit')
  const canAttachBugEvidence = canUse('bugs.adjuntos', 'edit')
  const canLinkExternal = canUse('bugs.vincular_externo', 'edit')
  const canExport = canUse('bugs.exportar', 'read')
  const currentBuild = buildsList.find((item: any) => String(item.id) === String(currentBuildId || ''))
  const currentComponent = componentsList.find((item: any) => String(item.id) === String(currentCompId || ''))
  const currentBuildLabel = currentBuild?.name || currentBuild?.nombre || ''
  const currentComponentLabel = currentComponent?.name || currentComponent?.nombre || ''

  const [bugs, setBugs] = useState<any[]>([])
  const [summary, setSummary] = useState<any>({})
  const [loading, setLoading] = useState(false)
  const [selectedBug, setSelectedBug] = useState<any | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [filters, setFilters] = useState({ q: '', estado: '', severidad: '', prioridad: '' })
  const [comment, setComment] = useState('')
  const [commentAttachments, setCommentAttachments] = useState<AttachmentMeta[]>([])
  const [externalForm, setExternalForm] = useState({ provider_id: 'redmine', external_issue_id: '', external_issue_url: '' })
  const [markdown, setMarkdown] = useState('')
  const [detailForm, setDetailForm] = useState<any>({})
  const [additionalContextRows, setAdditionalContextRows] = useState<{ key: string; value: string }[]>([])
  const [viewerEvidence, setViewerEvidence] = useState<EvidenceViewerItem | null>(null)
  const [savingDetail, setSavingDetail] = useState(false)
  const [quickTransitioningBugId, setQuickTransitioningBugId] = useState<string | null>(null)
  const [showStatusHelp, setShowStatusHelp] = useState(false)
  const hasLoadedBugsRef = useRef(false)
  const loadedProjectIdRef = useRef<string | undefined>(undefined)
  const consumedDeepLinkBugRef = useRef('')

  const loadBugs = async (options?: { silent?: boolean }) => {
    if (!currentProjectId) return
    const silent = Boolean(options?.silent)
    if (!silent) setLoading(true)
    try {
      const params = new URLSearchParams()
      Object.entries(filters).forEach(([key, value]) => value && params.set(key, value))
      params.set('limit', '100')
      const [listResponse, summaryResponse] = await Promise.all([
        fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/bugs/?${params.toString()}`),
        fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/bugs/summary/`),
      ])
      if (!listResponse.ok) throw new Error(await listResponse.text())
      const listPayload = await listResponse.json()
      setBugs(Array.isArray(listPayload) ? listPayload : (listPayload.items || []))
      if (summaryResponse.ok) setSummary(await summaryResponse.json())
      hasLoadedBugsRef.current = true
      loadedProjectIdRef.current = currentProjectId
    } catch (error: any) {
      showFeedback('Bug Tracker', error?.message || 'No se pudieron cargar bugs.', 'danger')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    const sameProject = loadedProjectIdRef.current === currentProjectId
    void loadBugs({ silent: hasLoadedBugsRef.current && sameProject })
  }, [currentProjectId, refreshToken])

  const hydrateDetailEditState = (bug: any) => {
    setDetailForm({
      titulo: bug.titulo || '',
      descripcion: bug.descripcion || '',
      resultado_esperado: bug.resultado_esperado || '',
      resultado_obtenido: bug.resultado_obtenido || bug.comportamiento_actual || '',
      pasos_reproduccion: bug.pasos_reproduccion || '',
      precondiciones: bug.precondiciones || '',
      datos_prueba: bug.datos_prueba || '',
      logs_relevantes: bug.logs_relevantes || '',
      error_tecnico: bug.error_tecnico || '',
      stack_trace: bug.stack_trace || '',
      notas_qa: bug.notas_qa || '',
      severidad: bug.severidad || 'MEDIA',
      prioridad: bug.prioridad || 'P2',
      criticidad: bug.criticidad || 'MEDIA',
      reproducibilidad: bug.reproducibilidad || 'no_reproducido',
      frecuencia: bug.frecuencia || '',
      impacto_negocio: bug.impacto_negocio || '',
      ambiente_nombre: bug.ambiente_nombre || bug.metadata_json?.environment_name || '',
      ambiente_url: bug.ambiente_url || bug.metadata_json?.environment_url || '',
      version_app: bug.version_app || bug.metadata_json?.build_name || '',
      modulo_funcional: bug.modulo_funcional || bug.metadata_json?.component_name || '',
      url_afectada: bug.url_afectada || '',
      navegador: bug.navegador || '',
      dispositivo: bug.dispositivo || '',
      resolucion: bug.resolucion || '',
      sistema_operativo: bug.sistema_operativo || '',
      asignado_a: bug.asignado_a || '',
    })
    const context = bug.metadata_json?.additional_context
    const rows = Array.isArray(context)
      ? context.map((item: any) => ({ key: item?.key || '', value: item?.value || '' }))
      : context && typeof context === 'object'
        ? Object.entries(context).map(([key, value]) => ({ key, value: String(value ?? '') }))
        : []
    setAdditionalContextRows(rows)
  }

  const openDetail = async (bug: any) => {
    try {
      const response = await fetchWithAuth(`${API_BASE}/bugs/${bug.id}/`)
      if (!response.ok) throw new Error(await apiErrorMessage(response))
      const payload = await response.json()
      setSelectedBug(payload)
      hydrateDetailEditState(payload)
      setMarkdown('')
      setComment('')
      setCommentAttachments([])
      setDetailOpen(true)
    } catch (error: any) {
      showFeedback('Bug Tracker', error?.message || 'No se pudo abrir el detalle.', 'danger')
    }
  }

  useEffect(() => {
    if (!deepLinkBugId || consumedDeepLinkBugRef.current === deepLinkBugId) return
    consumedDeepLinkBugRef.current = deepLinkBugId
    if (!canView) {
      showFeedback('Sin permiso', 'No tienes permiso para ver el detalle de bugs.', 'warning')
      onDeepLinkConsumed?.()
      return
    }
    void openDetail({ id: deepLinkBugId }).finally(() => onDeepLinkConsumed?.())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBugId, canView])

  const transitionBug = async (estado: string) => {
    if (!selectedBug) return
    const response = await fetchWithAuth(`${API_BASE}/bugs/${selectedBug.id}/transition/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado }),
    })
    if (response.ok) {
      const updated = await response.json()
      setSelectedBug(updated)
      hydrateDetailEditState(updated)
      await loadBugs()
      onBugsChanged?.()
    }
  }

  const transitionBugInline = async (bug: any, estado: string) => {
    if (!bug?.id || !canTriage || estado === bug.estado) return
    setQuickTransitioningBugId(bug.id)
    try {
      const response = await fetchWithAuth(`${API_BASE}/bugs/${bug.id}/transition/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado }),
      })
      if (!response.ok) throw new Error(await apiErrorMessage(response))
      const updated = await response.json()
      setBugs((current) => current.map((item) => item.id === bug.id ? { ...item, ...updated } : item))
      if (selectedBug?.id === bug.id) {
        setSelectedBug(updated)
        hydrateDetailEditState(updated)
      }
      showFeedback('Estado actualizado', `${updated.codigo || bug.codigo} quedo en ${updated.estado || estado}.`, 'success')
      onBugsChanged?.()
      void loadBugs({ silent: true })
    } catch (error: any) {
      showFeedback('Bug Tracker', error?.message || 'No se pudo cambiar el estado del bug.', 'danger')
    } finally {
      setQuickTransitioningBugId(null)
    }
  }

  const updateSelectedBug = async (changes: Record<string, any>) => {
    if (!selectedBug) return
    const response = await fetchWithAuth(`${API_BASE}/bugs/${selectedBug.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    })
    if (!response.ok) throw new Error(await apiErrorMessage(response))
    const updated = await response.json()
    setSelectedBug(updated)
    hydrateDetailEditState(updated)
    await loadBugs()
    onBugsChanged?.()
  }

  const saveSelectedBugDetails = async () => {
    if (!selectedBug || !canEdit) return
    const additionalContext = additionalContextRows
      .map(row => ({ key: row.key.trim(), value: row.value.trim() }))
      .filter(row => row.key || row.value)
    setSavingDetail(true)
    try {
      await updateSelectedBug({
        ...detailForm,
        asignado_a: detailForm.asignado_a || null,
        metadata_json: {
          ...(selectedBug.metadata_json || {}),
          additional_context: additionalContext,
        },
      })
      showFeedback('Bug actualizado', 'Los campos del bug quedaron guardados.', 'success')
    } catch (error: any) {
      showFeedback('Bug Tracker', error?.message || 'No se pudo actualizar el bug.', 'danger')
    } finally {
      setSavingDetail(false)
    }
  }

  const updateDetailField = (field: string, value: any) => {
    setDetailForm((prev: any) => ({ ...prev, [field]: value }))
  }

  const updateAdditionalContextRow = (index: number, field: 'key' | 'value', value: string) => {
    setAdditionalContextRows(prev => prev.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row))
  }

  const addComment = async () => {
    if (!selectedBug || (!comment.trim() && commentAttachments.length === 0)) return
    const validAttachmentIds = compactUnique(commentAttachments.map(item => item?.id))
    if (!comment.trim() && validAttachmentIds.length === 0) {
      showFeedback('Bug Tracker', 'Escribe un comentario o espera a que termine la carga de evidencia.', 'warning')
      return
    }
    try {
      const response = await fetchWithAuth(`${API_BASE}/bugs/${selectedBug.id}/comments/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comentario: comment.trim() || 'Se adjunta evidencia para seguimiento.',
          attachment_ids: validAttachmentIds,
        }),
      })
      if (!response.ok) throw new Error(await response.text())
      setComment('')
      setCommentAttachments([])
      await openDetail(selectedBug)
    } catch (error: any) {
      showFeedback('Bug Tracker', error?.message || 'No se pudo agregar el comentario.', 'danger')
    }
  }

  const generatePreview = async () => {
    if (!selectedBug) return ''
    const response = await fetchWithAuth(`${API_BASE}/bugs/${selectedBug.id}/external-preview/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_id: externalForm.provider_id }),
    })
    if (!response.ok) throw new Error(await response.text())
    const payload = await response.json()
    const nextMarkdown = payload.markdown || ''
    setMarkdown(nextMarkdown)
    return nextMarkdown
  }

  const createExternalLink = async () => {
    if (!selectedBug || !externalForm.external_issue_id.trim()) return
    const response = await fetchWithAuth(`${API_BASE}/bugs/${selectedBug.id}/external-links/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(externalForm),
    })
    if (response.ok) {
      setExternalForm({ provider_id: 'redmine', external_issue_id: '', external_issue_url: '' })
      await openDetail(selectedBug)
    }
  }

  const addBugEvidence = async (attachment: AttachmentMeta) => {
    if (!selectedBug || !attachment?.id) return
    const response = await fetchWithAuth(`${API_BASE}/bugs/${selectedBug.id}/attachments/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachment_id: attachment.id, tipo: 'BUG_EVIDENCE' }),
    })
    if (response.ok) await openDetail(selectedBug)
  }

  const removeBugEvidence = async (attachment: AttachmentMeta) => {
    if (!selectedBug || !attachment?.id) return
    const response = await fetchWithAuth(`${API_BASE}/bugs/${selectedBug.id}/attachments/${attachment.id}/`, { method: 'DELETE' })
    if (response.ok) await openDetail(selectedBug)
  }

  const bugGeneralAttachments = (selectedBug?.attachments || [])
    .filter((item: any) => !item.comment_id)
    .map((item: any) => item.attachment)
    .filter(Boolean)

  const openEvidenceViewer = (attachment: AttachmentMeta) => {
    setViewerEvidence({
      url: attachment.public_url,
      filename: attachment.filename_original,
      contentType: attachment.content_type,
      available: attachment.available,
      missing_reason: attachment.missing_reason,
    })
  }

  const copyMarkdown = async () => {
    try {
      const text = markdown || await generatePreview()
      if (text) {
        await navigator.clipboard?.writeText(text)
        showFeedback('Bug Tracker', 'Markdown copiado al portapapeles.', 'success')
      }
    } catch (error: any) {
      showFeedback('Bug Tracker', error?.message || 'No se pudo generar el preview externo.', 'danger')
    }
  }

  if (!currentProjectId && !deepLinkBugId && !detailOpen) {
    return <div className="p-4 text-muted">Selecciona un proyecto para consultar bugs.</div>
  }

  return (
    <div className="p-4 bug-tracker-page">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3">
        <div>
          <h2 className="h4 fw-bold text-dark mb-1">Bug Tracker</h2>
          <div className="small text-muted">Seguimiento interno de defectos con trazabilidad a pruebas, builds, evidencias e integraciones externas.</div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <Button variant="outline-secondary" size="sm" onClick={() => setShowStatusHelp(true)}>
            <Info size={15} className="me-1" /> Estados
          </Button>
          {canCreate && onOpenManualBugDrawer && (
            <Button variant="danger" size="sm" onClick={onOpenManualBugDrawer}>
              <Bug size={15} className="me-1" /> Añadir nuevo bug
            </Button>
          )}
          <Button variant="outline-primary" size="sm" onClick={() => loadBugs()} disabled={loading}><RefreshCw size={15} className="me-1" />Actualizar</Button>
        </div>
      </div>

      <Row className="g-3 mb-3">
        {[
          ['Abiertos', summary.abiertos ?? 0],
          ['Criticos', summary.criticos ?? 0],
          ['Sin asignar', summary.sin_asignado ?? 0],
          ['Listos retest', summary.listos_retest ?? 0],
          ['Sin evidencia', summary.sin_evidencia ?? 0],
          ['Vinculados', summary.vinculados_externos ?? 0],
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
                <Col md={5}><Form.Control size="sm" placeholder="Buscar codigo, titulo, error..." value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} /></Col>
                <Col md={2}><Form.Select size="sm" value={filters.estado} onChange={(e) => setFilters({ ...filters, estado: e.target.value })}><option value="">Estado</option>{statusOptions.map(item => <option key={item}>{item}</option>)}</Form.Select></Col>
                <Col md={2}><Form.Select size="sm" value={filters.severidad} onChange={(e) => setFilters({ ...filters, severidad: e.target.value })}><option value="">Severidad</option>{['CRITICA','ALTA','MEDIA','BAJA','COSMETICA'].map(item => <option key={item}>{item}</option>)}</Form.Select></Col>
                <Col md={2}><Form.Select size="sm" value={filters.prioridad} onChange={(e) => setFilters({ ...filters, prioridad: e.target.value })}><option value="">Prioridad</option>{priorityOptions.map(item => <option key={item} value={item}>{formatBugPriorityOption(item)}</option>)}</Form.Select></Col>
                <Col md={1}><Button size="sm" variant="dark" className="w-100" onClick={() => loadBugs()}>Filtrar</Button></Col>
              </Row>
            </Card.Header>
            <Card.Body className="p-0">
              {loading ? <div className="p-4 text-center"><Spinner size="sm" /> Cargando bugs...</div> : (
                <div className="table-responsive">
                  <Table hover className="mb-0 align-middle">
                    <thead className="table-light"><tr><th>Bug</th><th>Estado</th><th>Sev.</th><th>Pri.</th><th>Contexto</th><th>Asignado</th><th className="text-end">Acciones</th></tr></thead>
                    <tbody>
                      {bugs.map((bug) => {
                        const severity = getBugSeverityPresentation(bug.severidad, '')
                        const priority = getBugPriorityPresentation(bug.prioridad)
                        return (
                        <tr key={bug.id}>
                          <td><strong>{bug.codigo}</strong><div className="small text-muted">{bug.titulo}</div></td>
                          <td><Badge bg={closedStates.has(bug.estado) ? 'secondary' : 'success'}>{bug.estado}</Badge></td>
                          <td><Badge bg={severityVariant[bug.severidad] || 'secondary'} text={bug.severidad === 'COSMETICA' ? 'dark' : undefined}>{severity?.shortLabel || bug.severidad}</Badge></td>
                          <td>
                            {priority ? (
                              <Badge bg={priority.bg} text={priority.text} title={priority.title} className={priority.bg === 'light' ? 'border' : ''}>
                                {priority.shortLabel}
                              </Badge>
                            ) : 'N/D'}
                          </td>
                          <td className="small text-muted">{bug.case_code || 'Sin caso'}<br />{bug.build_code || bug.build_id || 'Sin build'}</td>
                          <td className="small">{bug.asignado_a ? appUsers.find((u: any) => u.id === bug.asignado_a)?.name || 'Asignado' : 'Sin asignar'}</td>
                          <td>
                            <div className="d-flex justify-content-end align-items-center gap-2">
                              {canTriage && (
                                <Form.Select
                                  size="sm"
                                  className="bug-inline-status-select"
                                  aria-label={`Cambiar estado de ${bug.codigo}`}
                                  value={bug.estado || 'ABIERTO'}
                                  disabled={quickTransitioningBugId === bug.id}
                                  onChange={(event) => transitionBugInline(bug, event.target.value)}
                                >
                                  {statusOptions.map(item => <option key={item}>{item}</option>)}
                                </Form.Select>
                              )}
                              <Button size="sm" variant="outline-primary" onClick={() => openDetail(bug)}>Ver</Button>
                            </div>
                          </td>
                        </tr>
                      )})}
                      {bugs.length === 0 && <tr><td colSpan={7} className="text-center text-muted py-4">Sin bugs para los filtros seleccionados.</td></tr>}
                    </tbody>
                  </Table>
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>

      </Row>

      <Modal show={showStatusHelp} onHide={() => setShowStatusHelp(false)} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title className="fw-bold d-flex align-items-center gap-2">
            <Info size={20} /> Estados del Bug Tracker
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="small text-muted mb-3">
            Los estados indican en qué punto del ciclo de vida está el defecto. Los estados activos siguen requiriendo atención; los de cierre dejan de contar como bugs abiertos.
          </div>
          <Row className="g-3">
            {bugStatusHelp.map((section) => (
              <Col md={section.group === 'Activos' ? 12 : 6} key={section.group}>
                <Card className="border shadow-none h-100">
                  <Card.Body>
                    <h6 className="fw-bold text-secondary mb-3">{section.group}</h6>
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
                            <div className="small text-muted flex-grow-1">{description}</div>
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
          <Button variant="primary" onClick={() => setShowStatusHelp(false)}>Entendido</Button>
        </Modal.Footer>
      </Modal>

      <Modal show={detailOpen} onHide={() => setDetailOpen(false)} size="xl" centered dialogClassName="bug-detail-modal">
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
                <h6>Resumen y diagnostico</h6>
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
                    <h6>Resultado esperado</h6>
                    <Form.Control as="textarea" rows={3} className="small" value={detailForm.resultado_esperado || ''} disabled={!canEdit} onChange={(e) => updateDetailField('resultado_esperado', e.target.value)} />
                  </Col>
                  <Col md={6}>
                    <h6>Resultado obtenido</h6>
                    <Form.Control as="textarea" rows={3} className="small" value={detailForm.resultado_obtenido || ''} disabled={!canEdit} onChange={(e) => updateDetailField('resultado_obtenido', e.target.value)} />
                  </Col>
                </Row>
                <h6>Pasos para reproducir</h6>
                <Form.Control as="textarea" rows={8} className="small font-monospace mb-2" value={detailForm.pasos_reproduccion || ''} disabled={!canEdit} onChange={(e) => updateDetailField('pasos_reproduccion', e.target.value)} />
                <h6>Precondiciones</h6>
                <Form.Control as="textarea" rows={3} className="small mb-2" value={detailForm.precondiciones || ''} disabled={!canEdit} onChange={(e) => updateDetailField('precondiciones', e.target.value)} />
                <Row className="g-2 mb-2">
                  <Col md={6}>
                    <h6>Notas QA</h6>
                    <Form.Control as="textarea" rows={4} className="small" value={detailForm.notas_qa || ''} disabled={!canEdit} onChange={(e) => updateDetailField('notas_qa', e.target.value)} />
                  </Col>
                  <Col md={6}>
                    <h6>Logs / error tecnico</h6>
                    <Form.Control as="textarea" rows={4} className="small font-monospace" value={detailForm.logs_relevantes || detailForm.error_tecnico || ''} disabled={!canEdit} onChange={(e) => {
                      updateDetailField('logs_relevantes', e.target.value)
                      updateDetailField('error_tecnico', e.target.value)
                    }} />
                  </Col>
                </Row>
                <h6>Comentarios</h6>
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
                              {!isEvidenceAvailable(attachment) && <Badge bg="warning" text="dark">Archivo no disponible</Badge>}
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
                      placeholder="Agregar comentario"
                    />
                    {commentAttachments.length > 0 && (
                      <div className="d-flex flex-wrap gap-2 my-2">
                        {commentAttachments.map((attachment) => (
                          <span key={attachment.id} className="badge text-bg-light border d-inline-flex align-items-center gap-1">
                            {attachment.filename_original || 'Evidencia'}
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
                          label="Adjuntar al comentario"
                          uploadScope="BUG_COMMENT_EVIDENCE"
                          currentAttachments={commentAttachments}
                          onUploadComplete={(attachment) => setCommentAttachments(prev => prev.some(item => item.id === attachment.id) ? prev : [...prev, attachment])}
                          onRemoveAttachment={(attachment) => setCommentAttachments(prev => prev.filter(item => item.id !== attachment.id))}
                        />
                      )}
                      <Button size="sm" onClick={addComment} disabled={!comment.trim() && commentAttachments.length === 0}>
                        <MessageSquare size={14} className="me-1" /> Comentar
                      </Button>
                    </div>
                  </div>
                )}
              </Col>
              <Col lg={5}>
                <h6>Clasificacion y asignacion</h6>
                <Row className="g-2 mb-2">
                  <Col md={4}>
                    <Form.Label className="x-small text-muted fw-bold">Estado</Form.Label>
                    {canTriage ? (
                      <Form.Select size="sm" value={selectedBug.estado} onChange={(e) => transitionBug(e.target.value)}>
                        {statusOptions.map(item => <option key={item}>{item}</option>)}
                      </Form.Select>
                    ) : (
                      <Form.Control size="sm" value={selectedBug.estado || 'N/D'} readOnly />
                    )}
                  </Col>
                  <Col md={4}>
                    <Form.Label className="x-small text-muted fw-bold">Severidad</Form.Label>
                    <Form.Select size="sm" value={detailForm.severidad || 'MEDIA'} disabled={!canEdit} onChange={(e) => updateDetailField('severidad', e.target.value)}>
                      {severityOptions.map(item => <option key={item}>{item}</option>)}
                    </Form.Select>
                  </Col>
                  <Col md={4}>
                    <Form.Label className="x-small text-muted fw-bold">Prioridad</Form.Label>
                    <Form.Select size="sm" value={detailForm.prioridad || 'P2'} disabled={!canEdit} onChange={(e) => updateDetailField('prioridad', e.target.value)}>
                      {priorityOptions.map(item => <option key={item} value={item}>{formatBugPriorityOption(item)}</option>)}
                    </Form.Select>
                  </Col>
                  <Col md={6}>
                    <Form.Label className="x-small text-muted fw-bold">Criticidad</Form.Label>
                    <Form.Select size="sm" value={detailForm.criticidad || 'MEDIA'} disabled={!canEdit} onChange={(e) => updateDetailField('criticidad', e.target.value)}>
                      {['CRITICA','ALTA','MEDIA','BAJA'].map(item => <option key={item}>{item}</option>)}
                    </Form.Select>
                  </Col>
                  <Col md={12}>
                    <Form.Label className="x-small text-muted fw-bold">Asignado a</Form.Label>
                    <Form.Select size="sm" value={detailForm.asignado_a || ''} disabled={!canEdit} onChange={(e) => updateDetailField('asignado_a', e.target.value || '')}>
                      <option value="">Sin asignar</option>
                      {appUsers.map((item: any) => <option value={item.id} key={item.id}>{item.name || item.nombre_completo || item.email}</option>)}
                    </Form.Select>
                  </Col>
                </Row>

                <h6>Contexto QA</h6>
                {selectedBug.metadata_json && (
                  <div className="border rounded p-2 mb-2 bg-light small">
                    <div className="fw-semibold text-dark mb-1">{bugTraceLabel(selectedBug)}</div>
                    {currentBuildLabel && <div><strong>Build actual seleccionada:</strong> {currentBuildLabel}</div>}
                    <div><strong>Build origen:</strong> {bugBuildOriginLabel(selectedBug)}</div>
                    <div><strong>Seguimientos:</strong> {bugOccurrenceBuilds(selectedBug).join(', ') || 'Sin ocurrencias adicionales registradas'}</div>
                    <div><strong>Componente:</strong> {currentComponentLabel || bugComponentLabel(selectedBug)}</div>
                    <div><strong>Ambiente:</strong> {selectedBug.metadata_json.environment_name || selectedBug.ambiente_nombre || 'N/D'}</div>
                    <div><strong>Dataset:</strong> {selectedBug.metadata_json.dataset_name || 'N/D'}</div>
                    {selectedBug.metadata_json.environment_url && <div><strong>URL:</strong> {selectedBug.metadata_json.environment_url}</div>}
                  </div>
                )}
                <Table size="sm" bordered><tbody>
                  {[
                    ['Build actual seleccionada', currentBuildLabel || 'N/D'],
                    ['Build origen', bugBuildOriginLabel(selectedBug)],
                    ['Seguimientos', bugOccurrenceBuilds(selectedBug).join(', ') || 'Sin ocurrencias adicionales'],
                    ['Componente actual', currentComponentLabel || 'N/D'],
                    ['Componente origen', bugComponentLabel(selectedBug)],
                    ['Dataset', selectedBug.metadata_json?.dataset_name || selectedBug.dataset_id],
                    ['Caso', selectedBug.case_code || selectedBug.caso_id],
                    ['TestRun', selectedBug.test_run_id],
                    ['Ejecucion', selectedBug.ejecucion_id],
                    ['Snapshot', selectedBug.snapshot_id],
                    ['Paso', selectedBug.numero_paso],
                    ['Modo', selectedBug.execution_mode],
                    ['Ambiente', selectedBug.metadata_json?.environment_name || selectedBug.ambiente_nombre],
                  ].map(([k, v]) => <tr key={k}><td className="fw-bold small">{k}</td><td className="small text-break">{v || 'N/D'}</td></tr>)}
                </tbody></Table>
                <h6>Datos tecnicos editables</h6>
                <Row className="g-2 mb-2">
                  <Col md={12}><Form.Control size="sm" placeholder="URL afectada" value={detailForm.url_afectada || ''} disabled={!canEdit} onChange={(e) => updateDetailField('url_afectada', e.target.value)} /></Col>
                  <Col md={6}><Form.Control size="sm" placeholder="Navegador" value={detailForm.navegador || ''} disabled={!canEdit} onChange={(e) => updateDetailField('navegador', e.target.value)} /></Col>
                  <Col md={6}><Form.Control size="sm" placeholder="Sistema operativo" value={detailForm.sistema_operativo || ''} disabled={!canEdit} onChange={(e) => updateDetailField('sistema_operativo', e.target.value)} /></Col>
                  <Col md={6}><Form.Control size="sm" placeholder="Dispositivo" value={detailForm.dispositivo || ''} disabled={!canEdit} onChange={(e) => updateDetailField('dispositivo', e.target.value)} /></Col>
                  <Col md={6}><Form.Control size="sm" placeholder="Resolucion" value={detailForm.resolucion || ''} disabled={!canEdit} onChange={(e) => updateDetailField('resolucion', e.target.value)} /></Col>
                  <Col md={6}><Form.Control size="sm" placeholder="Reproducibilidad" value={detailForm.reproducibilidad || ''} disabled={!canEdit} onChange={(e) => updateDetailField('reproducibilidad', e.target.value)} /></Col>
                  <Col md={6}><Form.Control size="sm" placeholder="Frecuencia" value={detailForm.frecuencia || ''} disabled={!canEdit} onChange={(e) => updateDetailField('frecuencia', e.target.value)} /></Col>
                  <Col md={12}><Form.Control as="textarea" rows={2} size="sm" placeholder="Impacto negocio" value={detailForm.impacto_negocio || ''} disabled={!canEdit} onChange={(e) => updateDetailField('impacto_negocio', e.target.value)} /></Col>
                </Row>
                {selectedBug.metadata_json?.dataset_variables && Object.keys(selectedBug.metadata_json.dataset_variables).length > 0 && (
                  <>
                    <h6>Datos usados</h6>
                    <pre className="small border rounded p-2 bg-light white-space-pre-wrap" style={{ maxHeight: 160, overflow: 'auto' }}>
                      {JSON.stringify(selectedBug.metadata_json.dataset_variables, null, 2)}
                    </pre>
                  </>
                )}
                <div className="border rounded p-2 mb-3 bg-light">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <h6 className="mb-0">Contexto adicional del sistema</h6>
                    {canEdit && <Button size="sm" variant="outline-primary" onClick={() => setAdditionalContextRows(prev => [...prev, { key: '', value: '' }])}><Plus size={13} /></Button>}
                  </div>
                  {additionalContextRows.length === 0 && (
                    <div className="small text-muted border rounded bg-white p-2 mb-2">
                      Sin contexto adicional registrado.
                    </div>
                  )}
                  {additionalContextRows.map((row, index) => (
                    <Row className="g-2 mb-2" key={`${index}-${row.key}`}>
                      <Col xs={5}><Form.Control size="sm" placeholder="Componente/dato" value={row.key} disabled={!canEdit} onChange={(e) => updateAdditionalContextRow(index, 'key', e.target.value)} /></Col>
                      <Col xs={6}><Form.Control size="sm" placeholder="Version/valor" value={row.value} disabled={!canEdit} onChange={(e) => updateAdditionalContextRow(index, 'value', e.target.value)} /></Col>
                      <Col xs={1} className="d-grid">{canEdit && <Button size="sm" variant="outline-danger" onClick={() => setAdditionalContextRows(prev => prev.filter((_, rowIndex) => rowIndex !== index))}><X size={13} /></Button>}</Col>
                    </Row>
                  ))}
                </div>
                {canEdit && (
                  <Button size="sm" variant="success" className="w-100 mb-3 fw-bold" onClick={saveSelectedBugDetails} disabled={savingDetail}>
                    <Save size={14} className="me-1" /> {savingDetail ? 'Guardando...' : 'Guardar cambios del bug'}
                  </Button>
                )}
                <h6>Vinculos externos</h6>
                {(selectedBug.external_links || []).map((item: any) => <div key={item.id} className="small border rounded p-2 mb-2"><ExternalLink size={13} className="me-1" />{item.provider_id}: {item.external_issue_id}</div>)}
                {canLinkExternal && <Row className="g-2 mb-2">
                  <Col md={4}><Form.Select size="sm" value={externalForm.provider_id} onChange={(e) => setExternalForm({ ...externalForm, provider_id: e.target.value })}>{['redmine','jira','github_issues'].map(item => <option key={item}>{item}</option>)}</Form.Select></Col>
                  <Col md={4}><Form.Control size="sm" placeholder="ID externo" value={externalForm.external_issue_id} onChange={(e) => setExternalForm({ ...externalForm, external_issue_id: e.target.value })} /></Col>
                  <Col md={4}><Button size="sm" variant="outline-primary" onClick={createExternalLink}><LinkIcon size={14} /></Button></Col>
                </Row>}
                {canExport && <div className="d-flex gap-2 mb-2"><Button size="sm" variant="outline-dark" onClick={generatePreview}>Generar preview</Button><Button size="sm" variant="outline-secondary" onClick={copyMarkdown}><Clipboard size={14} /></Button></div>}
                {markdown && <Form.Control as="textarea" rows={8} value={markdown} readOnly className="small font-monospace" />}
                <h6 className="mt-3">Evidencias</h6>
                {canUse('bugs.adjuntos', 'edit') ? (
                  <EvidenceUpload
                    compact
                    label="Adjuntar evidencia"
                    uploadScope="BUG_EVIDENCE"
                    currentAttachments={bugGeneralAttachments}
                    onUploadComplete={addBugEvidence}
                    onRemoveAttachment={removeBugEvidence}
                  />
                ) : (
                  <div className="small text-muted">Sin permiso para adjuntar evidencia.</div>
                )}
              </Col>
            </Row>
          </Modal.Body>
        )}
        <Modal.Footer className="d-flex justify-content-between">
          <Button variant="secondary" onClick={() => setDetailOpen(false)}>Cerrar</Button>
          {canEdit && selectedBug && (
            <Button variant="success" className="fw-bold" onClick={saveSelectedBugDetails} disabled={savingDetail}>
              <Save size={14} className="me-1" /> {savingDetail ? 'Guardando...' : 'Guardar cambios del bug'}
            </Button>
          )}
        </Modal.Footer>
      </Modal>
      <EvidenceViewerModal evidence={viewerEvidence} onHide={() => setViewerEvidence(null)} />
    </div>
  )
}
