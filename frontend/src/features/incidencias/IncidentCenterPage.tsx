import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Form, Modal, Nav, Row, Spinner } from 'react-bootstrap'
import { Bug, CalendarDays, CheckCircle2, CircleAlert, Download, ExternalLink, FileText, Filter, History, Info, RefreshCw, UserRound, X } from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { EvidenceUpload, type AttachmentMeta } from '../../EvidenceUpload'
import { useI18n } from '../../i18n'
import { formatDateTime } from '../../shared/utils/dateTime'
import { INCIDENT_PRIORITY_KEYS, INCIDENT_PRIORITIES, INCIDENT_SEVERITY_KEYS, INCIDENT_SEVERITIES, INCIDENT_STATUS_KEYS, INCIDENT_STATUSES, incidentBuildLabel, incidentCaseLabel, incidentComponentLabel, incidentErrorMessage, incidentFilterParams, isOpenIncident, itemName, normalizeIncidentDetail, normalizeIncidentPayload, userLabel, incidentActionRequest, incidentAttachmentLinkRequest, incidentOrganizationLabel } from './incidentCenterHelpers'
import { bugStatusHelp, closedStates } from '../bugs/bugTrackerHelpers'
import { BugApiEvidence } from '../bugs/BugApiEvidence'
import { BugConversationalEvidence } from '../bugs/BugConversationalEvidence'
import './incidentCenter.css'

type CapabilityCheck = (capability: string, level?: 'read' | 'edit') => boolean
type IncidentAction = (incident: any, action: ReturnType<typeof incidentActionRequest>) => Promise<boolean>

export type IncidentCenterPageProps = {
  projects?: any[]; organizations?: any[]; builds?: any[]; components?: any[]; users?: any[]; currentUserId?: string
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  canAccessCapability?: CapabilityCheck
  onOpenCase?: (incident: any) => void; onOpenExecution?: (incident: any) => void
  deepLinkBugId?: string; onDeepLinkConsumed?: () => void
}

const emptyFilters = { proyecto_id: '', organizacion_id: '', componente_id: '', build_id: '', asignado_a: '', estado: '', severidad: '', prioridad: '', tipo_contexto: '', q: '', desde: '', hasta: '' }
const displaySummary = (summary: any, key: string, items: any[], predicate?: (item: any) => boolean) => summary?.[key] !== undefined ? Number(summary[key]) : items.filter(predicate || (() => true)).length

function SearchableEntityFilter({ id, label, value, options, optionText, onChange }: { id: string; label: string; value: string; options: any[]; optionText: (option: any) => string; onChange: (value: string) => void }) {
  const selected = options.find(option => String(option?.id ?? '') === String(value))
  const [inputValue, setInputValue] = useState(selected ? optionText(selected) : '')
  useEffect(() => { setInputValue(selected ? optionText(selected) : '') }, [value, options])
  const chooseOption = (nextValue: string) => {
    const match = options.find(option => String(optionText(option)).toLowerCase() === nextValue.trim().toLowerCase())
    if (match) {
      setInputValue(optionText(match))
      onChange(String(match.id))
    } else if (!nextValue.trim()) {
      setInputValue('')
      onChange('')
    } else {
      setInputValue(nextValue)
    }
  }
  return <>
    <Form.Control id={`incident-filter-${id}`} name={id} type="search" autoComplete="off" list={`incident-filter-options-${id}`} aria-label={label} aria-autocomplete="list" placeholder={`${label}…`} value={inputValue} onChange={event => chooseOption(event.target.value)} onBlur={() => setInputValue(selected ? optionText(selected) : '')} />
    <datalist id={`incident-filter-options-${id}`}>{options.map(option => <option key={option.id} value={optionText(option)} />)}</datalist>
  </>
}

