import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner } from 'react-bootstrap'
import { Bug, CheckCircle2, CircleAlert, Download, FileText, Filter, Info, RefreshCw, UserRound, X } from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { useI18n } from '../../i18n'
import { formatDateTime } from '../../shared/utils/dateTime'
import { INCIDENT_PRIORITY_KEYS, INCIDENT_PRIORITIES, INCIDENT_SEVERITY_KEYS, INCIDENT_SEVERITIES, INCIDENT_STATUS_KEYS, INCIDENT_STATUSES, incidentBuildLabel, incidentCaseLabel, incidentComponentLabel, incidentErrorMessage, incidentFilterParams, isOpenIncident, itemName, normalizeIncidentDetail, normalizeIncidentPayload, userLabel, incidentActionRequest, incidentOrganizationLabel } from './incidentCenterHelpers'
import { bugStatusHelp, closedStates } from '../bugs/bugTrackerHelpers'
import { IncidentDetail } from './IncidentDetail'
import './incidentCenter.css'

type CapabilityCheck = (capability: string, level?: 'read' | 'edit') => boolean
type IncidentAction = (incident: any, action: ReturnType<typeof incidentActionRequest>) => Promise<boolean>

export type IncidentCenterPageProps = {
  projects?: any[]; organizations?: any[]; builds?: any[]; components?: any[]; users?: any[]; currentUserId?: string
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  canAccessCapability?: CapabilityCheck
  hasSystemFeature?: (feature: string) => boolean
  onOpenCase?: (incident: any) => void; onOpenExecution?: (incident: any) => void
  deepLinkBugId?: string; onDeepLinkConsumed?: () => void
}

const emptyItems: any[] = []
const emptyFilters = { proyecto_id: '', organizacion_id: '', componente_id: '', build_id: '', asignado_a: '', estado: '', severidad: '', prioridad: '', tipo_contexto: '', attention: '', sort: 'newest', q: '', desde: '', hasta: '' }
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