export function IncidentCenterPage({ projects = [], organizations = [], builds = [], components = [], users = [], currentUserId, fetchWithAuth, canAccessCapability, onOpenCase, onOpenExecution, deepLinkBugId = '', onDeepLinkConsumed }: IncidentCenterPageProps) {
  const { t } = useI18n()
  const [filters, setFilters] = useState(emptyFilters); const [mineOnly, setMineOnly] = useState(false)
  const [items, setItems] = useState<any[]>([]); const [summary, setSummary] = useState<any>({}); const [total, setTotal] = useState(0); const [skip, setSkip] = useState(0)
  const [selected, setSelected] = useState<any | null>(null); const [detail, setDetail] = useState<any | null>(null); const [specialContext, setSpecialContext] = useState<any | null>(null); const [specialContextLoading, setSpecialContextLoading] = useState(false); const [detailLoading, setDetailLoading] = useState(false); const [detailError, setDetailError] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [actionError, setActionError] = useState(''); const [actionLoading, setActionLoading] = useState(false)
  const [showStatusHelp, setShowStatusHelp] = useState(false)
  const detailRequestRef = useRef(0)
  const allow = (capability: string) => canAccessCapability ? canAccessCapability('incidencias.ver', 'edit') && canAccessCapability(capability, 'edit') : true
  const canExport = canAccessCapability ? canAccessCapability('bugs.exportar', 'read') : true
  const canEdit = allow('bugs.editar'); const canAssign = canEdit && allow('bugs.asignar'); const canTransition = allow('bugs.triage'); const canComment = allow('bugs.comentar'); const canAttach = canAccessCapability ? canAccessCapability('incidencias.ver', 'edit') && canAccessCapability('bugs.adjuntos', 'edit') : true
  const solutions = useMemo(() => {
    const values = new Map<string, any>()
    organizations.forEach(organization => {
      const id = organization.id || organization.organizacion_id || organization.organization_id
      if (id) values.set(String(id), { id, name: incidentOrganizationLabel(organization, t('incidencias.unnamedSolution')) })
    })
    projects.forEach(project => {
      const id = project.orgId || project.organizacion_id || project.organization_id
      if (!id || values.has(String(id))) return
      values.set(String(id), { id, name: incidentOrganizationLabel(project, t('incidencias.unnamedSolution')) })
    })
    return [...values.values()]
  }, [organizations, projects, t])
  const visibleProjects = useMemo(() => projects.filter(project => !filters.organizacion_id || String(project.orgId || project.organizacion_id || project.organization_id) === String(filters.organizacion_id)), [projects, filters.organizacion_id])
  const visibleBuilds = useMemo(() => builds.filter(build => !filters.proyecto_id || String(build.projectId || build.proyecto_id) === String(filters.proyecto_id)), [builds, filters.proyecto_id])
  const visibleComponents = useMemo(() => components.filter(component => !filters.proyecto_id || String(component.projectId || component.proyecto_id) === String(filters.proyecto_id)), [components, filters.proyecto_id])
  const requestFilters = useMemo(() => ({ ...filters, ...(mineOnly && currentUserId ? { asignado_a: currentUserId } : {}) }), [filters, mineOnly, currentUserId])
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await fetchWithAuth(`${API_BASE}/incidencias/centro/?${incidentFilterParams({ ...requestFilters, skip: String(skip) }).toString()}`)
      if (!response.ok) throw new Error(await incidentErrorMessage(response, t('incidencias.loadError')))
      const payload = normalizeIncidentPayload(await response.json()); setItems(payload.items); setSummary(payload.summary); setTotal(payload.total); setSkip(payload.skip)
      setSelected(current => current ? payload.items.find(item => item.id === current.id) || current : null)
    } catch (cause: any) { setError(cause?.message || t('incidencias.loadError')); setItems([]); setSummary({}); setTotal(0); setSkip(0); setSelected(null) } finally { setLoading(false) }
  }, [fetchWithAuth, requestFilters, skip, t])
  useEffect(() => { void load() }, [load])
  const loadDetail = useCallback(async (incident: any) => {
    if (!incident?.id) return
    const requestId = ++detailRequestRef.current
    setDetailLoading(true); setDetailError('')
    try {
      const responses = await Promise.all([
        fetchWithAuth(`${API_BASE}/bugs/${incident.id}/comments/`),
        fetchWithAuth(`${API_BASE}/bugs/${incident.id}/history/`),
        fetchWithAuth(`${API_BASE}/bugs/${incident.id}/attachments/`),
      ])
      const failed = responses.find(response => !response.ok)
      if (failed) throw new Error(await incidentErrorMessage(failed, t('incidencias.detailLoadError')))
      const [comments, history, attachments] = await Promise.all(responses.map(response => response.json()))
      if (requestId !== detailRequestRef.current) return
      setDetail({ ...normalizeIncidentDetail({ comments, history, attachments }), availableBuilds: builds })
      setSpecialContext(null)
      const contextType = String(incident.tipo_contexto || incident.metadata_json?.format || '').toUpperCase()
      if (contextType === 'API' || contextType === 'CONVERSACIONAL') {
        setSpecialContextLoading(true)
        setDetail(previous => previous ? { ...previous, specialContextLoading: true } : previous)
        const contextPath = contextType === 'API' ? 'api-context' : 'conversational-context'
        try {
          const contextResponse = await fetchWithAuth(`${API_BASE}/bugs/${incident.id}/${contextPath}/`)
          if (requestId === detailRequestRef.current && contextResponse.ok) {
            const context = await contextResponse.json()
            setSpecialContext(context)
            setDetail(previous => previous ? { ...previous, specialContext: context } : previous)
          }
        } finally {
          if (requestId === detailRequestRef.current) setSpecialContextLoading(false)
          if (requestId === detailRequestRef.current) setDetail(previous => previous ? { ...previous, specialContextLoading: false } : previous)
        }
      }
    } catch (cause: any) {
      if (requestId !== detailRequestRef.current) return
      setDetail(normalizeIncidentDetail())
      setDetailError(cause?.message || t('incidencias.detailLoadError'))
    } finally { if (requestId === detailRequestRef.current) setDetailLoading(false) }
  }, [builds, fetchWithAuth, t])
  const selectIncident = (incident: any) => { setSelected(incident); setDetail(null); setSpecialContext(null); setSpecialContextLoading(false); void loadDetail(incident) }
  useEffect(() => {
    if (!deepLinkBugId) return
    let cancelled = false
    const openLinkedIncident = async () => {
      try {
        const response = await fetchWithAuth(`${API_BASE}/bugs/${encodeURIComponent(deepLinkBugId)}/`)
        if (!response.ok) throw new Error(await incidentErrorMessage(response, t('incidencias.detailLoadError')))
        const incident = await response.json()
        if (cancelled) return
        setSelected(incident); setDetail(null)
        void loadDetail(incident)
      } catch (cause: any) {
        if (!cancelled) setError(cause?.message || t('incidencias.detailLoadError'))
      } finally {
        if (!cancelled) onDeepLinkConsumed?.()
      }
    }
    void openLinkedIncident()
    return () => { cancelled = true }
  }, [deepLinkBugId, fetchWithAuth, loadDetail, onDeepLinkConsumed, t])
  const performAction: IncidentAction = async (incident, action) => {
    setActionLoading(true); setActionError('')
    try {
      const response = await fetchWithAuth(`${API_BASE}/bugs/${incident.id}${action.path}`, { method: action.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action.body) })
      if (!response.ok) throw new Error(await incidentErrorMessage(response, t('incidencias.actionError')))
      const updated = await response.json().catch(() => ({})); await load()
      // Algunas acciones devuelven solo un mensaje o una representación parcial.
      // No reemplazar el incidente completo por esa respuesta: el modal necesita
      // conservar sus datos de diagnóstico mientras se actualiza la acción.
      const next = action.path === '/comments/' ? incident : {
        ...incident,
        ...(updated && typeof updated === 'object' && !Array.isArray(updated) ? updated : {}),
      }
      setSelected(next); await loadDetail(next); return true
    } catch (cause: any) { setActionError(cause?.message || t('incidencias.actionError')); return false } finally { setActionLoading(false) }
  }
  const updateFilter = (key: string, value: string) => { setSkip(0); setFilters(previous => ({ ...previous, [key]: value, ...(key === 'organizacion_id' ? { proyecto_id: '', componente_id: '', build_id: '' } : {}), ...(key === 'proyecto_id' ? { componente_id: '', build_id: '' } : {}) })) }
  const clearFilters = () => { setSkip(0); setFilters(emptyFilters); setMineOnly(false) }
  const exportIncidents = async (format: 'csv' | 'md') => {
    try {
      const params = incidentFilterParams(requestFilters)
      params.set('formato', format)
      const response = await fetchWithAuth(`${API_BASE}/incidencias/centro/export.${format}?${params.toString()}`)
      if (!response.ok) throw new Error(await incidentErrorMessage(response, t('incidencias.exportError')))
      const blob = await response.blob()
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = format === 'md' ? 'incidencias-ia.md' : 'incidencias.csv'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(href)
    } catch (cause: any) {
      setError(cause?.message || t('incidencias.exportError'))
    }
  }
  const optionLabel = (value: string, keyMap: Record<string, string>) => keyMap[value] ? t(`incidencias.${keyMap[value]}` as any) : value
  const optionText = (option: any, key: string) => typeof option === 'string' ? optionLabel(option, key === 'estado' ? INCIDENT_STATUS_KEYS : key === 'severidad' ? INCIDENT_SEVERITY_KEYS : INCIDENT_PRIORITY_KEYS) : itemName(option, String(option?.id || ''))
  const kpis = [{ key: 'abiertos', label: t('incidencias.open'), value: displaySummary(summary, 'abiertos', items, item => isOpenIncident(item.estado)), icon: Bug, tone: 'primary' }, { key: 'criticos', label: t('incidencias.critical'), value: displaySummary(summary, 'criticos', items, item => isOpenIncident(item.estado) && ['CRITICA', 'ALTA'].includes(item.severidad)), icon: CircleAlert, tone: 'danger' }, { key: 'bloqueados', label: t('incidencias.blocked'), value: Number(summary?.by_estado?.BLOQUEADO ?? items.filter(item => item.estado === 'BLOQUEADO').length), icon: CircleAlert, tone: 'warning' }, { key: 'listos_retest', label: t('incidencias.readyRetest'), value: displaySummary(summary, 'listos_retest', items, item => item.estado === 'LISTO_PARA_RETEST'), icon: CheckCircle2, tone: 'success' }, { key: 'sin_asignado', label: t('incidencias.unassigned'), value: displaySummary(summary, 'sin_asignado', items, item => isOpenIncident(item.estado) && !item.asignado_a), icon: UserRound, tone: 'secondary' }]
  const pageSize = 50; const hasPreviousPage = skip > 0; const hasNextPage = skip + items.length < total
  const filterDefinitions: any[] = [['q', t('incidencias.search'), ''], ['estado', t('incidencias.status'), INCIDENT_STATUSES], ['tipo_contexto', t('incidencias.type'), ['CLASICO', 'API', 'CONVERSACIONAL']], ['organizacion_id', t('incidencias.solution'), solutions], ['proyecto_id', t('incidencias.project'), visibleProjects], ['componente_id', t('incidencias.component'), visibleComponents], ['build_id', t('incidencias.build'), visibleBuilds], ['asignado_a', t('incidencias.assignee'), users], ['severidad', t('incidencias.severity'), INCIDENT_SEVERITIES], ['prioridad', t('incidencias.priority'), INCIDENT_PRIORITIES], ['desde', t('incidencias.from'), 'date'], ['hasta', t('incidencias.to'), 'date']]
  const entityFilterKeys = new Set(['organizacion_id', 'proyecto_id', 'componente_id', 'build_id', 'asignado_a'])
  return <><main className="incident-center-page p-3 p-lg-4" aria-labelledby="incident-center-title">
    <header className="incident-center-heading d-flex flex-wrap align-items-start justify-content-between gap-3 mb-4"><div><div className="eyebrow text-primary fw-semibold">{t('incidencias.eyebrow')}</div><h1 id="incident-center-title" className="h3 fw-bold mb-1"><Bug size={26} className="me-2" aria-hidden="true" />{t('incidencias.title')}</h1><p className="text-muted mb-0">{t('incidencias.description')}</p></div><div className="d-flex flex-wrap gap-2"><Button variant="outline-secondary" size="sm" onClick={() => setShowStatusHelp(true)}><Info size={15} className="me-1" aria-hidden="true" />{t('incidencias.statusHelp')}</Button>{canExport && <><Button variant="outline-secondary" size="sm" onClick={() => void exportIncidents('csv')}><Download size={15} className="me-1" aria-hidden="true" />{t('incidencias.exportCsv')}</Button><Button variant="outline-secondary" size="sm" onClick={() => void exportIncidents('md')}><FileText size={15} className="me-1" aria-hidden="true" />{t('incidencias.exportAi')}</Button></>}<Button variant="outline-primary" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'spin me-1' : 'me-1'} />{t('incidencias.refresh')}</Button></div></header>
    <Row className="g-3 mb-4">{kpis.map(({ key, label, value, icon: Icon, tone }) => <Col key={key} xs={6} xl={true}><Card className={`incident-kpi h-100 border-start border-4 border-${tone}`}><Card.Body><div className="d-flex justify-content-between text-muted small"><span>{label}</span><Icon size={18} aria-hidden="true" /></div><div className="h3 fw-bold mb-0 mt-2">{value}</div></Card.Body></Card></Col>)}</Row>
    <Card className="border-0 shadow-sm mb-4"><Card.Body><div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3"><h2 className="h6 fw-bold mb-0"><Filter size={16} className="me-2" />{t('incidencias.filters')}</h2><div className="d-flex gap-2"><Button size="sm" variant={mineOnly ? 'primary' : 'outline-secondary'} onClick={() => setMineOnly(value => !value)} disabled={!currentUserId}><UserRound size={14} className="me-1" />{t('incidencias.mine')}</Button><Button size="sm" variant="link" onClick={clearFilters}><X size={14} className="me-1" />{t('incidencias.clear')}</Button></div></div><Row className="g-2">{filterDefinitions.map(([key, label, options]) => <Col key={key} xs={12} sm={6} lg={key === 'q' ? 4 : 2}>{Array.isArray(options) ? entityFilterKeys.has(key) ? <SearchableEntityFilter id={key} label={label} value={filters[key as keyof typeof filters]} options={options} optionText={option => optionText(option, key)} onChange={value => updateFilter(key, value)} /> : <Form.Select name={key} aria-label={label} value={filters[key as keyof typeof filters]} onChange={event => updateFilter(key, event.target.value)}><option value="">{label}</option>{options.map((option: any) => <option key={option.id || option} value={option.id || option}>{optionText(option, key)}</option>)}</Form.Select> : <Form.Control name={key} type={options === 'date' ? 'date' : 'text'} autoComplete="off" aria-label={label} placeholder={options === 'date' ? undefined : `${label}…`} value={filters[key as keyof typeof filters]} onChange={event => updateFilter(key, event.target.value)} />}</Col>)}</Row></Card.Body></Card>
    {error && <Alert variant="danger" dismissible onClose={() => setError('')} role="alert" aria-live="polite"><strong>{t('incidencias.loadError')}</strong><div className="small mt-1">{error}</div></Alert>}
    <Row className="g-4 align-items-start"><Col xl={selected ? 7 : 12}><Card className="border-0 shadow-sm"><Card.Header className="bg-white d-flex justify-content-between align-items-center"><h2 className="h6 fw-bold mb-0">{t('incidencias.inbox')}</h2><span className="text-muted small" aria-live="polite">{total === 0 ? 0 : skip + 1}–{skip + items.length} / {total}</span></Card.Header><div className="incident-list">{loading ? <div className="incident-state" role="status"><Spinner size="sm" className="me-2" />{t('incidencias.loading')}</div> : items.length === 0 ? <div className="incident-state text-muted">{t('incidencias.empty')}</div> : items.map(item => <button type="button" className={`incident-row ${selected?.id === item.id ? 'is-selected' : ''}`} key={item.id} onClick={() => selectIncident(item)}><div className="d-flex justify-content-between gap-3"><div className="min-w-0"><div className="d-flex align-items-center gap-2 flex-wrap"><strong translate="no">{item.codigo}</strong><Badge bg={item.estado === 'BLOQUEADO' ? 'warning' : item.estado === 'LISTO_PARA_RETEST' ? 'success' : 'secondary'}>{optionLabel(item.estado, INCIDENT_STATUS_KEYS)}</Badge></div><div className="incident-row-title text-truncate">{item.titulo}</div><div className="small text-muted text-truncate">{incidentCaseLabel(item) || t('incidencias.noCase')} · {incidentBuildLabel(item) || t('incidencias.noBuild')}</div></div><div className="text-end text-muted small text-nowrap"><div>{item.asignado_a ? userLabel(users.find(user => String(user.id) === String(item.asignado_a))) : t('incidencias.unassigned')}</div><div>{item.created_at ? formatDateTime(item.created_at) : ''}</div></div></div></button>)}</div><Card.Footer className="bg-white d-flex justify-content-between align-items-center gap-2"><Button size="sm" variant="outline-secondary" disabled={!hasPreviousPage || loading} onClick={() => setSkip(Math.max(0, skip - pageSize))}>{t('incidencias.previous')}</Button><span className="small text-muted">{total === 0 ? 0 : Math.floor(skip / pageSize) + 1} / {Math.max(1, Math.ceil(total / pageSize))}</span><Button size="sm" variant="outline-secondary" disabled={!hasNextPage || loading} onClick={() => setSkip(skip + pageSize)}>{t('incidencias.next')}</Button></Card.Footer></Card></Col>{selected && <Col xl={5}><IncidentDetail incident={selected} detail={detail} detailLoading={detailLoading} detailError={detailError} fetchWithAuth={fetchWithAuth} users={users} t={t} canAssign={canAssign} canEdit={canEdit} canTransition={canTransition} canComment={canComment} canAttach={canAttach} actionLoading={actionLoading} actionError={actionError} onAction={performAction} onReloadDetail={() => void loadDetail(selected)} onClose={() => setSelected(null)} onOpenCase={onOpenCase} onOpenExecution={onOpenExecution} /></Col>}</Row>
  </main><Modal show={showStatusHelp} onHide={() => setShowStatusHelp(false)} centered size="lg" scrollable><Modal.Header closeButton><Modal.Title className="fw-bold d-flex align-items-center gap-2"><Info size={20} />{t('bugs.statusModalTitle')}</Modal.Title></Modal.Header><Modal.Body><div className="small text-muted mb-3">{t('bugs.statusModalDescription')}</div><Row className="g-3">{bugStatusHelp.map(section => <Col md={section.group === 'activeGroup' ? 12 : 6} key={section.group}><Card className="border shadow-none h-100"><Card.Body><h6 className="fw-bold text-secondary mb-3">{t(`bugs.${section.group}` as any)}</h6><div className="d-flex flex-column gap-3">{section.items.map(([status, description]) => <div key={status} className="d-flex gap-3 align-items-start"><Badge bg={closedStates.has(status) ? 'secondary' : ['LISTO_PARA_RETEST', 'EN_RETEST'].includes(status) ? 'primary' : 'success'} className="mt-1 text-wrap text-start flex-shrink-0" style={{ width: 132, whiteSpace: 'normal', lineHeight: 1.2 }}>{t(`incidencias.${INCIDENT_STATUS_KEYS[status] || 'statusUnknown'}` as any)}</Badge><div className="small text-muted flex-grow-1">{t(`bugs.${description}` as any)}</div></div>)}</div></Card.Body></Card></Col>)}</Row></Modal.Body><Modal.Footer><Button variant="primary" onClick={() => setShowStatusHelp(false)}>{t('bugs.understood')}</Button></Modal.Footer></Modal></>
}

function IncidentDetail({ incident, onClose, ...props }: any) {
  return <Modal show onHide={onClose} centered size="xl" fullscreen="lg-down" scrollable className="incident-detail-modal" aria-labelledby="incident-modal-title">
    <Modal.Header closeButton><Modal.Title id="incident-modal-title" className="h5 text-break"><span className="small text-muted d-block" translate="no">{incident.codigo}</span>{incident.titulo}</Modal.Title><IncidentMarkdownExport incident={incident} {...props} header /></Modal.Header>
    <Modal.Body><IncidentDeveloperTabs incident={incident} {...props} /></Modal.Body>
  </Modal>
}

function IncidentMarkdownExport({ incident, fetchWithAuth, t, header = false }: any) {
  const [error, setError] = useState('')
  const download = async () => {
    setError('')
    try {
      const response = await fetchWithAuth(`${API_BASE}/bugs/${incident.id}/export-markdown/`)
      if (!response.ok) throw new Error(await incidentErrorMessage(response, t('incidencias.exportError')))
      const blob = await response.blob()
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = `${incident.codigo || 'bug'}.md`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(href)
    } catch (cause: any) {
      setError(cause?.message || t('incidencias.exportError'))
    }
  }
  if (header) return <Button variant="outline-primary" size="sm" className="ms-auto flex-shrink-0" onClick={() => void download()} title={error || t('incidencias.exportIncidentHint')}><Download size={14} className="me-1" aria-hidden="true" />{t('incidencias.exportIncident')}</Button>
  return null
}