export function IncidentCenterPage({ projects = emptyItems, organizations = emptyItems, builds = emptyItems, components = emptyItems, users = emptyItems, currentUserId, fetchWithAuth, canAccessCapability, hasSystemFeature, onOpenCase, onOpenExecution, deepLinkBugId = '', onDeepLinkConsumed }: IncidentCenterPageProps) {
  const { t } = useI18n()
  const [filters, setFilters] = useState(emptyFilters); const [mineOnly, setMineOnly] = useState(false)
  const [moreFilters, setMoreFilters] = useState(false)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedQuery(filters.q), 300); return () => window.clearTimeout(timer) }, [filters.q])
  const [items, setItems] = useState<any[]>([]); const [summary, setSummary] = useState<any>({}); const [total, setTotal] = useState(0); const [skip, setSkip] = useState(0)
  const [selected, setSelected] = useState<any | null>(null); const [detail, setDetail] = useState<any | null>(null); const [detailLoading, setDetailLoading] = useState(false); const [detailError, setDetailError] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [actionError, setActionError] = useState(''); const [actionLoading, setActionLoading] = useState(false)
  const [showStatusHelp, setShowStatusHelp] = useState(false)
  const detailRequestRef = useRef(0)
  const listRequestRef = useRef(0)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const allow = (capability: string) => canAccessCapability ? canAccessCapability('incidencias.ver', 'edit') && canAccessCapability(capability, 'edit') : true
  const canExport = canAccessCapability ? canAccessCapability('bugs.exportar', 'read') : true
  const canEdit = allow('bugs.editar'); const canAssign = canEdit && allow('bugs.asignar'); const canTransition = allow('bugs.triage'); const canComment = allow('bugs.comentar');
  const canResolve = allow('bugs.resolver'); const canClose = allow('bugs.cerrar')
  const canDuplicate = canTransition && Boolean(hasSystemFeature?.('bugs.enterprise')); const canAttach = canAccessCapability ? canAccessCapability('incidencias.ver', 'edit') && canAccessCapability('bugs.adjuntos', 'edit') : true
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
  const requestFilters = useMemo(() => ({ ...filters, q: debouncedQuery, ...(mineOnly && currentUserId ? { asignado_a: currentUserId } : {}) }), [filters, debouncedQuery, mineOnly, currentUserId])
  const load = useCallback(async () => {
    const request = ++listRequestRef.current
    setLoading(true); setError('')
    try {
      const response = await fetchWithAuth(`${API_BASE}/incidencias/centro/?${incidentFilterParams({ ...requestFilters, skip: String(skip) }).toString()}`)
      if (!response.ok) throw new Error(await incidentErrorMessage(response, t('incidencias.loadError')))
      const payload = normalizeIncidentPayload(await response.json());
      if (request !== listRequestRef.current) return
      if (skip >= payload.total && skip > 0) { setSkip(Math.max(0, Math.floor((payload.total - 1) / 50) * 50)); return }
      setItems(payload.items); setSummary(payload.summary); setTotal(payload.total); setSkip(payload.skip)
      setSelected(current => current ? payload.items.find(item => item.id === current.id) || current : null)
    } catch (cause: any) { if (request === listRequestRef.current) { setError(cause?.message || t('incidencias.loadError')); setItems([]); setSummary({}); setTotal(0) } } finally { if (request === listRequestRef.current) setLoading(false) }
  }, [fetchWithAuth, requestFilters, skip, t])
  useEffect(() => { void load(); return () => { listRequestRef.current++ } }, [load])
  useEffect(() => () => { detailRequestRef.current++ }, [])
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
      setDetail({ ...normalizeIncidentDetail({ comments, history, attachments }), availableBuilds: builds.filter(build => String(build.projectId || build.proyecto_id) === String(incident.proyecto_id)) })
      const contextType = String(incident.tipo_contexto || incident.metadata_json?.format || '').toUpperCase()
      if (contextType === 'API' || contextType === 'CONVERSACIONAL') {
        setDetail(previous => previous ? { ...previous, specialContextLoading: true } : previous)
        const contextPath = contextType === 'API' ? 'api-context' : 'conversational-context'
        try {
          const contextResponse = await fetchWithAuth(`${API_BASE}/bugs/${incident.id}/${contextPath}/`)
          if (!contextResponse.ok) throw new Error(await incidentErrorMessage(contextResponse, t('incidencias.detailLoadError')))
          if (requestId === detailRequestRef.current) {
            const context = await contextResponse.json()
            setDetail(previous => previous ? { ...previous, specialContext: context } : previous)
          }
        } catch (cause: any) {
          if (requestId === detailRequestRef.current) setDetailError(cause.message || t('incidencias.detailLoadError'))
        } finally {
          if (requestId === detailRequestRef.current) setDetail(previous => previous ? { ...previous, specialContextLoading: false } : previous)
        }
      }
    } catch (cause: any) {
      if (requestId !== detailRequestRef.current) return
      setDetail(normalizeIncidentDetail())
      setDetailError(cause?.message || t('incidencias.detailLoadError'))
    } finally { if (requestId === detailRequestRef.current) setDetailLoading(false) }
  }, [builds, fetchWithAuth, t])
  const selectIncident = (incident: any) => { setSelected(incident); setDetail(null); void loadDetail(incident) }
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
      if (selectedRef.current?.id !== incident.id) return true
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
  const clearFilters = () => { setSkip(0); setFilters(emptyFilters); setDebouncedQuery(''); setMineOnly(false) }
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
  const kpis = [{ key: 'abiertos', label: t('incidencias.open'), value: displaySummary(summary, 'abiertos', items, item => isOpenIncident(item.estado)), icon: Bug, tone: 'primary' }, { key: 'criticos', label: t('incidencias.criticalAndHigh'), value: displaySummary(summary, 'criticos', items, item => isOpenIncident(item.estado) && ['CRITICA', 'ALTA'].includes(item.severidad)), icon: CircleAlert, tone: 'danger' }, { key: 'bloqueados', label: t('incidencias.blocked'), value: Number(summary?.by_estado?.BLOQUEADO ?? items.filter(item => item.estado === 'BLOQUEADO').length), icon: CircleAlert, tone: 'warning' }, { key: 'listos_retest', label: t('incidencias.readyRetest'), value: displaySummary(summary, 'listos_retest', items, item => item.estado === 'LISTO_PARA_RETEST'), icon: CheckCircle2, tone: 'success' }, { key: 'sin_asignado', label: t('incidencias.unassigned'), value: displaySummary(summary, 'sin_asignado', items, item => isOpenIncident(item.estado) && !item.asignado_a), icon: UserRound, tone: 'secondary' }]
  const pageSize = 50; const hasPreviousPage = skip > 0; const hasNextPage = skip + items.length < total
  const filterDefinitions: any[] = [['q', t('incidencias.search'), ''], ['estado', t('incidencias.status'), INCIDENT_STATUSES], ['tipo_contexto', t('incidencias.type'), ['CLASICO', 'API', 'CONVERSACIONAL']], ['organizacion_id', t('incidencias.solution'), solutions], ['proyecto_id', t('incidencias.project'), visibleProjects], ['componente_id', t('incidencias.component'), visibleComponents], ['build_id', t('incidencias.build'), visibleBuilds], ['asignado_a', t('incidencias.assignee'), users], ['severidad', t('incidencias.severity'), INCIDENT_SEVERITIES], ['prioridad', t('incidencias.priority'), INCIDENT_PRIORITIES], ['desde', t('incidencias.from'), 'date'], ['hasta', t('incidencias.to'), 'date']]
  const entityFilterKeys = new Set(['organizacion_id', 'proyecto_id', 'componente_id', 'build_id', 'asignado_a'])
  return <><main className="incident-center-page p-3 p-lg-4" aria-labelledby="incident-center-title">
    <header className="incident-center-heading d-flex flex-wrap align-items-start justify-content-between gap-3 mb-4"><div><div className="eyebrow text-primary fw-semibold">{t('incidencias.eyebrow')}</div><h1 id="incident-center-title" className="h3 fw-bold mb-1"><Bug size={26} className="me-2" aria-hidden="true" />{t('incidencias.title')}</h1><p className="text-muted mb-0">{t('incidencias.description')}</p></div><div className="d-flex flex-wrap gap-2"><Button variant="outline-secondary" size="sm" onClick={() => setShowStatusHelp(true)}><Info size={15} className="me-1" aria-hidden="true" />{t('incidencias.statusHelp')}</Button>{canExport && <><Button variant="outline-secondary" size="sm" onClick={() => void exportIncidents('csv')}><Download size={15} className="me-1" aria-hidden="true" />{t('incidencias.exportCsv')}</Button><Button variant="outline-secondary" size="sm" onClick={() => void exportIncidents('md')}><FileText size={15} className="me-1" aria-hidden="true" />{t('incidencias.exportAi')}</Button></>}<Button variant="outline-primary" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'spin me-1' : 'me-1'} />{t('incidencias.refresh')}</Button></div></header>
    <Row className="g-2 mb-3">{kpis.map(({ key, label, value, icon: Icon, tone }) => <Col key={key} xs={6} xl={true}><button type="button" className={`incident-kpi h-100 w-100 text-start border-start border-4 border-${tone}`} onClick={() => { setSkip(0); setFilters(previous => ({ ...previous, estado: key === 'bloqueados' ? 'BLOQUEADO' : '', attention: ({ abiertos: 'open', criticos: 'critical', listos_retest: 'retest', sin_asignado: 'unassigned' } as Record<string, string>)[key] || '', ...(key === 'sin_asignado' ? { asignado_a: '' } : {}) })); if (key === 'sin_asignado') setMineOnly(false) }}><div className="p-3"><div className="d-flex justify-content-between text-muted small"><span>{label}</span><Icon size={18} aria-hidden="true" /></div><div className="h3 fw-bold mb-0 mt-2">{value}</div></div></button></Col>)}</Row>
    <Card className={`border-0 shadow-sm mb-4 incident-filters ${moreFilters ? 'is-expanded' : ''}`}><Card.Body><div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3"><h2 className="h6 fw-bold mb-0"><Filter size={16} className="me-2" />{t('incidencias.filters')}</h2><div className="d-flex gap-2 flex-wrap"><Button className="incident-more-filters" size="sm" variant="outline-secondary" aria-expanded={moreFilters} onClick={() => setMoreFilters(value => !value)}>{t(moreFilters ? 'bugs.lessFilters' : 'bugs.moreFilters')}</Button><Button size="sm" variant={mineOnly ? 'primary' : 'outline-secondary'} onClick={() => { setSkip(0); setMineOnly(value => !value); setFilters(previous => ({ ...previous, attention: '' })) }} disabled={!currentUserId}><UserRound size={14} className="me-1" />{t('incidencias.mine')}</Button><Button size="sm" variant="link" onClick={clearFilters}><X size={14} className="me-1" />{t('incidencias.clear')}</Button></div></div><div className="mb-2 d-flex flex-wrap align-items-center gap-2"><Form.Select className="incident-sort" aria-label={t('bugs.sortBy')} value={filters.sort} onChange={event => updateFilter('sort', event.target.value)}><option value="newest">{t('bugs.sort_newest')}</option><option value="oldest">{t('bugs.sort_oldest')}</option><option value="priority">{t('bugs.sort_priority')}</option></Form.Select>{filters.attention && <Button size="sm" variant="outline-primary" onClick={() => updateFilter('attention', '')}>{t(`incidencias.attention_${filters.attention}` as any)} <X size={14} /></Button>}</div><Row className="g-2">{filterDefinitions.map(([key, label, options]) => <Col className={['q', 'estado', 'prioridad'].includes(key) ? '' : 'incident-advanced-filter'} key={key} xs={12} sm={6} lg={key === 'q' ? 4 : 2}>{Array.isArray(options) ? entityFilterKeys.has(key) ? <SearchableEntityFilter id={key} label={label} value={filters[key as keyof typeof filters]} options={options} optionText={option => optionText(option, key)} onChange={value => updateFilter(key, value)} /> : <Form.Select name={key} aria-label={label} value={filters[key as keyof typeof filters]} onChange={event => updateFilter(key, event.target.value)}><option value="">{label}</option>{options.map((option: any) => <option key={option.id || option} value={option.id || option}>{optionText(option, key)}</option>)}</Form.Select> : <Form.Control name={key} type={options === 'date' ? 'date' : 'text'} autoComplete="off" maxLength={key === 'q' ? 200 : undefined} aria-label={label} placeholder={options === 'date' ? undefined : `${label}…`} value={filters[key as keyof typeof filters]} onChange={event => updateFilter(key, event.target.value)} />}</Col>)}</Row></Card.Body></Card>
    {error && <Alert variant="danger" dismissible onClose={() => setError('')} role="alert" aria-live="polite"><strong>{t('incidencias.loadError')}</strong><div className="small mt-1">{error}</div></Alert>}
    <Row className="g-4 align-items-start"><Col xl={12}><Card className="border-0 shadow-sm"><Card.Header className="bg-white d-flex justify-content-between align-items-center"><h2 className="h6 fw-bold mb-0">{t('incidencias.inbox')}</h2><span className="text-muted small" aria-live="polite">{total === 0 ? 0 : skip + 1}–{skip + items.length} / {total}</span></Card.Header><div className="incident-list">{loading ? <div className="incident-state" role="status"><Spinner size="sm" className="me-2" />{t('incidencias.loading')}</div> : items.length === 0 ? <div className="incident-state text-muted">{t('incidencias.empty')}</div> : items.map(item => <button type="button" className={`incident-row ${selected?.id === item.id ? 'is-selected' : ''}`} key={item.id} onClick={() => selectIncident(item)}><div className="d-flex justify-content-between gap-3"><div className="min-w-0"><div className="d-flex align-items-center gap-2 flex-wrap"><strong translate="no">{item.codigo}</strong><Badge bg={item.estado === 'BLOQUEADO' ? 'warning' : item.estado === 'LISTO_PARA_RETEST' ? 'success' : 'secondary'}>{optionLabel(item.estado, INCIDENT_STATUS_KEYS)}</Badge></div><div className="incident-row-title text-break">{item.titulo}</div><div className="d-flex gap-2 small my-1"><Badge bg="light" text="dark" className="border">{t('incidencias.severity')}: {optionLabel(item.severidad, INCIDENT_SEVERITY_KEYS)}</Badge><Badge bg="light" text="dark" className="border">{t('incidencias.priority')}: {optionLabel(item.prioridad, INCIDENT_PRIORITY_KEYS)}</Badge></div><div className="small text-muted text-truncate">{incidentCaseLabel(item) || t('incidencias.noCase')} · {incidentBuildLabel(item) || t('incidencias.noBuild')}</div></div><div className="text-end text-muted small text-nowrap"><div>{item.asignado_a ? userLabel(users.find(user => String(user.id) === String(item.asignado_a))) || t('bugs.unknownUser') : t('incidencias.unassigned')}</div><div>{item.created_at ? formatDateTime(item.created_at) : ''}</div></div></div></button>)}</div><Card.Footer className="bg-white d-flex justify-content-between align-items-center gap-2"><Button size="sm" variant="outline-secondary" disabled={!hasPreviousPage || loading} onClick={() => setSkip(Math.max(0, skip - pageSize))}>{t('incidencias.previous')}</Button><span className="small text-muted">{total === 0 ? 0 : Math.floor(skip / pageSize) + 1} / {Math.max(1, Math.ceil(total / pageSize))}</span><Button size="sm" variant="outline-secondary" disabled={!hasNextPage || loading} onClick={() => setSkip(skip + pageSize)}>{t('incidencias.next')}</Button></Card.Footer></Card></Col>{selected && <Col xl={12}><IncidentDetail key={selected.id} incident={selected} detail={detail} detailLoading={detailLoading} detailError={detailError} fetchWithAuth={fetchWithAuth} users={users} t={t} canAssign={canAssign} canEdit={canEdit} canTransition={canTransition} canResolve={canResolve} canClose={canClose} canDuplicate={canDuplicate} currentUserId={currentUserId} canExport={canExport} canComment={canComment} canAttach={canAttach} actionLoading={actionLoading} actionError={actionError} onAction={performAction} onReloadDetail={() => void loadDetail(selected)} onClose={() => { detailRequestRef.current++; setSelected(null); setActionError('') }} onUpdated={async (updated: any) => { if (selectedRef.current?.id === updated.id) { setSelected(updated); await loadDetail(updated) }; await load() }} onOpenCase={onOpenCase} onOpenExecution={onOpenExecution} /></Col>}</Row>
  </main><Modal show={showStatusHelp} onHide={() => setShowStatusHelp(false)} centered size="lg" scrollable><Modal.Header closeButton><Modal.Title className="fw-bold d-flex align-items-center gap-2"><Info size={20} />{t('bugs.statusModalTitle')}</Modal.Title></Modal.Header><Modal.Body><div className="small text-muted mb-3">{t('bugs.statusModalDescription')}</div><Row className="g-3">{bugStatusHelp.map(section => <Col md={section.group === 'activeGroup' ? 12 : 6} key={section.group}><Card className="border shadow-none h-100"><Card.Body><h6 className="fw-bold text-secondary mb-3">{t(`bugs.${section.group}` as any)}</h6><div className="d-flex flex-column gap-3">{section.items.map(([status, description]) => <div key={status} className="d-flex gap-3 align-items-start"><Badge bg={closedStates.has(status) ? 'secondary' : ['LISTO_PARA_RETEST', 'EN_RETEST'].includes(status) ? 'primary' : 'success'} className="mt-1 text-wrap text-start flex-shrink-0" style={{ width: 132, whiteSpace: 'normal', lineHeight: 1.2 }}>{t(`incidencias.${INCIDENT_STATUS_KEYS[status] || 'statusUnknown'}` as any)}</Badge><div className="small text-muted flex-grow-1">{t(`bugs.${description}` as any)}</div></div>)}</div></Card.Body></Card></Col>)}</Row></Modal.Body><Modal.Footer><Button variant="primary" onClick={() => setShowStatusHelp(false)}>{t('bugs.understood')}</Button></Modal.Footer></Modal></>
}


export default IncidentCenterPage