function IncidentDeveloperTabs({ incident = {}, t = (key: string) => key, ...props }: any) {
  const [tab, setTab] = useState('diagnosis')
  const metadata = incident.metadata_json || {}
  const contextType = String(incident.tipo_contexto || metadata.format || '').toUpperCase()
  const specialContext = props.detail?.specialContext || null
  const specialContextLoading = Boolean(props.detail?.specialContextLoading)
  const availableBuilds = Array.isArray(props.detail?.availableBuilds) ? props.detail.availableBuilds : []
  const value = (item: any) => item === null || item === undefined || item === '' ? '—' : String(item)
  const context = [
    [t('incidencias.version'), incident.version_app || incident.build_name || metadata.build_name],
    [t('incidencias.environment'), incident.ambiente_nombre || metadata.environment_name],
    [t('incidencias.build'), incidentBuildLabel(incident)], [t('incidencias.case'), incidentCaseLabel(incident)],
    [t('incidencias.component'), incidentComponentLabel(incident)], [t('incidencias.dataset'), metadata.dataset_name],
    [t('incidencias.executionMode'), incident.execution_mode], [t('incidencias.executionType'), incident.tipo_contexto || incident.origen],
    [t('incidencias.affectedUrl'), incident.url_afectada || metadata.environment_url], [t('incidencias.browser'), incident.navegador],
    [t('incidencias.operatingSystem'), incident.sistema_operativo], [t('incidencias.device'), incident.dispositivo],
    [t('incidencias.resolution'), incident.resolucion], [t('incidencias.reproducibility'), incident.reproducibilidad],
    [t('incidencias.frequency'), incident.frecuencia], [t('incidencias.module'), incident.modulo_funcional],
    [t('incidencias.blocksRelease'), incident.bloquea_release ? t('incidencias.yes') : t('incidencias.no')],
    [t('incidencias.blocksCase'), incident.bloquea_caso ? t('incidencias.yes') : t('incidencias.no')],
  ]
  const block = (label: string, item: any) => <div className="incident-developer-block" key={label}><div className="small text-muted fw-semibold">{label}</div><div className="text-break incident-pre-wrap">{value(item)}</div></div>
  const tabLink = (key: string, label: string) => <Nav.Item><Nav.Link eventKey={key} onClick={() => setTab(key)} role="tab" aria-selected={tab === key}>{label}</Nav.Link></Nav.Item>
  return <Card className="border-0 shadow-sm incident-developer-data"><Card.Body><div className="d-flex align-items-start justify-content-between gap-2 mb-3"><div><h3 className="h6 fw-bold mb-1">{t('incidencias.developerData')}</h3><div className="small text-muted">{t('incidencias.developerDataHint')}</div></div><Badge bg="light" text="dark" className="border flex-shrink-0">{t('incidencias.sourceBug')}</Badge></div><Nav variant="tabs" activeKey={tab} onSelect={key => key && setTab(key)} className="incident-developer-tabs mb-3" role="tablist">{tabLink('diagnosis', t('incidencias.diagnosisTab'))}{tabLink('reproduction', t('incidencias.reproductionTab'))}{tabLink('technical', t('incidencias.technicalTab'))}{tabLink('evidence', t('incidencias.evidenceTab'))}{tabLink('actions', t('incidencias.actionsTab'))}{contextType === 'CONVERSACIONAL' && <Nav.Item><Nav.Link eventKey="structured-conversation" onClick={() => setTab('structured-conversation')}>{t('bugs.conversationContextTab')}</Nav.Link></Nav.Item>}{contextType === 'API' && <Nav.Item><Nav.Link eventKey="structured-api" onClick={() => setTab('structured-api')}>{t('bugs.apiEvidence')}</Nav.Link></Nav.Item>}</Nav>{tab === 'structured-conversation' && <BugConversationalEvidence t={t} context={specialContext} selectedBug={incident} loading={specialContextLoading} />}{tab === 'structured-api' && <BugApiEvidence context={specialContext} loading={specialContextLoading} />}{tab === 'diagnosis' && <><Row className="g-2 mb-3">{context.slice(0, 8).map(([label, item]) => <Col sm={6} lg={3} key={String(label)}><div className="incident-developer-field"><div className="small text-muted">{label}</div><div className="fw-semibold text-break">{value(item)}</div></div></Col>)}</Row><div className="d-grid gap-2">{block(t('incidencias.expectedResult'), incident.resultado_esperado)}{block(t('incidencias.actualResult'), incident.resultado_obtenido || incident.comportamiento_actual)}{block(t('incidencias.businessImpact'), incident.impacto_negocio)}{block(t('incidencias.qaNotes'), incident.notas_qa)}</div></>}{tab === 'reproduction' && <><Row className="g-2 mb-3">{context.slice(8).map(([label, item]) => <Col sm={6} lg={3} key={String(label)}><div className="incident-developer-field"><div className="small text-muted">{label}</div><div className="fw-semibold text-break">{value(item)}</div></div></Col>)}</Row><div className="d-grid gap-2">{block(t('incidencias.testData'), incident.datos_prueba)}{block(t('incidencias.preconditions'), incident.precondiciones)}{block(t('incidencias.reproductionSteps'), incident.pasos_reproduccion)}</div></>}{tab === 'technical' && <div className="d-grid gap-2">{block(t('incidencias.technicalError'), incident.error_tecnico || incident.logs_relevantes)}{block(t('incidencias.stackTrace'), incident.stack_trace)}{block(t('incidencias.sourceBug'), incident.origen)}<div className="incident-developer-block"><div className="small text-muted fw-semibold">{t('incidencias.relatedExecution')}</div><div className="small text-muted">{t('incidencias.relatedExecutionHint')}</div></div></div>}{tab === 'evidence' && <IncidentDetailExtras incident={incident} {...props} t={t} />}{tab === 'actions' && <IncidentQuickActions incident={{ ...incident, availableBuilds }} {...props} t={t} />}</Card.Body></Card>
}

function IncidentQuickActions({ incident = {}, users = [], t, canAssign = false, canEdit = false, canTransition = false, actionLoading = false, actionError = '', onAction }: any) {
  const safeUsers = Array.isArray(users) ? users : []
  const canAct = typeof onAction === 'function'
  const [status, setStatus] = useState(incident.estado || '')
  const [assignee, setAssignee] = useState(incident.asignado_a || '')
  const [solution, setSolution] = useState(incident.resolucion || '')
  const [qaNotes, setQaNotes] = useState(incident.notas_qa || '')
  const [resolutionBuildId, setResolutionBuildId] = useState(incident.resolved_build_id || '')
  const builds = Array.isArray(incident.availableBuilds) ? incident.availableBuilds : []
  useEffect(() => { setStatus(incident.estado || ''); setAssignee(incident.asignado_a || ''); setSolution(incident.resolucion || ''); setQaNotes(incident.notas_qa || ''); setResolutionBuildId(incident.resolved_build_id || '') }, [incident.id, incident.estado, incident.asignado_a, incident.resolucion, incident.notas_qa, incident.resolved_build_id])
  const available = canAct && (canAssign || canTransition || canEdit)
  return <Card className="border-0 shadow-sm mt-3 incident-quick-actions"><Card.Body><div className="d-flex flex-wrap align-items-start justify-content-between gap-2"><div><h3 className="h6 fw-bold mb-1">{t('incidencias.quickActions')}</h3><div className="small text-muted">{t('incidencias.quickActionsHint')}</div></div>{available && <span className="small text-muted">{t('incidencias.requiredFieldsHint')}</span>}</div>{!available && <Alert variant="info" className="py-2 mt-3 mb-0 small" role="status">{t('incidencias.actionsReadOnly')}</Alert>}{available && <div className="border-top mt-3 pt-3"><div className="row g-2">{canTransition && <div className="col-md-4"><Form.Label htmlFor="incident-quick-status">{t('incidencias.status')} <span className="text-danger" aria-hidden="true">*</span></Form.Label>{(status === 'RESUELTO' || status === 'CERRADO' || (incident.estado === 'CERRADO' && status === 'REABIERTO')) && <><Form.Label htmlFor="incident-resolution-build">{t('bugs.correctionBuild')}</Form.Label><Form.Select id="incident-resolution-build" value={resolutionBuildId} onChange={event => setResolutionBuildId(event.target.value)} disabled={actionLoading} required><option value="">{t('bugs.selectBuild')}</option>{builds.filter((build: any) => build.activo !== false).map((build: any) => <option key={build.id} value={build.id}>{build.codigo ? `${build.codigo} · ` : ''}{build.nombre || build.name}</option>)}</Form.Select></>}<Form.Select id="incident-quick-status" value={status} onChange={event => setStatus(event.target.value)} disabled={actionLoading} required>{INCIDENT_STATUSES.map(value => <option key={value} value={value}>{t(`incidencias.${INCIDENT_STATUS_KEYS[value]}` as any)}</option>)}</Form.Select><Button className="mt-2" size="sm" variant="outline-primary" disabled={actionLoading || status === incident.estado} onClick={() => void onAction(incident, incidentActionRequest('transition', { estado: status, resolution_build_id: resolutionBuildId || undefined, resolucion: solution || undefined }))}>{t('incidencias.updateStatus')}</Button></div>}{canAssign && <div className="col-md-4"><Form.Label htmlFor="incident-quick-assignee">{t('incidencias.assignee')}</Form.Label><Form.Select id="incident-quick-assignee" value={assignee} onChange={event => setAssignee(event.target.value)} disabled={actionLoading}><option value="">{t('incidencias.unassigned')}</option>{safeUsers.map((user: any) => <option key={user.id} value={user.id}>{userLabel(user)}</option>)}</Form.Select><Button className="mt-2" size="sm" variant="outline-primary" disabled={actionLoading || assignee === String(incident.asignado_a || '')} onClick={() => void onAction(incident, incidentActionRequest('assign', { asignado_a: assignee || null }))}>{t('incidencias.save')}</Button></div>}{canEdit && <div className="col-md-4"><Form.Label htmlFor="incident-quick-solution">{t('incidencias.solutionNotes')} <span className="text-danger" aria-hidden="true">*</span></Form.Label><Form.Control id="incident-quick-solution" as="textarea" rows={2} value={solution} onChange={event => setSolution(event.target.value)} disabled={actionLoading} placeholder={t('incidencias.solvePlaceholder')} required /><Form.Label htmlFor="incident-quick-qa" className="mt-2">{t('incidencias.qaNotes')}</Form.Label><Form.Control id="incident-quick-qa" as="textarea" rows={2} value={qaNotes} onChange={event => setQaNotes(event.target.value)} disabled={actionLoading} /><Button className="mt-2" size="sm" variant="success" disabled={actionLoading || !solution.trim()} onClick={() => void onAction(incident, incidentActionRequest('solution', { resolucion: solution.trim(), notas_qa: qaNotes }))}>{t('incidencias.saveSolution')}</Button></div>}</div>{actionError && <Alert variant="danger" className="py-2 mt-3 mb-0 small" role="alert" aria-live="polite">{actionError}</Alert>}</div>}</Card.Body></Card>
}

function IncidentDeveloperData({ incident, t }: any) {
  const metadata = incident.metadata_json || {}
  const value = (item: any) => item === null || item === undefined || item === '' ? '—' : String(item)
  const fields = [
    [t('incidencias.version'), incident.version_app || incident.build_name || metadata.build_name],
    [t('incidencias.environment'), incident.ambiente_nombre || metadata.environment_name],
    [t('incidencias.executionMode'), incident.execution_mode],
    [t('incidencias.case'), incidentCaseLabel(incident)],
    [t('incidencias.build'), incidentBuildLabel(incident)],
    [t('incidencias.component'), incidentComponentLabel(incident)],
    [t('incidencias.dataset'), metadata.dataset_name],
    [t('incidencias.affectedUrl'), incident.url_afectada || metadata.environment_url],
    [t('incidencias.browser'), incident.navegador],
    [t('incidencias.operatingSystem'), incident.sistema_operativo],
    [t('incidencias.device'), incident.dispositivo],
    [t('incidencias.resolution'), incident.resolucion],
    [t('incidencias.reproducibility'), incident.reproducibilidad],
    [t('incidencias.frequency'), incident.frecuencia],
    [t('incidencias.module'), incident.modulo_funcional],
    [t('incidencias.executionType'), incident.tipo_contexto || incident.origen],
    [t('incidencias.blocksRelease'), incident.bloquea_release ? t('incidencias.yes') : t('incidencias.no')],
    [t('incidencias.blocksCase'), incident.bloquea_caso ? t('incidencias.yes') : t('incidencias.no')],
  ]
  const textBlocks = [
    [t('incidencias.testData'), incident.datos_prueba],
    [t('incidencias.preconditions'), incident.precondiciones],
    [t('incidencias.reproductionSteps'), incident.pasos_reproduccion],
    [t('incidencias.expectedResult'), incident.resultado_esperado],
    [t('incidencias.actualResult'), incident.resultado_obtenido || incident.comportamiento_actual],
    [t('incidencias.technicalError'), incident.error_tecnico || incident.logs_relevantes],
    [t('incidencias.stackTrace'), incident.stack_trace],
    [t('incidencias.qaNotes'), incident.notas_qa],
    [t('incidencias.businessImpact'), incident.impacto_negocio],
  ]
  return <Card className="border-0 shadow-sm mt-3 incident-developer-data"><Card.Body><div className="d-flex align-items-start justify-content-between gap-2 mb-3"><div><h3 className="h6 fw-bold mb-1">{t('incidencias.developerData')}</h3><div className="small text-muted">{t('incidencias.developerDataHint')}</div></div><Badge bg="light" text="dark" className="border flex-shrink-0">{t('incidencias.sourceBug')}</Badge></div><Row className="g-2 mb-3">{fields.map(([label, item]) => <Col sm={6} lg={4} key={String(label)}><div className="incident-developer-field"><div className="small text-muted">{label}</div><div className="fw-semibold text-break">{value(item)}</div></div></Col>)}</Row><div className="d-grid gap-2">{textBlocks.map(([label, item]) => <div className="incident-developer-block" key={String(label)}><div className="small text-muted fw-semibold">{label}</div><div className="text-break incident-pre-wrap">{value(item)}</div></div>)}</div></Card.Body></Card>
}

function IncidentDetailBase({ incident, users, t, canAssign, canEdit, canTransition, canComment, actionLoading, actionError, onAction, onClose, onOpenCase, onOpenExecution }: any) {
  const [assignee, setAssignee] = useState(incident.asignado_a || ''); const [status, setStatus] = useState(incident.estado || ''); const [solution, setSolution] = useState(incident.resolucion || ''); const [qaNotes, setQaNotes] = useState(incident.notas_qa || ''); const [comment, setComment] = useState('')
  useEffect(() => { setAssignee(incident.asignado_a || ''); setStatus(incident.estado || ''); setSolution(incident.resolucion || ''); setQaNotes(incident.notas_qa || ''); setComment('') }, [incident.id, incident.asignado_a, incident.estado, incident.resolucion, incident.notas_qa])
  const details = [[t('incidencias.case'), incidentCaseLabel(incident)], [t('incidencias.build'), incidentBuildLabel(incident)], [t('incidencias.component'), incidentComponentLabel(incident)], [t('incidencias.created'), incident.created_at ? formatDateTime(incident.created_at) : '—']]
  const submitComment = async (event: React.FormEvent) => { event.preventDefault(); if (comment.trim()) { const succeeded = await onAction(incident, incidentActionRequest('comment', { comentario: comment.trim() })); if (succeeded) setComment('') } }
  return <Card className="border-0 shadow-sm incident-detail" aria-labelledby="incident-detail-title"><Card.Header className="bg-white d-flex justify-content-between gap-2"><div className="min-w-0"><div className="small text-muted" translate="no">{incident.codigo}</div><h2 id="incident-detail-title" className="h5 mb-0 text-break">{incident.titulo}</h2></div><Button variant="light" size="sm" aria-label={t('incidencias.closeDetail')} onClick={onClose}><X size={16} aria-hidden="true" /></Button></Card.Header><Card.Body><div className="d-flex gap-2 flex-wrap mb-3"><Badge bg="secondary">{t(`incidencias.${INCIDENT_STATUS_KEYS[incident.estado] || 'statusUnknown'}` as any)}</Badge><Badge bg="danger">{t(`incidencias.${INCIDENT_SEVERITY_KEYS[incident.severidad] || 'severityUnknown'}` as any)}</Badge><Badge bg="dark">{t(`incidencias.${INCIDENT_PRIORITY_KEYS[incident.prioridad] || 'priorityUnknown'}` as any)}</Badge></div><p className="text-muted text-break">{incident.descripcion || t('incidencias.noDescription')}</p><dl className="incident-detail-grid">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>
    {(canAssign || canTransition || canEdit) && <section className="border-top pt-3 mt-3" aria-labelledby="incident-actions-title"><h3 id="incident-actions-title" className="h6 fw-bold">{t('incidencias.operations')}</h3>{actionError && <Alert variant="danger" className="py-2" role="alert" aria-live="polite">{actionError}</Alert>}<div className="d-grid gap-3"><div>{canAssign && <><Form.Label htmlFor="incident-assignee">{t('incidencias.assignee')}</Form.Label><div className="d-flex gap-2"><Form.Select id="incident-assignee" value={assignee} onChange={event => setAssignee(event.target.value)} disabled={actionLoading}><option value="">{t('incidencias.unassigned')}</option>{users.map(user => <option key={user.id} value={user.id}>{userLabel(user)}</option>)}</Form.Select><Button variant="outline-primary" disabled={actionLoading || assignee === String(incident.asignado_a || '')} onClick={() => void onAction(incident, incidentActionRequest('assign', { asignado_a: assignee || null }))}>{t('incidencias.save')}</Button></div></>}</div>{canTransition && <div><Form.Label htmlFor="incident-status">{t('incidencias.status')}</Form.Label><div className="d-flex gap-2"><Form.Select id="incident-status" value={status} onChange={event => setStatus(event.target.value)} disabled={actionLoading}>{INCIDENT_STATUSES.map(value => <option key={value} value={value}>{t(`incidencias.${INCIDENT_STATUS_KEYS[value]}` as any)}</option>)}</Form.Select><Button variant="outline-primary" disabled={actionLoading || status === incident.estado} onClick={() => void onAction(incident, incidentActionRequest('transition', { estado: status }))}>{t('incidencias.save')}</Button></div></div>}{canEdit && <Form onSubmit={event => { event.preventDefault(); void onAction(incident, incidentActionRequest('solution', { resolucion: solution, notas_qa: qaNotes })) }}><Form.Group className="mb-2"><Form.Label htmlFor="incident-solution">{t('incidencias.solutionNotes')}</Form.Label><Form.Control id="incident-solution" as="textarea" rows={3} value={solution} onChange={event => setSolution(event.target.value)} disabled={actionLoading} /></Form.Group><Form.Group><Form.Label htmlFor="incident-qa-notes">{t('incidencias.qaNotes')}</Form.Label><Form.Control id="incident-qa-notes" as="textarea" rows={3} value={qaNotes} onChange={event => setQaNotes(event.target.value)} disabled={actionLoading} /></Form.Group><Button className="mt-2" type="submit" disabled={actionLoading}>{t('incidencias.saveSolution')}</Button></Form>}</div></section>}
    {canComment && <form className="border-top pt-3 mt-3" onSubmit={submitComment}><Form.Label htmlFor="incident-comment"><strong>{t('incidencias.comment')}</strong></Form.Label><Form.Control id="incident-comment" as="textarea" rows={3} value={comment} onChange={event => setComment(event.target.value)} disabled={actionLoading} placeholder={t('incidencias.commentPlaceholder')} /><Button className="mt-2" type="submit" variant="outline-primary" disabled={actionLoading || !comment.trim()}>{t('incidencias.addComment')}</Button></form>}
    <div className="border-top pt-3 mt-3"><h3 className="h6 fw-bold">{t('incidencias.traceability')}</h3><div className="small text-muted d-grid gap-1"><span>{t('incidencias.caseId')}: <code translate="no">{incident.caso_id || '—'}</code></span><span>{t('incidencias.executionId')}: <code translate="no">{incident.ejecucion_id || incident.test_run_id || '—'}</code></span><span>{t('incidencias.buildId')}: <code translate="no">{incident.build_id || '—'}</code></span></div><div className="d-flex flex-wrap gap-2 mt-3">{incident.caso_id && onOpenCase && <Button size="sm" variant="outline-primary" onClick={() => onOpenCase(incident)}><ExternalLink size={14} className="me-1" aria-hidden="true" />{t('incidencias.viewCase')}</Button>}{(incident.ejecucion_id || incident.test_run_id) && onOpenExecution && <Button size="sm" variant="outline-primary" onClick={() => onOpenExecution(incident)}><ExternalLink size={14} className="me-1" aria-hidden="true" />{t('incidencias.viewExecution')}</Button>}</div></div><div className="border-top pt-3 mt-3"><h3 className="h6 fw-bold"><CalendarDays size={15} className="me-1" aria-hidden="true" />{t('incidencias.activity')}</h3><p className="small text-muted mb-0">{incident.updated_at ? t('incidencias.lastUpdated', { date: formatDateTime(incident.updated_at) }) : t('incidencias.noActivity')}</p></div></Card.Body></Card>
}

function IncidentDetailExtras({ incident, detail, detailLoading, detailError, fetchWithAuth, canAttach, t, onReloadDetail }: any) {
  const [saving, setSaving] = useState(false); const [error, setError] = useState('')
  const attachments = detail?.attachments || []
  const comments = detail?.comments || []
  const history = detail?.history || []
  const link = async (attachment: AttachmentMeta) => { setSaving(true); setError(''); try { const action = incidentAttachmentLinkRequest(attachment.id); const response = await fetchWithAuth(`${API_BASE}/bugs/${incident.id}${action.path}`, { method: action.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action.body) }); if (!response.ok) throw new Error(await incidentErrorMessage(response, t('incidencias.evidenceError'))); onReloadDetail() } catch (cause: any) { setError(cause?.message || t('incidencias.evidenceError')) } finally { setSaving(false) } }
  const remove = async (attachment: AttachmentMeta) => { setSaving(true); setError(''); try { const response = await fetchWithAuth(`${API_BASE}/bugs/${incident.id}/attachments/${attachment.id}/`, { method: 'DELETE' }); if (!response.ok) throw new Error(await incidentErrorMessage(response, t('incidencias.evidenceError'))); onReloadDetail() } catch (cause: any) { setError(cause?.message || t('incidencias.evidenceError')) } finally { setSaving(false) } }
  return <Card className="border-0 shadow-sm mt-3"><Card.Body>{detailLoading ? <div role="status" className="small text-muted"><Spinner size="sm" className="me-1" />{t('incidencias.detailLoading')}</div> : detailError ? <Alert variant="danger" role="alert" aria-live="polite" className="small">{detailError}</Alert> : <>
    <section aria-labelledby="incident-evidence-title"><h3 id="incident-evidence-title" className="h6 fw-bold"><FileText size={15} className="me-1" />{t('incidencias.evidence')}</h3>{canAttach && <EvidenceUpload compact disabled={saving} label={t('incidencias.attachEvidence')} uploadScope="BUG_EVIDENCE" projectId={incident.proyecto_id} currentAttachments={attachments} onUploadComplete={link} onRemoveAttachment={remove} />}{!canAttach && <div className="small text-muted">{t('incidencias.evidencePermission')}</div>}{error && <Alert variant="danger" className="py-2 mt-2 small" role="alert" aria-live="polite">{error}</Alert>}</section>
    <section className="border-top pt-3 mt-3" aria-labelledby="incident-history-title"><h3 id="incident-history-title" className="h6 fw-bold"><History size={15} className="me-1" />{t('incidencias.history')}</h3><h4 className="small fw-bold">{t('incidencias.comments')}</h4>{comments.length ? comments.map((item: any) => <div className="border rounded p-2 mb-2 small" key={item.id}><div className="white-space-pre-wrap">{item.comentario}</div><div className="text-muted mt-1">{item.autor?.display_name || item.autor?.nombre_completo || t('incidencias.unknownAuthor')} · {item.created_at ? formatDateTime(item.created_at) : '—'}</div></div>) : <div className="small text-muted">{t('incidencias.noComments')}</div>}<h4 className="small fw-bold mt-3">{t('incidencias.statusHistory')}</h4>{history.length ? history.map((item: any) => <div className="border-start border-3 ps-2 mb-2 small" key={item.id}><strong>{item.from_status ? `${item.from_status} → ` : ''}{item.to_status}</strong>{item.build_name && <span className="text-muted"> · {item.build_name}</span>}<div className="text-muted">{item.occurred_at ? formatDateTime(item.occurred_at) : '—'}{item.source ? ` · ${item.source}` : ''}</div></div>) : <div className="small text-muted">{t('incidencias.noHistory')}</div>}</section>
    </>}</Card.Body></Card>
}

export default IncidentCenterPage
