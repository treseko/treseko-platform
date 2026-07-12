import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Card, Col, Dropdown, Form, ListGroup, Modal, Nav, ProgressBar, Row, Table } from 'react-bootstrap'
import {
  ArrowLeft,
  Building2,
  Bug,
  CheckCircle2,
  Edit,
  EyeOff,
  FileText,
  Folders,
  Info,
  History,
  Image as ImageIcon,
  KanbanSquare,
  Layers,
  Link,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings,
  Sliders,
  Terminal,
  Ticket,
  Trash2,
  Users
} from 'lucide-react'
import { firstUrlFromText } from '../../app/mappers'
import { API_BASE } from '../../app/constants'
import { PremiumGate } from '../premium/PremiumGate'
import { featureEnabled } from '../premium/featureAccess'
import { RequiredLabel } from '../../shared/ui/RequiredLabel'
import { dateTimeMs, formatDateTime, toDateTimeLocalInput } from '../../shared/utils/dateTime'

type ProyectosPageProps = any

export function ProyectosPage(props: ProyectosPageProps) {
  const {
    managingProjectId,
    setManagingProjectId,
    projectInnerTab,
    setProjectInnerTab,
    canAccessModule,
    canAccessCapability,
    handleCreateProject,
    organizations,
    projectsLoading,
    projectsList,
    currentOrgId,
    currentProjectId,
    componentsList,
    buildsList,
    handleProjectChange,
    handleUpdateProject,
    canEditCurrentProject,
    projectMembers,
    handleAddProjectMember,
    handleRemoveProjectMember,
    setComponentForm,
    setShowComponentModal,
    componentSearchQuery,
    setComponentSearchQuery,
    handleComponentChange,
    currentCompId,
    handleDeleteComponent,
    handleCreateBuild,
    sortBuildsNewestFirst,
    openBuildCasesModal,
    buildCaseIds,
    handleSetActiveBuild,
    handleSetInactiveBuild,
    handleToggleBuildHidden,
    handleDeleteBuild,
    handleUpdateBuildContext,
    environments,
    handleSaveProjectEnvironment,
    handleEditProjectEnvironment,
    handleDeleteProjectEnvironment,
    handleSaveEnvironmentDataset,
    handleUpdateEnvironmentDataset,
    handleSetDefaultEnvironmentDataset,
    handleDeleteEnvironmentDataset,
    wikiMode,
    setWikiMode,
    selectedWiki,
    setSelectedWiki,
    wikiFormData,
    setWikiFormData,
    wikiPages,
    handleDeleteWikiPage,
    handleSaveWikiPage,
    fetchWithAuth,
    showFeedback,
    hasSystemFeature,
    setActiveTab
  } = props
  const activeOrganizations = organizations.filter((org: any) => org.active !== false)
  const canUseCapability = canAccessCapability || ((capabilityId: string, level = 'read') => canAccessModule(capabilityId.split('.')[0], level))
  const canReadProjectPortfolio = canUseCapability('proyectos.portfolio', 'read')
  const canEditProjectPortfolio = canUseCapability('proyectos.portfolio', 'edit')
  const canReadProjectComponents = canUseCapability('proyectos.componentes', 'read')
  const canEditProjectComponents = canUseCapability('proyectos.componentes', 'edit')
  const canReadProjectBuilds = canUseCapability('proyectos.builds', 'read')
  const canEditProjectBuilds = canUseCapability('proyectos.builds', 'edit')
  const canReadProjectBuildScope = canUseCapability('proyectos.build_scope', 'read')
  const canReadProjectTeam = canUseCapability('proyectos.equipo', 'read')
  const canEditProjectTeam = canUseCapability('proyectos.equipo', 'edit')
  const canReadProjectEnvironments = canUseCapability('proyectos.ambientes', 'read')
  const canEditProjectEnvironments = canUseCapability('proyectos.ambientes', 'edit')
  const canReadProjectDatasets = canUseCapability('proyectos.datasets', 'read')
  const canEditProjectDatasets = canUseCapability('proyectos.datasets', 'edit')
  const canReadProjectWiki = canUseCapability('proyectos.wiki', 'read')
  const canEditProjectWiki = canUseCapability('proyectos.wiki', 'edit')
  const canReadProjectTickets = canUseCapability('redmine.vinculos', 'read') || canUseCapability('redmine.ver', 'read')
  const canEditProjectTickets = canUseCapability('redmine.reportar', 'edit') || canUseCapability('redmine.vinculos', 'edit')
  const reportSnapshotsEnabled = featureEnabled(hasSystemFeature, 'reports.snapshots', false)
  const canViewSharedReports = canUseCapability('reportes.compartir', 'read')
  const canEditProject = canEditCurrentProject && canEditProjectPortfolio
  const projectAdminTabs = [
    { id: 'config', label: canReadProjectTeam ? 'Configuracion & Equipo' : 'Configuracion', icon: Sliders, visible: canEditProjectPortfolio || canReadProjectTeam },
    { id: 'components', label: 'Componentes y Builds', icon: Layers, visible: canReadProjectComponents || canReadProjectBuilds || canReadProjectBuildScope },
    { id: 'envs', label: 'Ambientes y Datasets', icon: Server, visible: canReadProjectEnvironments || canReadProjectDatasets },
    { id: 'wiki', label: 'Wiki / Documentacion', icon: FileText, visible: canReadProjectWiki },
    { id: 'tickets', label: 'Tickets e Incidencias', icon: Ticket, visible: canReadProjectTickets },
  ].filter(tab => tab.visible)
  const projectEnvironments = environments.filter((env: any) => env.projectId === managingProjectId)
  const [showEnvironmentModal, setShowEnvironmentModal] = useState(false)
  const [editingEnvironment, setEditingEnvironment] = useState<any | null>(null)
  const [datasetFormEnvId, setDatasetFormEnvId] = useState<string | null>(null)
  const [datasetDrafts, setDatasetDrafts] = useState<Record<string, any>>({})
  const [savingDatasetId, setSavingDatasetId] = useState<string | null>(null)
  const [savedDatasetId, setSavedDatasetId] = useState<string | null>(null)
  const [bugIssues, setBugIssues] = useState<any[]>([])
  const [bugsLoading, setBugsLoading] = useState(false)
  const [bugForm, setBugForm] = useState({ titulo: '', descripcion: '', severidad: 'MEDIA', prioridad: 'MEDIA', componente_id: '', build_id: '' })
  const [showBuildCreateOptions, setShowBuildCreateOptions] = useState(false)
  const defaultBuildStartDate = toDateTimeLocalInput(new Date().toISOString())
  const [showProjectStatusHelp, setShowProjectStatusHelp] = useState(false)
  const [expandedBuildDetails, setExpandedBuildDetails] = useState<Record<string, boolean>>({})
  const [latestBuildReports, setLatestBuildReports] = useState<Record<string, { loading: boolean, loaded: boolean, item: any | null, items: any[] }>>({})
  const [projectBuildMetrics, setProjectBuildMetrics] = useState<Record<string, { loading: boolean, loaded: boolean, item: any | null }>>({})
  const latestBuildReportsRef = useRef(latestBuildReports)
  const projectBuildMetricsRef = useRef(projectBuildMetrics)

  useEffect(() => {
    latestBuildReportsRef.current = latestBuildReports
  }, [latestBuildReports])

  useEffect(() => {
    projectBuildMetricsRef.current = projectBuildMetrics
  }, [projectBuildMetrics])

  const reportCacheKey = (projectId?: string, buildId?: string) => projectId && buildId ? `${projectId}:${buildId}` : ''
  const metricNumber = (value: any, fallback = 0) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  const clampScore = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value))
  const calculateQaHealth = (metrics: any, fallbackHealth = 0) => {
    if (!metrics) {
      return fallbackHealth > 0
        ? { measured: true, score: Math.round(clampScore(fallbackHealth)), reason: 'Dato historico del proyecto.', variant: fallbackHealth >= 80 ? 'success' : fallbackHealth >= 50 ? 'warning' : 'danger' }
        : { measured: false, score: 0, reason: 'Ejecuta casos de la build activa para calcular salud QA.', variant: 'secondary' }
    }

    const totalAssigned = metricNumber(metrics.total_casos_asignados)
    const totalExecuted = metricNumber(metrics.total_ejecutados)
    if (totalAssigned <= 0 || totalExecuted <= 0) {
      return { measured: false, score: 0, reason: 'Ejecuta casos de la build activa para calcular salud QA.', variant: 'secondary' }
    }

    const stats = metrics.stats || {}
    const bugs = metrics.bug_metrics || {}
    const evidence = metrics.evidence_summary || {}
    const coverage = clampScore(metricNumber(metrics.cobertura_porcentaje))
    const successExecuted = clampScore(metricNumber(metrics.exito_sobre_ejecutados_porcentaje))
    const failed = metricNumber(stats.fallados)
    const blocked = metricNumber(stats.bloqueados)
    const openBugs = metricNumber(bugs.open)
    const highOpenBugs = metricNumber(bugs.high_open)
    const bugsWithoutEvidence = metricNumber(bugs.without_evidence)
    const missingEvidence = Math.max(metricNumber(evidence.missing), bugsWithoutEvidence)
    const evidenceTotal = Math.max(metricNumber(evidence.total), metricNumber(bugs.total), missingEvidence, 1)

    const executionPenaltyRatio = clampScore(((failed + blocked * 2) / totalAssigned) * 100)
    const executionQuality = clampScore(100 - executionPenaltyRatio)
    const bugPenalty = clampScore(highOpenBugs * 35 + Math.max(openBugs - highOpenBugs, 0) * 12)
    const bugQuality = clampScore(100 - bugPenalty)
    const evidenceQuality = clampScore(100 - (missingEvidence / evidenceTotal) * 100)

    let score = Math.round(
      coverage * 0.4
      + successExecuted * 0.3
      + executionQuality * 0.15
      + bugQuality * 0.1
      + evidenceQuality * 0.05
    )

    const qaState = String(metrics.qa_status?.state || '').toUpperCase()
    if (qaState === 'APROBADO') score = Math.max(score, 90)
    if (blocked > 0 || highOpenBugs > 0) score = Math.min(score, 69)
    if (qaState === 'NO_RECOMENDADO' || qaState === 'BLOQUEADO') score = Math.min(score, 49)
    score = Math.round(clampScore(score))

    const reason = blocked > 0
      ? `${blocked} casos bloqueados afectan la salud QA.`
      : highOpenBugs > 0
        ? `${highOpenBugs} bugs criticos/altos abiertos afectan la salud QA.`
        : failed > 0
          ? `${failed} casos fallidos reducen la salud QA.`
          : coverage < 90
            ? `Cobertura ${coverage}% sobre casos asignados.`
            : missingEvidence > 0
              ? `${missingEvidence} evidencias faltantes reducen trazabilidad.`
              : 'Basado en cobertura, resultados, bugs y evidencia de la build activa.'

    return {
      measured: true,
      score,
      reason,
      variant: score >= 80 ? 'success' : score >= 50 ? 'warning' : 'danger',
    }
  }
  const latestReportStatus = (item: any) => {
    if (!item?.activo) return { label: 'Revocado', variant: 'dark' }
    if (item?.is_latest) return { label: 'Vigente', variant: 'success' }
    return { label: 'Anterior', variant: 'secondary' }
  }

  const proxiedProjectReportUrl = (url: string) => {
    try {
      const parsed = new URL(url, window.location.origin)
      if (parsed.pathname.startsWith('/informes/')) {
        return `${parsed.pathname}${parsed.search}`
      }
      if (parsed.pathname.startsWith('/informes-internos/')) {
        const match = parsed.pathname.match(/^\/informes-internos\/[^/]+\/[^/]+\/[^/]+\/([^/?#]+?)(\.md)?$/)
        return match?.[1] ? `${API_BASE}/reports/internal/${encodeURIComponent(match[1])}${match[2] || ''}` : url
      }
      if (parsed.pathname.startsWith('/s/reports') || parsed.pathname.startsWith('/reports/internal')) {
        return `${API_BASE}${parsed.pathname}${parsed.search}`
      }
    } catch {
      return url
    }
    return url
  }

  const frontendProjectReportUrl = (url: string) => {
    try {
      const parsed = new URL(url, window.location.origin)
      if (parsed.pathname.startsWith('/informes/') || parsed.pathname.startsWith('/informes-internos/')) {
        return `${window.location.origin}${parsed.pathname}${parsed.search}`
      }
      if (parsed.pathname.startsWith('/s/reports') || parsed.pathname.startsWith('/reports/internal')) {
        return `${window.location.origin}${API_BASE}${parsed.pathname}${parsed.search}`
      }
    } catch {
      return url
    }
    return url
  }

  const isProjectInternalReportUrl = (url: string) => {
    try {
      const pathname = new URL(url, window.location.origin).pathname
      return pathname.startsWith('/reports/internal') || pathname.startsWith('/informes-internos/')
    } catch {
      return false
    }
  }

  const openProjectReportLink = async (url: string, type: string) => {
    if (!url) return
    if (type !== 'internal' && !isProjectInternalReportUrl(url)) {
      window.open(frontendProjectReportUrl(url), '_blank', 'noopener,noreferrer')
      return
    }

    const reportWindow = window.open('', '_blank')
    if (!reportWindow) {
      showFeedback?.('Popup bloqueado', 'Habilita ventanas emergentes para abrir el informe.', 'warning')
      return
    }
    reportWindow.opener = null
    reportWindow.document.write('<p style="font-family:Arial,sans-serif;padding:24px">Abriendo informe interno...</p>')
    try {
      const response = await fetchWithAuth(proxiedProjectReportUrl(url))
      if (!response.ok) throw new Error(await response.text())
      const html = await response.text()
      const baseTag = `<base href="${frontendProjectReportUrl(url).replace(/"/g, '&quot;')}">`
      const withBase = html.match(/<head[^>]*>/i)
        ? html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`)
        : html
      reportWindow.document.open()
      reportWindow.document.write(withBase)
      reportWindow.document.close()
      reportWindow.opener = null
    } catch (error: any) {
      reportWindow.close()
      showFeedback?.('No se pudo abrir', error?.message || 'No se pudo abrir el informe compartido.', 'danger')
    }
  }
  const goToReports = (projectId: string) => {
    handleProjectChange(projectId)
    setActiveTab?.('reportes')
  }
  const reportButtonLabel = (type: 'executive' | 'development' | 'internal') => (
    type === 'executive' ? 'Ejecutivo' : type === 'development' ? 'Desarrollo' : 'Interno'
  )

  const loadProjectBugs = async () => {
    if (!managingProjectId || !fetchWithAuth) return
    setBugsLoading(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${managingProjectId}/bugs`)
      if (!response.ok) throw new Error(await response.text())
      const payload = await response.json()
      setBugIssues(Array.isArray(payload) ? payload : (payload.items || []))
    } catch (error: any) {
      showFeedback?.('No se pudieron cargar bugs', error?.message || 'Revisa permisos del proyecto.', 'danger')
    } finally {
      setBugsLoading(false)
    }
  }

  useEffect(() => {
    if (!fetchWithAuth || !reportSnapshotsEnabled || !canViewSharedReports) return
    const targetMap = new Map<string, { projectId: string, buildId: string, key: string }>()
    projectsList
      .filter((project: any) => project.orgId === currentOrgId)
      .forEach((project: any) => {
        const projectBuilds = sortBuildsNewestFirst(buildsList.filter((build: any) => build.projectId === project.id))
        const activeBuild = projectBuilds.find((build: any) => build.active && !build.hidden)
          || projectBuilds.find((build: any) => build.active)
          || projectBuilds[0]
        const key = reportCacheKey(project.id, activeBuild?.id)
        if (activeBuild?.id && key) targetMap.set(key, { projectId: project.id, buildId: activeBuild.id, key })
      })

    if (managingProjectId && currentCompId) {
      sortBuildsNewestFirst(buildsList.filter((build: any) => build.projectId === managingProjectId && build.componentId === currentCompId))
        .forEach((build: any) => {
          const key = reportCacheKey(managingProjectId, build.id)
          if (key) targetMap.set(key, { projectId: managingProjectId, buildId: build.id, key })
        })
    }

    const targets = Array.from(targetMap.values())

    const missingTargets = targets.filter((target: any) => {
      const cached = latestBuildReportsRef.current[target.key]
      return !cached?.loading && !cached?.loaded
    })
    if (missingTargets.length === 0) return

    setLatestBuildReports(current => {
      const next = { ...current }
      missingTargets.forEach((target: any) => {
        next[target.key] = { loading: true, loaded: false, item: null, items: [] }
      })
      return next
    })

    missingTargets.forEach(async (target: any) => {
      try {
        const params = new URLSearchParams({ proyecto_id: target.projectId })
        params.set('build_id', target.buildId)
        const response = await fetchWithAuth(`${API_BASE}/reports/share/history?${params.toString()}`)
        if (!response.ok) throw new Error(await response.text())
        const items = await response.json()
        const reportItems = Array.isArray(items) ? items : []
        const latestReport = reportItems.find((item: any) => item?.activo) || reportItems[0] || null
        setLatestBuildReports(current => ({
          ...current,
          [target.key]: { loading: false, loaded: true, item: latestReport, items: reportItems },
        }))
      } catch {
        setLatestBuildReports(current => ({
          ...current,
          [target.key]: { loading: false, loaded: true, item: null, items: [] },
        }))
      }
    })
  }, [fetchWithAuth, reportSnapshotsEnabled, canViewSharedReports, projectsList, buildsList, currentOrgId, managingProjectId, currentCompId, sortBuildsNewestFirst])

  useEffect(() => {
    if (!fetchWithAuth) return
    const targets = projectsList
      .filter((project: any) => project.orgId === currentOrgId)
      .map((project: any) => {
        const projectBuilds = sortBuildsNewestFirst(buildsList.filter((build: any) => build.projectId === project.id))
        const activeBuild = projectBuilds.find((build: any) => build.active && !build.hidden)
          || projectBuilds.find((build: any) => build.active)
          || projectBuilds[0]
        const key = reportCacheKey(project.id, activeBuild?.id)
        return { projectId: project.id, buildId: activeBuild?.id, key }
      })
      .filter((target: any) => target.projectId && target.buildId && target.key)

    const missingTargets = targets.filter((target: any) => {
      const cached = projectBuildMetricsRef.current[target.key]
      return !cached?.loading && !cached?.loaded
    })
    if (missingTargets.length === 0) return

    setProjectBuildMetrics(current => {
      const next = { ...current }
      missingTargets.forEach((target: any) => {
        next[target.key] = { loading: true, loaded: false, item: null }
      })
      return next
    })

    missingTargets.forEach(async (target: any) => {
      try {
        const params = new URLSearchParams({ build_id: target.buildId })
        const response = await fetchWithAuth(`${API_BASE}/proyectos/${target.projectId}/metrics/?${params.toString()}`)
        if (!response.ok) throw new Error(await response.text())
        const metrics = await response.json()
        setProjectBuildMetrics(current => ({
          ...current,
          [target.key]: { loading: false, loaded: true, item: metrics },
        }))
      } catch {
        setProjectBuildMetrics(current => ({
          ...current,
          [target.key]: { loading: false, loaded: true, item: null },
        }))
      }
    })
  }, [fetchWithAuth, projectsList, buildsList, currentOrgId, sortBuildsNewestFirst])

  useEffect(() => {
    if (projectInnerTab === 'tickets') loadProjectBugs()
  }, [projectInnerTab, managingProjectId])

  useEffect(() => {
    if (!managingProjectId) return
    if (projectAdminTabs.length === 0) {
      setManagingProjectId(null)
      return
    }
    if (!projectAdminTabs.some(tab => tab.id === projectInnerTab)) {
      setProjectInnerTab(projectAdminTabs[0].id)
    }
  }, [managingProjectId, projectInnerTab, setProjectInnerTab, projectAdminTabs.map(tab => tab.id).join('|')])

  const createBugIssue = async (event: any) => {
    event.preventDefault()
    if (!bugForm.titulo.trim() || !managingProjectId) return
    try {
      const response = await fetchWithAuth(`${API_BASE}/bugs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proyecto_id: managingProjectId,
          componente_id: bugForm.componente_id || null,
          build_id: bugForm.build_id || null,
          titulo: bugForm.titulo.trim(),
          descripcion: bugForm.descripcion.trim(),
          severidad: bugForm.severidad,
          prioridad: bugForm.prioridad,
          origen: 'manual',
        }),
      })
      if (!response.ok) throw new Error(await response.text())
      setBugForm({ titulo: '', descripcion: '', severidad: 'MEDIA', prioridad: 'MEDIA', componente_id: '', build_id: '' })
      showFeedback?.('Bug creado', 'El bug interno quedo asociado al proyecto.', 'success')
      await loadProjectBugs()
    } catch (error: any) {
      showFeedback?.('No se pudo crear el bug', error?.message || 'Revisa los datos.', 'danger')
    }
  }

  const updateBugIssue = async (bug: any, changes: any) => {
    try {
      const response = await fetchWithAuth(`${API_BASE}/bugs/${bug.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
      if (!response.ok) throw new Error(await response.text())
      await loadProjectBugs()
    } catch (error: any) {
      showFeedback?.('No se pudo actualizar', error?.message || 'Revisa permisos.', 'danger')
    }
  }
  const environmentVariablesText = (env?: any) =>
    Object.entries(env?.variables || {})
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('\n')
  const formatBuildDuration = (durationMin: number | null) => {
    if (durationMin === null || durationMin < 0) return null
    const hours = Math.floor(durationMin / 60)
    const days = Math.floor(hours / 24)
    const months = Math.floor(days / 30)
    const years = Math.floor(days / 365)
    if (durationMin < 60) return `${durationMin} min`
    if (hours < 24) return `${hours}h ${durationMin % 60}min`
    if (days < 30) return `${days}d ${hours % 24}h`
    if (months < 12) return `${months}m ${days % 30}d`
    return `${years}a ${months % 12}m`
  }
  const buildWindowState = (build: any) => {
    const now = Date.now()
    const start = dateTimeMs(build.startDate)
    const end = dateTimeMs(build.endDate)
    if (!build.active) {
      if (!build.startDate && !build.endDate) return { label: 'Histórica', variant: 'primary', progress: null, detail: 'Sin ventana' }
      const durationMin = start && end && end > start ? Math.round((end - start) / 60000) : null
      const durStr = formatBuildDuration(durationMin)
      return {
        label: 'Finalizada',
        variant: 'primary',
        progress: start && end && end > start ? 100 : null,
        detail: durStr ? `Duracion ${durStr}` : 'Ventana parcial'
      }
    }
    if (!build.startDate && !build.endDate) return { label: 'Sin ventana', variant: 'secondary', progress: null, detail: 'No definida' }
    if (start && now < start) return { label: 'No iniciada', variant: 'info', progress: 0, detail: 'Pendiente de inicio' }
    if (end && now > end) return { label: 'Vencida', variant: 'danger', progress: 100, detail: 'Fuera de ventana' }
    if (start && end && end > start) {
      const progress = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)))
      const remainingDays = Math.max(0, Math.ceil((end - now) / 86400000))
      return { label: 'En curso', variant: 'success', progress, detail: `${remainingDays} dia(s) restantes` }
    }
    return { label: 'En curso', variant: 'success', progress: null, detail: 'Ventana parcial' }
  }
  const projectInitials = (name: string) => String(name || 'PR')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'PR'
  const projectStatusVariant = (status?: string) => {
    const normalized = String(status || '').toLowerCase()
    if (normalized === 'activo') return 'success'
    if (normalized === 'en qa') return 'primary'
    if (normalized === 'planificacion') return 'secondary'
    if (normalized === 'bloqueado') return 'danger'
    if (normalized === 'mantenimiento') return 'info'
    if (normalized === 'cerrado') return 'dark'
    if (normalized === 'archivado') return 'light'
    return 'warning'
  }
  const projectStatusHelpItems = [
    { status: 'Planificacion', summary: 'Proyecto creado y en armado inicial.', restriction: 'Permite configurar equipo, componentes, builds y ambientes; las ejecuciones se bloquearan en una futura regla.' },
    { status: 'Activo', summary: 'Trabajo normal del proyecto.', restriction: 'Permite cambios operativos, ejecuciones, bugs y gestion completa segun permisos.' },
    { status: 'En QA', summary: 'Proyecto en ciclo activo de pruebas.', restriction: 'Permite operacion normal enfocada en ejecucion QA y seguimiento de evidencia.' },
    { status: 'Bloqueado', summary: 'Hay una dependencia o incidente que impide avanzar.', restriction: 'Se bloquearan ejecuciones, bugs operativos y cambios sensibles.' },
    { status: 'Mantenimiento', summary: 'Ventana de ajuste tecnico o administrativo.', restriction: 'Se bloquearan ejecuciones y cambios operativos sensibles.' },
    { status: 'En Pausa', summary: 'Proyecto temporalmente detenido.', restriction: 'Se bloquearan ejecuciones y cambios operativos sensibles.' },
    { status: 'Cerrado', summary: 'Proyecto finalizado.', restriction: 'Solo lectura en una futura regla.' },
    { status: 'Archivado', summary: 'Proyecto historico u ocultable del flujo principal.', restriction: 'Solo lectura y ocultable en una futura regla.' },
  ]
  const datasetToDraft = (dataset: any) => ({
    name: dataset.name || '',
    description: dataset.description || '',
    variablesText: Object.entries(dataset.variables || {}).map(([key, value]) => `${key}=${String(value)}`).join('\n'),
    isDefault: Boolean(dataset.isDefault)
  })
  const serializeDatasetDraft = (draft: any) => JSON.stringify({
    name: String(draft?.name || '').trim(),
    description: String(draft?.description || '').trim(),
    variablesText: String(draft?.variablesText || '').trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean).join('\n'),
    isDefault: Boolean(draft?.isDefault)
  })
  const getDatasetDraft = (dataset: any) => datasetDrafts[dataset.id] || datasetToDraft(dataset)
  const isDatasetDraftDirty = (dataset: any) => serializeDatasetDraft(getDatasetDraft(dataset)) !== serializeDatasetDraft(datasetToDraft(dataset))
  const updateDatasetDraft = (dataset: any, changes: any) => {
    setDatasetDrafts(prev => ({
      ...prev,
      [dataset.id]: {
        ...getDatasetDraft(dataset),
        ...changes
      }
    }))
    if (savedDatasetId === dataset.id) setSavedDatasetId(null)
  }
  const handleDatasetSubmit = async (event: any, envId: string, dataset: any) => {
    event.preventDefault()
    if (!isDatasetDraftDirty(dataset) || savingDatasetId) return
    setSavingDatasetId(dataset.id)
    const ok = await handleUpdateEnvironmentDataset(event, envId, dataset.id)
    setSavingDatasetId(null)
    if (!ok) return
    setDatasetDrafts(prev => {
      const next = { ...prev }
      delete next[dataset.id]
      return next
    })
    setSavedDatasetId(dataset.id)
    window.setTimeout(() => {
      setSavedDatasetId(current => current === dataset.id ? null : current)
    }, 2200)
  }
  const openEnvironmentModal = (env: any | null = null) => {
    setEditingEnvironment(env)
    setShowEnvironmentModal(true)
  }
  const closeEnvironmentModal = () => {
    setShowEnvironmentModal(false)
    setEditingEnvironment(null)
  }
  const submitEnvironmentModal = async (event: any) => {
    if (editingEnvironment) {
      await handleEditProjectEnvironment(editingEnvironment.id, event)
    } else {
      await handleSaveProjectEnvironment(event)
    }
    closeEnvironmentModal()
  }

  return (
    <div className="projects-page p-4 animate__animated animate__fadeIn text-dark text-start bg-light h-100 overflow-hidden d-flex flex-column">

          {/* VISTA 1: GRID DE PROYECTOS */}
          {!managingProjectId ? (
            <div className="d-flex flex-column h-100 overflow-hidden">
              <div className="responsive-page-toolbar d-flex justify-content-between align-items-center mb-4 flex-shrink-0">
                <h4 className="fw-bold text-primary m-0 d-flex align-items-center gap-2">
                  <Folders size={28} /> Portafolio de Proyectos
                </h4>

                {canEditProjectPortfolio && (
                  <Form className="project-create-form d-flex align-items-center bg-white p-1 rounded-pill shadow-sm border border-light-subtle" onSubmit={handleCreateProject}>
                    <Form.Select name="orgSelect" size="sm" className="border-0 shadow-none bg-transparent text-secondary fw-bold ms-2" style={{ width: '160px' }}>
                      {activeOrganizations.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </Form.Select>
                    <div className="vr text-muted opacity-25 my-2"></div>
                    <Form.Control name="projName" size="sm" type="text" placeholder="Nuevo proyecto *..." className="border-0 shadow-none bg-transparent text-dark px-3" required />
                    <Button type="submit" variant="primary" size="sm" className="fw-bold text-nowrap rounded-pill px-4 shadow-sm" disabled={projectsLoading}>
                      {projectsLoading ? 'Sync...' : '+ Crear'}
                    </Button>
                  </Form>
                )}
              </div>

              <Row className="g-4 text-start overflow-auto pb-4 flex-grow-1">
                {projectsList.filter(p => p.orgId === currentOrgId).map(p => {
                  const orgName = organizations.find(o => o.id === p.orgId)?.name || 'Cliente general';
                  const isSelected = currentProjectId === p.id;
                  const projectComponents = componentsList.filter(c => c.projectId === p.id);
                  const projectBuilds = sortBuildsNewestFirst(buildsList.filter(b => b.projectId === p.id));
                  const activeBuild = projectBuilds.find(b => b.active && !b.hidden) || projectBuilds.find(b => b.active) || projectBuilds[0];
                  const activeBuildWindow = activeBuild ? buildWindowState(activeBuild) : null;
                  const activeBuildReportKey = reportCacheKey(p.id, activeBuild?.id);
                  const activeBuildReport = activeBuildReportKey ? latestBuildReports[activeBuildReportKey] : null;
                  const latestReport = activeBuildReport?.item;
                  const latestReportStatusInfo = latestReportStatus(latestReport);
                  const activeBuildMetrics = activeBuildReportKey ? projectBuildMetrics[activeBuildReportKey] : null;
                  const healthInfo = activeBuildMetrics?.loading
                    ? { measured: false, score: 0, reason: 'Calculando salud QA de la build activa...', variant: 'secondary', loading: true }
                    : calculateQaHealth(activeBuildMetrics?.item, Number(p.health || 0));
                  const projectEnvs = environments.filter((env: any) => env.projectId === p.id);
                  const memberCount = projectMembers.filter((member: any) => member.projectId === p.id).length || p.team || 0;
                  const hiddenBuilds = projectBuilds.filter(b => b.hidden).length;
                  const openProjectSection = (tabId: string) => {
                    handleProjectChange(p.id);
                    setManagingProjectId(p.id);
                    setProjectInnerTab(tabId);
                  };

                  return (
                    <Col xl={4} lg={6} key={p.id}>
                      <Card className={`project-portfolio-card border-0 shadow-sm rounded-4 h-100 d-flex flex-column transition-all ${isSelected ? 'ring-2 ring-primary shadow-lg' : ''}`} style={isSelected ? { outline: '2px solid #0d6efd', outlineOffset: '-2px' } : {}}>
                        <div className="p-4 bg-white border-bottom rounded-top-4 flex-shrink-0">
                          <div className="d-flex justify-content-between align-items-start mb-2">
                            <span className="badge bg-light text-secondary border fw-bold small"><Building2 size={10} className="me-1 mb-0.5" /> {orgName}</span>
                            <Badge bg={projectStatusVariant(p.status)} text={projectStatusVariant(p.status) === 'light' ? 'secondary' : undefined} className="shadow-sm">{p.status}</Badge>
                          </div>
                          <div className="d-flex align-items-center gap-3 min-w-0">
                            <div className="project-avatar flex-shrink-0">
                              {p.imageUrl ? (
                                <img src={p.imageUrl} alt={p.name} onError={(event) => { event.currentTarget.style.display = 'none' }} />
                              ) : (
                                <span>{projectInitials(p.name)}</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <h5 className="fw-bold text-dark mb-1 text-truncate" title={p.name}>{p.name}</h5>
                              <span className="text-muted x-small font-monospace">ID: {p.id.toUpperCase()}</span>
                            </div>
                          </div>
                        </div>

                        <div className="p-4 bg-light flex-grow-1 d-flex flex-column gap-3">
                          <div className="project-portfolio-health bg-white p-3 rounded-3 shadow-sm border border-light-subtle">
                            {healthInfo.measured ? (
                              <>
                                <div className="d-flex justify-content-between align-items-end mb-2">
                                  <span className="text-secondary fw-bold x-small text-uppercase">Salud del proyecto</span>
                                  <span className={`text-${healthInfo.variant} fw-bolder fs-6 lh-1`}>{healthInfo.score}%</span>
                                </div>
                                <ProgressBar now={healthInfo.score} variant={healthInfo.variant as any} style={{ height: '7px' }} className="rounded-pill bg-secondary bg-opacity-10" />
                                <div className="text-muted x-small mt-2">{healthInfo.reason}</div>
                              </>
                            ) : (
                              <div>
                                <div className="d-flex justify-content-between align-items-center mb-2">
                                  <span className="text-secondary fw-bold x-small text-uppercase">Salud del proyecto</span>
                                  <Badge bg="light" text="secondary" className="border">{(healthInfo as any).loading ? 'Calculando' : 'Sin medicion'}</Badge>
                                </div>
                                <div className="text-muted x-small">{activeBuild ? healthInfo.reason : 'Crea o activa una build para calcular salud QA.'}</div>
                              </div>
                            )}
                          </div>

                          <div className="project-portfolio-kpis">
                            <div className="project-portfolio-kpi">
                              <Layers size={16} className="text-primary" />
                              <span className="fw-bold text-dark">{projectComponents.length}</span>
                              <span>Componentes</span>
                            </div>
                            <div className="project-portfolio-kpi">
                              <Terminal size={16} className="text-success" />
                              <span className="fw-bold text-dark">{projectBuilds.length}</span>
                              <span>Builds</span>
                            </div>
                            <div className="project-portfolio-kpi">
                              <Server size={16} className="text-info" />
                              <span className="fw-bold text-dark">{projectEnvs.length}</span>
                              <span>Ambientes</span>
                            </div>
                            <div className="project-portfolio-kpi">
                              <Users size={16} className="text-secondary" />
                              <span className="fw-bold text-dark">{memberCount}</span>
                              <span>QAs</span>
                            </div>
                          </div>

                          <div className="project-portfolio-build bg-white rounded-3 border border-light-subtle p-3">
                            <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                              <div className="min-w-0">
                                <div className="x-small fw-bold text-secondary text-uppercase mb-1">Build operativa</div>
                                <div className="fw-bold text-dark text-truncate font-monospace" title={activeBuild?.name || 'Sin build'}>{activeBuild?.name || 'Sin build activa'}</div>
                              </div>
                              {activeBuild ? (
                                <Badge bg={activeBuild.active ? 'success' : 'light'} text={activeBuild.active ? undefined : 'secondary'} className={activeBuild.active ? '' : 'border'}>
                                  {activeBuild.active ? 'Activa' : 'Historica'}
                                </Badge>
                              ) : (
                                <Badge bg="light" text="secondary" className="border">Pendiente</Badge>
                              )}
                            </div>
                            {activeBuildWindow ? (
                              <>
                                <div className="d-flex justify-content-between align-items-center x-small text-muted">
                                  <span>{activeBuildWindow.detail}</span>
                                  <Badge bg={activeBuildWindow.variant as any}>{activeBuildWindow.label}</Badge>
                                </div>
                                {activeBuildWindow.progress !== null && <ProgressBar now={activeBuildWindow.progress} variant={activeBuildWindow.variant as any} className="project-portfolio-build-progress mt-2" />}
                              </>
                            ) : (
                              <div className="x-small text-muted">Crea una build para empezar a ordenar alcance, ejecuciones y evidencias.</div>
                            )}
                            <div className="border-top pt-2 mt-3">
                              <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                                <span className="x-small fw-bold text-secondary text-uppercase d-flex align-items-center gap-1">
                                  <Link size={13} /> Ultimo reporte compartido
                                </span>
                                {reportSnapshotsEnabled && canViewSharedReports && latestReport && (
                                  <Badge bg={latestReportStatusInfo.variant as any}>{latestReportStatusInfo.label}</Badge>
                                )}
                              </div>
                              {reportSnapshotsEnabled && canViewSharedReports ? (
                                activeBuild ? (
                                  activeBuildReport?.loading ? (
                                    <div className="x-small text-muted">Cargando ultimo reporte...</div>
                                  ) : latestReport ? (
                                    <div className="d-flex flex-column gap-2">
                                      <div className="x-small text-muted">
                                        Snapshot {formatDateTime(latestReport.created_at)}
                                      </div>
                                      <div className="d-flex flex-wrap gap-1">
                                        {(['executive', 'development', 'internal'] as const).map(type => (
                                          latestReport.links?.[type] ? (
                                            <Button key={type} type="button" variant="outline-primary" size="sm" className="px-2 py-0 x-small" onClick={() => openProjectReportLink(latestReport.links[type], type)}>
                                              {type === 'executive' ? 'Ejecutivo' : type === 'development' ? 'Desarrollo' : 'Interno'}
                                            </Button>
                                          ) : null
                                        ))}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="d-flex align-items-center justify-content-between gap-2">
                                      <span className="x-small text-muted">Sin reporte compartido para esta build</span>
                                      <Button type="button" variant="link" size="sm" className="p-0 x-small fw-bold" onClick={() => goToReports(p.id)}>
                                        Ir a Reportes
                                      </Button>
                                    </div>
                                  )
                                ) : (
                                  <div className="x-small text-muted">Crea una build para generar reportes compartidos.</div>
                                )
                              ) : (
                                <PremiumGate
                                  feature="reports.snapshots"
                                  hasFeature={hasSystemFeature}
                                  title="Reportes compartidos por build"
                                  description="Reportes compartidos por build disponibles en Treseko Premium."
                                  mode="inline"
                                  className="py-2"
                                />
                              )}
                            </div>
                          </div>

                          <div className="project-portfolio-activity">
                            <div className="d-flex align-items-center justify-content-between gap-2">
                              <span className="d-flex align-items-center gap-2 text-muted x-small"><History size={14} /> Estado operativo</span>
                              <span className="fw-bold x-small text-dark">{hiddenBuilds > 0 ? `${hiddenBuilds} build(s) ocultas` : 'Sin builds ocultas'}</span>
                            </div>
                            <div className="d-flex align-items-center justify-content-between gap-2">
                              <span className="d-flex align-items-center gap-2 text-muted x-small"><Bug size={14} /> Incidencias</span>
                              <span className="fw-bold x-small text-dark">Ver en gestion</span>
                            </div>
                          </div>
                        </div>

                        <div className="project-portfolio-actions p-3 bg-white border-top rounded-bottom-4 d-flex gap-2">
                          <Button variant={isSelected ? "primary" : "outline-secondary"} size="sm" onClick={() => handleProjectChange(p.id)} className={`fw-bold rounded-pill flex-grow-1 ${isSelected ? 'pointer-events-none' : ''}`}>
                            {isSelected ? 'Activo' : 'Activar'}
                          </Button>
                          {(canReadProjectComponents || canReadProjectBuilds || canReadProjectBuildScope) && (
                            <Button variant="outline-primary" size="sm" onClick={() => openProjectSection('components')} className="fw-bold rounded-pill px-3 d-flex align-items-center gap-1 shadow-sm">
                              <Terminal size={14} /> Builds
                            </Button>
                          )}
                          {projectAdminTabs.length > 0 && (
                            <Button variant="dark" size="sm" onClick={() => openProjectSection(projectAdminTabs[0]?.id || 'config')} className="fw-bold rounded-pill px-3 d-flex align-items-center gap-1 shadow-sm">
                              <Settings size={14} /> Gestionar
                            </Button>
                          )}
                        </div>
                      </Card>
                    </Col>
                  );
                })}
              </Row>
            </div>
          ) : (
            /* VISTA 2: ADMINISTRACIÓN DETALLADA DEL PROYECTO */
            <div className="d-flex flex-column h-100 overflow-hidden bg-white border rounded-4 shadow-sm">

              {/* Header del Admin de Proyecto */}
              <div className="p-3 border-bottom d-flex align-items-center gap-3 bg-light flex-shrink-0">
                <Button variant="white" size="sm" className="border shadow-sm rounded-circle p-2" onClick={() => setManagingProjectId(null)}>
                  <ArrowLeft size={18} className="text-dark" />
                </Button>
                <div className="project-avatar project-avatar-sm flex-shrink-0">
                  {projectsList.find(p => p.id === managingProjectId)?.imageUrl ? (
                    <img src={projectsList.find(p => p.id === managingProjectId)?.imageUrl} alt={projectsList.find(p => p.id === managingProjectId)?.name || 'Proyecto'} onError={(event) => { event.currentTarget.style.display = 'none' }} />
                  ) : (
                    <span>{projectInitials(projectsList.find(p => p.id === managingProjectId)?.name || 'Proyecto')}</span>
                  )}
                </div>
                <div>
                  <h5 className="m-0 fw-bold text-dark d-flex align-items-center gap-2">
                    {projectsList.find(p => p.id === managingProjectId)?.name}
                    <Badge
                      bg={projectStatusVariant(projectsList.find(p => p.id === managingProjectId)?.status)}
                      text={projectStatusVariant(projectsList.find(p => p.id === managingProjectId)?.status) === 'light' ? 'secondary' : undefined}
                      className="x-small"
                    >
                      {projectsList.find(p => p.id === managingProjectId)?.status || 'Activo'}
                    </Badge>
                  </h5>
                  <span className="text-muted small">Panel de Administración Integral del Proyecto</span>
                </div>
              </div>

              {/* Layout de pestañas y contenido */}
              <div className="project-admin-layout d-flex flex-grow-1 overflow-hidden">

                {/* Menú lateral interno */}
                <div className="project-admin-nav border-end bg-light p-3" style={{ width: '240px', minWidth: '240px' }}>
                  <Nav className="flex-column gap-2">
                    {projectAdminTabs.map(tab => {
                      const Icon = tab.icon
                      return (
                        <Button key={tab.id} variant={projectInnerTab === tab.id ? 'primary' : 'transparent'} className={`text-start fw-bold small border-0 shadow-none px-3 py-2 rounded-3 ${projectInnerTab !== tab.id ? 'text-secondary hover-bg-white' : ''}`} onClick={() => setProjectInnerTab(tab.id)}>
                          <Icon size={16} className="me-2" /> {tab.label}
                        </Button>
                      )
                    })}
                  </Nav>
                </div>

                {/* Contenido dinámico */}
                <div className="flex-grow-1 p-4 overflow-auto bg-white">

                  {/* SUB-TAB: CONFIGURACIÓN Y EQUIPO */}
                  {projectInnerTab === 'config' && (canEditProjectPortfolio || canReadProjectTeam) && (
                    <div className="animate__animated animate__fadeIn">
                      <h5 className="fw-bold text-dark mb-4 border-bottom pb-2">{canReadProjectTeam ? 'Información y Equipo' : 'Información'}</h5>
                      <Row className="g-2">
                        {canEditProjectPortfolio && (
                        <Col md={canReadProjectTeam ? 6 : 12}>
                          <Card className="border-0 shadow-sm bg-light">
                            <Form onSubmit={handleUpdateProject}>
                            <Card.Body>
                              <div className="d-flex align-items-center gap-3 mb-3">
                                <div className="project-avatar">
                                  {projectsList.find(p => p.id === managingProjectId)?.imageUrl ? (
                                    <img src={projectsList.find(p => p.id === managingProjectId)?.imageUrl} alt={projectsList.find(p => p.id === managingProjectId)?.name || 'Proyecto'} onError={(event) => { event.currentTarget.style.display = 'none' }} />
                                  ) : (
                                    <ImageIcon size={22} className="text-primary" />
                                  )}
                                </div>
                                <div>
                                  <div className="fw-bold small text-dark">Identidad visual</div>
                                  <div className="text-muted x-small">Usa una URL publica de logo o foto del proyecto.</div>
                                </div>
                              </div>
                              <Form.Group className="mb-3">
                                <Form.Label className="small fw-bold text-muted"><RequiredLabel required>Nombre del Proyecto</RequiredLabel></Form.Label>
                                <Form.Control name="projectName" type="text" defaultValue={projectsList.find(p => p.id === managingProjectId)?.name} className="fw-bold text-dark border-light-subtle" required disabled={!canEditProject} />
                              </Form.Group>
                              <Form.Group className="mb-3">
                                <Form.Label className="small fw-bold text-muted">Logo o foto del proyecto</Form.Label>
                                <Form.Control name="projectImageUrl" type="url" placeholder="https://..." defaultValue={projectsList.find(p => p.id === managingProjectId)?.imageUrl || ''} className="border-light-subtle" disabled={!canEditProject} />
                              </Form.Group>
                              <Form.Group className="mb-3">
                                <div className="d-flex align-items-center justify-content-between gap-2 mb-1">
                                  <Form.Label className="small fw-bold text-muted mb-0">Estado Actual</Form.Label>
                                  <Button
                                    type="button"
                                    variant="link"
                                    size="sm"
                                    className="project-status-help-btn p-0 text-primary shadow-none"
                                    onClick={() => setShowProjectStatusHelp(true)}
                                    title="Ver significado de estados"
                                    aria-label="Ver significado de estados"
                                  >
                                    <Info size={16} />
                                  </Button>
                                </div>
                                <Form.Select name="projectStatus" className="border-light-subtle" defaultValue={projectsList.find(p => p.id === managingProjectId)?.status || 'Activo'} disabled={!canEditProject}>
                                  <option>Planificacion</option>
                                  <option>Activo</option>
                                  <option>En QA</option>
                                  <option>Bloqueado</option>
                                  <option>Mantenimiento</option>
                                  <option>En Pausa</option>
                                  <option>Cerrado</option>
                                  <option>Archivado</option>
                                </Form.Select>
                              </Form.Group>
                              {canEditProject && (
                                <Button type="submit" variant="primary" size="sm" className="fw-bold px-4 rounded-pill shadow-sm">Guardar Cambios</Button>
                              )}
                            </Card.Body>
                            </Form>
                          </Card>
                        </Col>
                        )}
                        {canReadProjectTeam && (
                        <Col md={6}>
                          <Card className="border-0 shadow-sm bg-light h-100">
                            <Card.Body>
                              <div className="d-flex justify-content-between align-items-center mb-3">
                                <span className="small fw-bold text-muted text-uppercase">Equipo Asignado</span>
                                {canEditProjectTeam && (
                                  <Button variant="outline-primary" size="sm" className="x-small fw-bold py-1 px-2" onClick={handleAddProjectMember}>+ Asignar usuario</Button>
                                )}
                              </div>
                              <ListGroup variant="flush" className="border rounded-3 overflow-hidden">
                                {projectMembers.filter(member => member.projectId === managingProjectId).map(member => (
                                  <ListGroup.Item key={member.id} className="d-flex justify-content-between align-items-center py-2 px-3 bg-white">
                                    <div>
                                      <div className="fw-bold small text-dark">{member.user?.name || member.userId}</div>
                                      <div className="x-small text-muted">{member.user?.email || 'Usuario backend'}</div>
                                    </div>
                                    <div className="d-flex align-items-center gap-2">
                                      {canEditProjectTeam && (
                                        <Button variant="link" size="sm" className="text-danger p-0 shadow-none" title="Quitar del proyecto" onClick={() => handleRemoveProjectMember(member.userId)}><Trash2 size={14} /></Button>
                                      )}
                                    </div>
                                  </ListGroup.Item>
                                ))}
                                {projectMembers.filter(member => member.projectId === managingProjectId).length === 0 && (
                                  <ListGroup.Item className="text-center py-4 text-muted small bg-white">
                                    Sin miembros asignados. Usa + Asignar usuario para vincular usuarios existentes.
                                  </ListGroup.Item>
                                )}
                              </ListGroup>
                            </Card.Body>
                          </Card>
                        </Col>
                        )}
                      </Row>
                    </div>
                  )}

                  {/* SUB-TAB: COMPONENTES Y BUILDS (NUEVO DISEÑO MASTER-DETAIL) */}
                      {projectInnerTab === 'components' && (canReadProjectComponents || canReadProjectBuilds || canReadProjectBuildScope) && (
                        <div className="animate__animated animate__fadeIn h-100 d-flex flex-column project-components-panel project-components-shell">
                          <div className="responsive-page-toolbar d-flex justify-content-between align-items-center mb-4 flex-shrink-0">
                            <div>
                              <h5 className="fw-bold text-dark m-0">Arquitectura de Componentes y Versiones</h5>
                              <span className="text-muted small">Gestiona los módulos lógicos del proyecto y sus respectivos ciclos de release (Builds).</span>
                            </div>
                            {canEditProjectComponents && (
                              <Button variant="primary" size="sm" className="fw-bold rounded-pill px-3 shadow-sm d-flex align-items-center gap-1" onClick={() => {
                                setComponentForm({ id: '', name: '', description: '', techStack: '', variablesText: '' });
                                setShowComponentModal(true);
                              }}>
                                <Plus size={16} /> Nuevo Componente
                              </Button>
                            )}
                          </div>

                          <Row className="g-4 flex-grow-1 overflow-hidden project-component-layout">
                            
                            {/* PANEL MAESTRO: Lista de Componentes */}
                            <Col md={4} className="h-100 d-flex flex-column">
                              <Card className="border-0 shadow-sm bg-light h-100 d-flex flex-column project-component-list component-list-panel">
                                <div className="p-3 border-bottom bg-white rounded-top-3">
                                  <div className="input-group input-group-sm">
                                    <span className="input-group-text bg-light border-end-0 text-muted"><Search size={14} /></span>
                                    <Form.Control 
                                      type="text" 
                                      placeholder="Buscar componente..." 
                                      className="bg-light border-start-0 shadow-none ps-0"
                                      value={componentSearchQuery}
                                      onChange={(e) => setComponentSearchQuery(e.target.value)}
                                    />
                                  </div>
                                </div>
                                <div className="flex-grow-1 overflow-auto p-2">
                                  <div className="d-flex flex-column gap-2">
                                    {componentsList
                                      .filter(c => c.projectId === managingProjectId && c.name.toLowerCase().includes(componentSearchQuery.toLowerCase()))
                                      .map(comp => (
                                      <div 
                                        key={comp.id} 
                                        onClick={() => handleComponentChange(comp.id)}
                                        className={`p-3 rounded-3 cursor-pointer transition-all border ${comp.id === currentCompId ? 'bg-white border-primary shadow-sm' : 'bg-transparent border-transparent hover-bg-white'}`}
                                      >
                                        <div className="d-flex justify-content-between align-items-start mb-1">
                                          <div className="d-flex align-items-center gap-2">
                                            <Layers size={16} className={comp.id === currentCompId ? 'text-primary' : 'text-muted'} />
                                            <span className={`fw-bold ${comp.id === currentCompId ? 'text-primary' : 'text-dark'}`}>{comp.name}</span>
                                          </div>
                                          <span className="badge bg-secondary bg-opacity-10 text-secondary border">
                                            {buildsList.filter(b => b.projectId === managingProjectId && b.componentId === comp.id).length} builds
                                          </span>
                                        </div>
                                        {comp.techStack && (
                                          <div className="x-small text-muted text-truncate mt-2 d-flex align-items-center gap-1">
                                            <Terminal size={10}/> {comp.techStack}
                                          </div>
                                        )}
                                        {Object.keys(comp.variables || {}).length > 0 && (
                                          <div className="x-small text-muted mt-2">
                                            {Object.keys(comp.variables || {}).length} vars tecnicas
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                    {componentsList.filter(c => c.projectId === managingProjectId).length === 0 && (
                                      <div className="text-center p-4 text-muted small">
                                        <Layers size={24} className="mb-2 opacity-50"/>
                                        <p>No hay componentes definidos.</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </Card>
                            </Col>

                            {/* PANEL DETALLE: Info del Componente y sus Builds */}
                            <Col md={8} className="h-100">
                              {currentCompId && componentsList.find(c => c.id === currentCompId) ? (
                                <Card className="border-0 shadow-sm h-100 d-flex flex-column bg-white project-build-card">
                                  {/* Cabecera del Detalle */}
                                  <Card.Header className="bg-white border-bottom p-4 flex-shrink-0 component-detail-header">
                                    <div className="d-flex justify-content-between align-items-start mb-3 project-build-header">
                                      <div>
                                        <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
                                          <Badge bg="primary" className="bg-opacity-10 text-primary border border-primary-subtle fw-bold">COMPONENTE ACTIVO</Badge>
                                        </div>
                                        <h4 className="fw-bold text-dark m-0">{componentsList.find(c => c.id === currentCompId)?.name}</h4>
                                        <span className="font-monospace text-muted x-small">ID: {currentCompId}</span>
                                      </div>
                                      {canEditProjectComponents && (
                                      <div className="d-flex gap-2">
                                        <Button variant="light" size="sm" className="border shadow-sm text-secondary hover-text-primary" onClick={() => {
                                          const current = componentsList.find(c => c.id === currentCompId);
                                          if (current) {
                                            setComponentForm({
                                              id: current.id,
                                              name: current.name,
                                              description: current.description || '',
                                              techStack: current.techStack || '',
                                              variablesText: Object.entries(current.variables || {}).map(([key, value]) => `${key}=${String(value)}`).join('\n')
                                            });
                                            setShowComponentModal(true);
                                          }
                                        }}>
                                          <Edit size={14} className="me-1"/> Editar
                                        </Button>
                                        <Button variant="light" size="sm" className="border shadow-sm text-danger hover-bg-danger hover-text-white" onClick={() => handleDeleteComponent(currentCompId)}>
                                          <Trash2 size={14} className="me-1"/> Eliminar
                                        </Button>
                                      </div>
                                      )}
                                    </div>
                                    <p className="text-muted small mb-2">{componentsList.find(c => c.id === currentCompId)?.description || 'Sin descripción detallada.'}</p>
                                    {Object.keys(componentsList.find(c => c.id === currentCompId)?.variables || {}).length > 0 && (
                                      <div className="d-flex flex-wrap gap-1">
                                        {Object.entries(componentsList.find(c => c.id === currentCompId)?.variables || {}).map(([key, value]) => (
                                          <Badge key={key} bg="light" text="dark" className="border font-monospace">
                                            {key}={String(value)}
                                          </Badge>
                                        ))}
                                      </div>
                                    )}
                                  </Card.Header>

                                  {/* Lista de Builds del Componente Seleccionado */}
                                  <Card.Body className="p-4 bg-light flex-grow-1 overflow-auto">
                                      <div className="d-flex justify-content-between align-items-center mb-3 project-build-toolbar">
                                      <h6 className="fw-bold text-secondary m-0 d-flex align-items-center gap-2">
                                        <Terminal size={18} /> Historial de Builds / Versiones
                                      </h6>
                                      {canEditProjectBuilds && (
                                        <Form className="build-create-form build-create-compact bg-white p-2 rounded-3 shadow-sm border border-light-subtle w-100" onSubmit={handleCreateBuild}>
                                          <div className="d-flex align-items-center gap-2 build-create-main">
                                            <Form.Control name="buildName" size="sm" placeholder="Build * ej: v2.1.0-RC2..." className="shadow-none bg-white px-3 fw-bold" required />
                                            <Button type="button" variant="outline-secondary" size="sm" className="fw-bold px-3 rounded-pill text-nowrap d-flex align-items-center gap-1" onClick={() => setShowBuildCreateOptions(prev => !prev)}>
                                              <Sliders size={14} /> Opciones
                                            </Button>
                                            <Button type="submit" variant="dark" size="sm" className="fw-bold px-3 border-0 rounded-pill text-nowrap d-flex align-items-center gap-1">
                                              <Plus size={14} /> Crear
                                            </Button>
                                          </div>
                                          {showBuildCreateOptions && (
                                          <div className="d-flex align-items-center gap-2 build-create-meta mt-2">
                                            <Form.Group className="build-context-field">
                                              <Form.Label className="x-small fw-bold text-muted mb-1">Notas / referencia</Form.Label>
                                              <Form.Control name="buildContext" size="sm" placeholder="Notas, cambios o link GitHub/GitLab..." className="shadow-none bg-white px-3" />
                                            </Form.Group>
                                            <Form.Group className="build-date-field">
                                              <Form.Label className="x-small fw-bold text-muted mb-1">Inicio evaluación</Form.Label>
                                              <Form.Control name="buildStartDate" type="datetime-local" size="sm" defaultValue={defaultBuildStartDate} title="Inicio de la ventana de evaluación" />
                                            </Form.Group>
                                            <Form.Group className="build-date-field">
                                              <Form.Label className="x-small fw-bold text-muted mb-1">Fin evaluación</Form.Label>
                                              <Form.Control name="buildEndDate" type="datetime-local" size="sm" title="Fin de la ventana de evaluación" />
                                            </Form.Group>
                                          </div>
                                          )}
                                        </Form>
                                      )}
                                    </div>

                                    <div className="d-flex flex-column gap-2">
                                      {sortBuildsNewestFirst(buildsList.filter(b => b.projectId === managingProjectId && b.componentId === currentCompId)).map(build => {
                                        const buildLink = firstUrlFromText(build.changeContext)
                                        const windowState = buildWindowState(build)
                                        const isBuildExpanded = Boolean(expandedBuildDetails[build.id])
                                        const buildReportKey = reportCacheKey(managingProjectId, build.id)
                                        const buildReport = buildReportKey ? latestBuildReports[buildReportKey] : null
                                        const latestReport = buildReport?.item || null
                                        const reportItems = buildReport?.items || []
                                        const previousReportCount = Math.max(0, reportItems.length - (latestReport ? 1 : 0))
                                        const latestReportStatusInfo = latestReportStatus(latestReport)
                                        const buildDisplayEndDate = build.endDate
                                        const buildEndLabel = build.active ? 'Fin' : 'Cierre'
                                        return (
                                        <div key={build.id} className={`p-3 border rounded-3 shadow-sm transition-all project-build-item build-row-card ${build.active ? 'is-active' : ''} ${build.hidden ? 'opacity-75' : ''}`}>
                                          <div className="d-flex justify-content-between align-items-start gap-3 project-build-item-main">
                                            <div className="d-flex align-items-start gap-3 flex-grow-1">
                                              <div className="bg-white border rounded-circle d-flex align-items-center justify-content-center shadow-sm flex-shrink-0" style={{ width: '32px', height: '32px' }}>
                                                {build.active ? <CheckCircle2 size={18} className="text-success" /> : <Terminal size={16} className="text-muted" />}
                                              </div>
                                              <div className="flex-grow-1">
                                                <div className="d-flex align-items-center gap-2 flex-wrap">
                                                  <div className="fw-bold text-dark font-monospace" style={{ fontSize: '0.9rem' }}>{build.name}</div>
                                                  <Badge bg={build.active ? 'success' : 'light'} text={build.active ? undefined : 'secondary'} className={build.active ? '' : 'border'}>
                                                    {build.active ? 'Activo' : 'Histórico'}
                                                  </Badge>
                                                  {build.hidden && <Badge bg="light" text="secondary" className="border">Oculto</Badge>}
                                                  <Badge bg={windowState.variant as any}>{windowState.label}</Badge>
                                                </div>
                                                <div className="build-row-dates mt-1" title={`Inicio: ${build.startDate ? formatDateTime(build.startDate) : 'Sin inicio'} · ${buildEndLabel}: ${buildDisplayEndDate ? formatDateTime(buildDisplayEndDate) : 'Sin fin'}`}>
                                                  <span><strong>Inicio</strong> {build.startDate ? formatDateTime(build.startDate) : 'Sin inicio'}</span>
                                                  <span><strong>{buildEndLabel}</strong> {buildDisplayEndDate ? formatDateTime(buildDisplayEndDate) : 'Sin fin'}</span>
                                                  <span className="build-row-window-detail">{windowState.detail}</span>
                                                </div>
                                                {windowState.progress !== null && <ProgressBar now={windowState.progress} variant={windowState.variant as any} className="mt-2 build-row-progress" />}
                                                {isBuildExpanded && build.changeContext && (
                                                  <div className="small text-muted mt-2 bg-white bg-opacity-75 border rounded-3 p-2" style={{ whiteSpace: 'pre-wrap' }}>{build.changeContext}</div>
                                                )}
                                                {isBuildExpanded && buildLink && (
                                                  <a href={buildLink} target="_blank" rel="noreferrer" className="x-small fw-bold text-primary text-decoration-none d-inline-flex align-items-center gap-1 mt-2">
                                                    <Link size={12} /> Abrir referencia
                                                  </a>
                                                )}
                                              </div>
                                            </div>
                                            <div className="d-flex gap-2 align-items-center flex-wrap justify-content-end build-row-actions">
                                              {canReadProjectBuildScope && (
                                                <Button variant="outline-primary" size="sm" className="rounded-pill px-3 fw-bold x-small shadow-none" onClick={() => openBuildCasesModal(build.id)}>
                                                  Casos ({(buildCaseIds[build.id] || []).length})
                                                </Button>
                                              )}
                                              {reportSnapshotsEnabled && canViewSharedReports ? (
                                                <Dropdown align="end">
                                                  <Dropdown.Toggle variant="outline-secondary" size="sm" className="rounded-pill px-3 fw-bold x-small shadow-none d-flex align-items-center gap-1">
                                                    <FileText size={13} /> Reportes
                                                  </Dropdown.Toggle>
                                                  <Dropdown.Menu className="shadow-sm border-0">
                                                    {buildReport?.loading ? (
                                                      <Dropdown.Item disabled>Cargando reportes...</Dropdown.Item>
                                                    ) : latestReport ? (
                                                      <>
                                                        <Dropdown.Header>
                                                          <span className="d-block text-dark fw-bold">Ultimo snapshot</span>
                                                          <span className="d-block x-small text-muted">
                                                            {formatDateTime(latestReport.created_at)} · {latestReportStatusInfo.label}
                                                            {previousReportCount > 0 ? ` · ${previousReportCount} anteriores` : ''}
                                                          </span>
                                                        </Dropdown.Header>
                                                        {(['executive', 'development', 'internal'] as const).map(type => (
                                                          latestReport.links?.[type] ? (
                                                            <Dropdown.Item key={type} onClick={() => openProjectReportLink(latestReport.links[type], type)}>
                                                              {reportButtonLabel(type)}
                                                            </Dropdown.Item>
                                                          ) : null
                                                        ))}
                                                        <Dropdown.Divider />
                                                        <Dropdown.Item onClick={() => goToReports(managingProjectId)}>
                                                          Ver historial en Reportes
                                                        </Dropdown.Item>
                                                      </>
                                                    ) : (
                                                      <>
                                                        <Dropdown.Item disabled>Sin reporte compartido para esta build</Dropdown.Item>
                                                        <Dropdown.Divider />
                                                        <Dropdown.Item onClick={() => goToReports(managingProjectId)}>
                                                          Ir a Reportes
                                                        </Dropdown.Item>
                                                      </>
                                                    )}
                                                  </Dropdown.Menu>
                                                </Dropdown>
                                              ) : (
                                                <PremiumGate
                                                  feature="reports.snapshots"
                                                  hasFeature={hasSystemFeature}
                                                  title="Reportes compartidos por build"
                                                  description="Reportes compartidos por build disponibles en Treseko Premium."
                                                  mode="disabled"
                                                  className="build-row-premium-report"
                                                >
                                                  <Button variant="outline-secondary" size="sm" className="rounded-pill px-3 fw-bold x-small shadow-none d-flex align-items-center gap-1">
                                                    <FileText size={13} /> Reportes
                                                  </Button>
                                                </PremiumGate>
                                              )}
                                              <Dropdown align="end">
                                                <Dropdown.Toggle variant="outline-secondary" size="sm" className="rounded-pill px-3 fw-bold x-small shadow-none d-flex align-items-center gap-1">
                                                  <MoreHorizontal size={14} /> Acciones
                                                </Dropdown.Toggle>
                                                <Dropdown.Menu className="shadow-sm border-0">
                                                  <Dropdown.Item onClick={() => setExpandedBuildDetails(prev => ({ ...prev, [build.id]: !prev[build.id] }))}>
                                                    {isBuildExpanded ? 'Ocultar detalle' : 'Ver detalles'}
                                                  </Dropdown.Item>
                                                  {canEditProjectBuilds && (
                                                    <Dropdown.Item onClick={() => handleToggleBuildHidden(build.id)}>
                                                      {build.hidden ? 'Mostrar build' : 'Ocultar build'}
                                                    </Dropdown.Item>
                                                  )}
                                                  {canEditProjectBuilds && (
                                                    build.active ? (
                                                      <Dropdown.Item onClick={() => handleSetInactiveBuild(build.id)}>
                                                        Desactivar build
                                                      </Dropdown.Item>
                                                    ) : (
                                                      <Dropdown.Item onClick={() => handleSetActiveBuild(build.id)}>
                                                        Activar build
                                                      </Dropdown.Item>
                                                    )
                                                  )}
                                                  {canEditProjectBuilds && (
                                                    <>
                                                      <Dropdown.Divider />
                                                      <Dropdown.Item className="text-danger" onClick={() => handleDeleteBuild(build.id)}>
                                                        Eliminar build
                                                      </Dropdown.Item>
                                                    </>
                                                  )}
                                                </Dropdown.Menu>
                                              </Dropdown>
                                            </div>
                                          </div>
                                          {isBuildExpanded && canEditProjectBuilds && (
                                            <Form
                                              key={`${build.id}:${build.startDate || ''}:${build.endDate || ''}:${build.changeContext || ''}`}
                                              className="mt-3 border-top pt-3 build-row-detail"
                                              onSubmit={(e) => handleUpdateBuildContext(e, build.id)}
                                            >
                                              <Form.Label className="x-small fw-bold text-muted text-uppercase">Notas de entrega / control de cambios</Form.Label>
                                              <div className="d-flex gap-2 align-items-start build-context-form">
                                                <Form.Control as="textarea" rows={2} name="buildContext" defaultValue={build.changeContext || ''} placeholder="Resumen de cambios, commit, PR, release note, ticket o link externo..." className="small bg-white" />
                                                <div className="d-flex flex-column gap-2 build-context-dates" style={{ minWidth: 220 }}>
                                                  <Form.Control type="datetime-local" name="buildStartDate" size="sm" defaultValue={toDateTimeLocalInput(build.startDate)} title="Inicio de la ventana de evaluación" />
                                                  <Form.Control type="datetime-local" name="buildEndDate" size="sm" defaultValue={toDateTimeLocalInput(build.endDate)} title="Fin de la ventana de evaluación" />
                                                  <Button type="submit" variant="outline-primary" size="sm" className="fw-bold text-nowrap px-3">Guardar</Button>
                                                </div>
                                              </div>
                                            </Form>
                                          )}
                                        </div>
                                      )})}
                                      {buildsList.filter(b => b.projectId === managingProjectId && b.componentId === currentCompId).length === 0 && (
                                        <div className="text-center py-5 text-muted bg-white rounded-3 border border-dashed">
                                          <Terminal size={24} className="mb-2 opacity-50"/>
                                          <p className="small mb-0">Este componente no tiene builds registradas.</p>
                                          <span className="x-small">Usa el formulario superior para crear la primera versión.</span>
                                        </div>
                                      )}
                                    </div>
                                  </Card.Body>
                                </Card>
                              ) : (
                                <div className="h-100 d-flex flex-column align-items-center justify-content-center bg-white border rounded-4 shadow-sm text-muted p-5">
                                  <Layers size={48} className="mb-3 opacity-25" />
                                  <h5>Ningún componente seleccionado</h5>
                                  <p className="small text-center">Selecciona un componente del panel izquierdo para visualizar sus detalles y administrar sus builds asociadas.</p>
                                </div>
                              )}
                            </Col>
                          </Row>
                        </div>
                      )}

                  {/* SUB-TAB: AMBIENTES */}
                  {projectInnerTab === 'envs' && (canReadProjectEnvironments || canReadProjectDatasets) && (
                    <div className="animate__animated animate__fadeIn">
                      <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-4">
                        <div>
                          <h5 className="fw-bold text-dark m-0">Ambientes y Datasets</h5>
                          <div className="small text-muted">El ambiente define el contexto de ejecucion; el dataset guarda datos reutilizables para pruebas parametrizadas.</div>
                        </div>
                        {canEditProjectEnvironments && (
                          <Button variant="primary" size="sm" className="fw-bold rounded-pill px-3" onClick={() => openEnvironmentModal()}>
                            <Plus size={15} className="me-1" /> Nuevo ambiente
                          </Button>
                        )}
                      </div>
                      <Form className="d-none" onSubmit={handleSaveProjectEnvironment}>
                        <Row className="g-2 align-items-end">
                          <Col md={3}>
                            <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>Nombre</RequiredLabel></Form.Label>
                            <Form.Control name="envName" size="sm" placeholder="QA / UAT" required />
                          </Col>
                          <Col md={4}>
                            <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>URL / Endpoint</RequiredLabel></Form.Label>
                            <Form.Control name="envUrl" size="sm" type="url" placeholder="https://qa.api.project.com" required />
                          </Col>
                          <Col md={2}>
                            <Form.Label className="x-small fw-bold text-muted">Versión</Form.Label>
                            <Form.Control name="envVersion" size="sm" placeholder="v1.0.0" />
                          </Col>
                          <Col md={2}>
                            <Form.Label className="x-small fw-bold text-muted">Estado</Form.Label>
                            <Form.Select name="envStatus" size="sm" defaultValue="Online">
                              <option value="Online">Online</option>
                              <option value="Offline">Offline</option>
                              <option value="Maintenance">Maintenance</option>
                              <option value="Unknown">Unknown</option>
                            </Form.Select>
                          </Col>
                          <Col md={1}>
                            <Button type="submit" variant="primary" size="sm" className="w-100 fw-bold">+</Button>
                          </Col>
                          <Col md={3}>
                            <Form.Label className="x-small fw-bold text-muted">USER</Form.Label>
                            <Form.Control name="envUSER" size="sm" placeholder="admin.qa@test.com" />
                          </Col>
                          <Col md={3}>
                            <Form.Label className="x-small fw-bold text-muted">PASSWORD</Form.Label>
                            <Form.Control name="envPASSWORD" size="sm" type="password" placeholder="Password" />
                          </Col>
                          <Col md={3}>
                            <Form.Label className="x-small fw-bold text-muted">TOKEN</Form.Label>
                            <Form.Control name="envTOKEN" size="sm" type="password" placeholder="Token" />
                          </Col>
                          <Col md={3}>
                            <Form.Label className="x-small fw-bold text-muted">TENANT</Form.Label>
                            <Form.Control name="envTENANT" size="sm" placeholder="qa-platform" />
                          </Col>
                        </Row>
                      </Form>
                      <Table responsive hover className="border rounded-3 overflow-hidden shadow-sm align-middle">
                        <thead className="bg-light text-secondary small">
                          <tr>
                            <th className="py-3 px-4 border-0">Nombre Ambiente</th>
                            <th className="py-3 border-0">URL / Endpoint Base</th>
                            <th className="py-3 border-0">Variables / Datasets</th>
                            <th className="py-3 border-0">Versión</th>
                            <th className="py-3 border-0">Estado API</th>
                            <th className="py-3 px-4 border-0 text-end">Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {projectEnvironments.map((env: any) => (
                            <tr key={env.id}>
                              <td className="px-4 fw-bold text-dark">{env.name}</td>
                              <td className="font-monospace text-primary small">{env.url}</td>
                              <td className="small text-muted">
                                <Badge bg="light" text="dark" className="border me-1">{Object.keys(env.variables || {}).length} vars</Badge>
                                <Badge bg="light" text="dark" className="border">{(env.datasets || []).length} datasets</Badge>
                              </td>
                              <td className="text-muted small">{env.version || 'Sin versión'}</td>
                              <td>
                                <Badge bg={env.status === 'Online' ? 'success' : env.status === 'Offline' ? 'danger' : 'warning'} text={env.status === 'Maintenance' ? 'dark' : undefined} className="fw-normal">
                                  <span className="d-inline-block bg-white rounded-circle me-1" style={{ width: '6px', height: '6px' }}></span>{env.status}
                                </Badge>
                              </td>
                              <td className="px-4 text-end">
                                {canEditProjectDatasets && <Button variant="link" className="text-primary p-0 me-2" title="Agregar dataset" onClick={() => setDatasetFormEnvId(datasetFormEnvId === env.id ? null : env.id)}><Plus size={16} /></Button>}
                                {canEditProjectEnvironments && <Button variant="link" className="text-muted p-0 me-2" title="Editar ambiente" onClick={() => openEnvironmentModal(env)}><Edit size={16} /></Button>}
                                {canEditProjectEnvironments && <Button variant="link" className="text-danger p-0" title="Ocultar ambiente" onClick={() => handleDeleteProjectEnvironment(env.id)}><Trash2 size={16} /></Button>}
                              </td>
                            </tr>
                          ))}
                          {projectEnvironments.length === 0 && (
                            <tr><td colSpan={6} className="text-center py-4 text-muted small">No hay ambientes registrados para este proyecto.</td></tr>
                          )}
                        </tbody>
                      </Table>
                      {canReadProjectDatasets && <div className="mt-4">
                        <div className="d-flex justify-content-between align-items-center mb-3">
                          <div>
                            <h6 className="fw-bold text-dark mb-1">Datasets por ambiente</h6>
                            <div className="small text-muted">Un dataset es un conjunto de datos reutilizable para ejecutar pruebas con valores distintos.</div>
                          </div>
                          <Badge bg="light" text="dark" className="border">
                            {projectEnvironments.reduce((total: number, env: any) => total + (env.datasets || []).length, 0)} datasets
                          </Badge>
                        </div>
                        <Row className="g-3">
                          {projectEnvironments.map((env: any) => (
                            <Col xl={6} key={`${env.id}-datasets`}>
                              <Card className="border shadow-sm h-100">
                                <Card.Header className="bg-white d-flex justify-content-between align-items-start gap-2">
                                  <div>
                                    <div className="fw-bold text-dark">{env.name}</div>
                                    <div className="font-monospace x-small text-primary text-truncate" title={env.url}>{env.url}</div>
                                  </div>
                                  <div className="d-flex align-items-center gap-2">
                                    <Badge bg="light" text="dark" className="border">{(env.datasets || []).length} datasets</Badge>
                                    {canEditProjectDatasets && (
                                      <Button variant="outline-primary" size="sm" className="x-small fw-bold" onClick={() => setDatasetFormEnvId(datasetFormEnvId === env.id ? null : env.id)}>
                                        <Plus size={13} className="me-1" /> Agregar dataset
                                      </Button>
                                    )}
                                  </div>
                                </Card.Header>
                                <Card.Body>
                                  {datasetFormEnvId === env.id && canEditProjectDatasets && (
                                  <Form className="bg-light border rounded-3 p-3 mb-3" onSubmit={async (event) => {
                                    const ok = await handleSaveEnvironmentDataset(event, env.id)
                                    if (ok) setDatasetFormEnvId(null)
                                  }}>
                                    <Row className="g-2">
                                      <Col md={6}>
                                        <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>Nombre del dataset</RequiredLabel></Form.Label>
                                        <Form.Control name="datasetName" size="sm" placeholder="Login valido / Usuario bloqueado" required />
                                      </Col>
                                      <Col md={6}>
                                        <Form.Label className="x-small fw-bold text-muted">Descripcion / uso</Form.Label>
                                        <Form.Control name="datasetDescription" size="sm" placeholder="Para que suite o flujo se usa" />
                                      </Col>
                                      <Col xs={12}>
                                        <Form.Label className="x-small fw-bold text-muted">Variables del dataset</Form.Label>
                                        <Form.Control
                                          as="textarea"
                                          rows={3}
                                          name="datasetVariables"
                                          size="sm"
                                          className="font-monospace small"
                                          placeholder={'usuario=qa_user\npassword=qa_password\ncolor=azul'}
                                        />
                                      </Col>
                                      <Col xs={12} className="d-flex justify-content-between align-items-center">
                                        <Form.Check name="datasetDefault" label="Usar como default" className="small" />
                                        <div className="d-flex gap-2">
                                          <Button type="button" size="sm" variant="outline-secondary" className="fw-bold" onClick={() => setDatasetFormEnvId(null)}>Cancelar</Button>
                                          <Button type="submit" size="sm" variant="primary" className="fw-bold">Crear dataset</Button>
                                        </div>
                                      </Col>
                                    </Row>
                                  </Form>
                                  )}
                                  <div className="d-flex flex-column gap-2">
                                    {(env.datasets || []).map((dataset: any) => {
                                      const draft = getDatasetDraft(dataset)
                                      const dirty = isDatasetDraftDirty(dataset)
                                      const saving = savingDatasetId === dataset.id
                                      const justSaved = savedDatasetId === dataset.id
                                      return (
                                      <Form key={dataset.id} className="border rounded-3 bg-white p-3" onSubmit={(event) => handleDatasetSubmit(event, env.id, dataset)}>
                                        <div className="d-flex justify-content-between align-items-start gap-2 mb-3">
                                          <div className="d-flex align-items-center gap-2">
                                            <Badge bg={dataset.isDefault ? 'success' : 'light'} text={dataset.isDefault ? undefined : 'dark'} className="border">
                                              {dataset.isDefault ? 'Default' : 'Dataset'}
                                            </Badge>
                                            {justSaved && <Badge bg="success" className="border">Cambios guardados</Badge>}
                                            <span className="x-small text-muted font-monospace">{dataset.id}</span>
                                          </div>
                                          <div className="d-flex gap-2">
                                            {canEditProjectDatasets && !dataset.isDefault && (
                                              <Button type="button" variant="outline-success" size="sm" className="x-small" onClick={async () => {
                                                const ok = await handleSetDefaultEnvironmentDataset(env.id, dataset.id)
                                                if (ok) {
                                                  setDatasetDrafts(prev => {
                                                    const next = { ...prev }
                                                    Object.keys(next).forEach(key => {
                                                      next[key] = { ...next[key], isDefault: key === dataset.id }
                                                    })
                                                    return next
                                                  })
                                                }
                                              }}>Marcar default</Button>
                                            )}
                                            {canEditProjectDatasets && (
                                              <Button type="submit" variant={dirty ? 'primary' : 'secondary'} size="sm" className="x-small" disabled={!dirty || saving}>
                                                {saving ? 'Guardando...' : dirty ? 'Guardar' : 'Sin cambios'}
                                              </Button>
                                            )}
                                            {canEditProjectDatasets && (
                                              <Button type="button" variant="outline-danger" size="sm" className="x-small" onClick={async () => {
                                                const ok = await handleDeleteEnvironmentDataset(env.id, dataset.id)
                                                if (ok) {
                                                  setDatasetDrafts(prev => {
                                                    const next = { ...prev }
                                                    delete next[dataset.id]
                                                    return next
                                                  })
                                                }
                                              }}><Trash2 size={13} /></Button>
                                            )}
                                          </div>
                                        </div>
                                        <Row className="g-2">
                                          <Col md={5}>
                                            <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>Nombre del dataset</RequiredLabel></Form.Label>
                                            <Form.Control name="datasetName" size="sm" value={draft.name} onChange={(event) => updateDatasetDraft(dataset, { name: event.target.value })} required disabled={!canEditProjectDatasets} />
                                          </Col>
                                          <Col md={7}>
                                            <Form.Label className="x-small fw-bold text-muted">Descripcion / uso</Form.Label>
                                            <Form.Control name="datasetDescription" size="sm" value={draft.description} onChange={(event) => updateDatasetDraft(dataset, { description: event.target.value })} disabled={!canEditProjectDatasets} />
                                          </Col>
                                          <Col xs={12}>
                                            <Form.Label className="x-small fw-bold text-muted">Variables del dataset</Form.Label>
                                            <Form.Control
                                              as="textarea"
                                              rows={4}
                                              name="datasetVariables"
                                              size="sm"
                                              className="font-monospace small"
                                              value={draft.variablesText}
                                              onChange={(event) => updateDatasetDraft(dataset, { variablesText: event.target.value })}
                                              disabled={!canEditProjectDatasets}
                                            />
                                          </Col>
                                          <Col xs={12} className="d-flex justify-content-between align-items-center">
                                            <Form.Check name="datasetDefault" label="Usar como default" className="small" checked={draft.isDefault} onChange={(event) => updateDatasetDraft(dataset, { isDefault: event.target.checked })} disabled={!canEditProjectDatasets} />
                                            <div className="small text-muted">
                                              Usar en pruebas como <code>{'{{DATASET.usuario}}'}</code> o <code>{'{{usuario}}'}</code>
                                            </div>
                                          </Col>
                                        </Row>
                                      </Form>
                                    )})}
                                    {(env.datasets || []).length === 0 && (
                                      <div className="text-center text-muted small border rounded-3 bg-white py-3">Este ambiente todavia no tiene datasets.</div>
                                    )}
                                  </div>
                                </Card.Body>
                              </Card>
                            </Col>
                          ))}
                        </Row>
                      </div>}
                    </div>
                  )}

                  {/* SUB-TAB: WIKI Y DOCUMENTACIÓN (AVANZADO) */}
                  {projectInnerTab === 'wiki' && canReadProjectWiki && (
                    <div className="animate__animated animate__fadeIn h-100 d-flex flex-column">

                      {/* MODO LISTA: Directorio de todas las Wikis del proyecto */}
                      {wikiMode === 'list' && (
                        <>
                          <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                            <div>
                              <h5 className="fw-bold text-dark m-0">Directorio de Documentación</h5>
                              <span className="text-muted small">Gestiona las guías, DoD y manuales del proyecto.</span>
                            </div>
                            {canEditProjectWiki && (
                              <Button variant="primary" size="sm" className="fw-bold rounded-pill px-3 shadow-sm d-flex align-items-center gap-1" onClick={() => {
                                setSelectedWiki(null);
                                setWikiFormData({ title: '', content: '' });
                                setWikiMode('edit');
                              }}>
                                <Plus size={16} /> Nueva Página
                              </Button>
                            )}
                          </div>

                          <div className="flex-grow-1 overflow-auto">
                            <Table responsive hover className="align-middle border shadow-sm rounded-3 overflow-hidden bg-white">
                              <thead className="bg-light text-muted small">
                                <tr>
                                  <th className="py-3 px-3 border-0">Título del documento</th>
                                  <th className="py-3 border-0">Última Modificación</th>
                                  <th className="py-3 border-0">Autor</th>
                                  <th className="py-3 px-3 border-0 text-end">Acciones</th>
                                </tr>
                              </thead>
                              <tbody>
                                {wikiPages.filter(w => w.projectId === managingProjectId).map(wiki => (
                                  <tr key={wiki.id} className="border-bottom">
                                    <td className="px-3">
                                      <div className="fw-bold text-primary cursor-pointer d-flex align-items-center gap-2 hover-text-dark" onClick={() => { setSelectedWiki(wiki); setWikiMode('view'); }}>
                                        <FileText size={16} /> {wiki.title}
                                      </div>
                                    </td>
                                    <td className="text-muted small font-monospace">{wiki.lastEditedAt}</td>
                                    <td><Badge bg="secondary" className="fw-normal">{wiki.lastEditedBy}</Badge></td>
                                    <td className="px-3 text-end d-flex gap-2 justify-content-end">
                                      <Button variant="light" size="sm" className="border shadow-none text-muted" title="Ver Historial" onClick={() => { setSelectedWiki(wiki); setWikiMode('history'); }}><History size={14} /></Button>
                                      {canEditProjectWiki && <Button variant="light" size="sm" className="border shadow-none text-primary" title="Editar" onClick={() => { setSelectedWiki(wiki); setWikiFormData({ title: wiki.title, content: wiki.content }); setWikiMode('edit'); }}><Edit size={14} /></Button>}
                                      {canEditProjectWiki && <Button variant="light" size="sm" className="border shadow-none text-danger" title="Eliminar" onClick={() => handleDeleteWikiPage(wiki.id)}><Trash2 size={14} /></Button>}
                                    </td>
                                  </tr>
                                ))}
                                {wikiPages.filter(w => w.projectId === managingProjectId).length === 0 && (
                                  <tr><td colSpan={4} className="text-center py-4 text-muted small">No hay documentos creados en este proyecto.</td></tr>
                                )}
                              </tbody>
                            </Table>
                          </div>
                        </>
                      )}

                      {/* MODO LECTURA: Ver un documento renderizado */}
                      {wikiMode === 'view' && selectedWiki && (
                        <div className="d-flex flex-column h-100">
                          <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3 flex-shrink-0">
                            <div className="d-flex align-items-center gap-3">
                              <Button variant="white" size="sm" className="border shadow-sm rounded-circle p-2" onClick={() => setWikiMode('list')}><ArrowLeft size={16} /></Button>
                              <h5 className="fw-bold text-dark m-0 d-flex align-items-center gap-2"><FileText size={20} className="text-primary" /> {selectedWiki.title}</h5>
                            </div>
                            <div className="d-flex gap-2">
                              <Button variant="outline-secondary" size="sm" className="fw-bold rounded-pill px-3 shadow-none d-flex align-items-center gap-1" onClick={() => setWikiMode('history')}><History size={14} /> Historial</Button>
                              {canEditProjectWiki && <Button variant="primary" size="sm" className="fw-bold rounded-pill px-3 shadow-sm d-flex align-items-center gap-1" onClick={() => { setWikiFormData({ title: selectedWiki.title, content: selectedWiki.content }); setWikiMode('edit'); }}><Edit size={14} /> Editar</Button>}
                            </div>
                          </div>
                          <Card className="border-0 shadow-sm bg-white flex-grow-1 overflow-auto">
                            <Card.Body className="p-5">
                              <div className="bg-light p-2 rounded-2 mb-4 d-flex justify-content-between align-items-center border border-light-subtle">
                                <span className="x-small text-muted fw-bold text-uppercase ms-2">Formato Markdown Reconocido</span>
                                <span className="small text-muted me-2">Actualizado por <strong>{selectedWiki.lastEditedBy}</strong> el {selectedWiki.lastEditedAt}</span>
                              </div>
                              {/* Visor simulado de Markdown */}
                              <div className="markdown-preview text-dark" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.8' }}>
                                {selectedWiki.content}
                              </div>
                            </Card.Body>
                          </Card>
                        </div>
                      )}

                      {/* MODO EDICIÓN / CREACIÓN */}
                      {wikiMode === 'edit' && canEditProjectWiki && (
                        <div className="d-flex flex-column h-100">
                          <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3 flex-shrink-0">
                            <div className="d-flex align-items-center gap-3">
                              <Button variant="white" size="sm" className="border shadow-sm rounded-circle p-2" onClick={() => setWikiMode('list')}><ArrowLeft size={16} /></Button>
                              <h5 className="fw-bold text-dark m-0">{selectedWiki ? 'Editar Documento' : 'Nuevo Documento'}</h5>
                            </div>
                            <Button variant="success" size="sm" className="fw-bold rounded-pill px-4 shadow-sm d-flex align-items-center gap-2" onClick={handleSaveWikiPage}>
                              <Save size={16} /> Guardar Cambios
                            </Button>
                          </div>
                          <div className="flex-grow-1 d-flex flex-column gap-3">
                            <Form.Control size="lg" type="text" placeholder="Título del documento..." className="fw-bold border-light-subtle shadow-sm" value={wikiFormData.title} onChange={(e) => setWikiFormData({ ...wikiFormData, title: e.target.value })} />
                            <div className="flex-grow-1 position-relative">
                              <Form.Control as="textarea" placeholder="Escribe aquí utilizando sintaxis Markdown (Ej: ### Título, **Negrita**, * Lista)..." className="h-100 font-monospace bg-light border-light-subtle shadow-sm p-4" style={{ resize: 'none', fontSize: '0.9rem' }} value={wikiFormData.content} onChange={(e) => setWikiFormData({ ...wikiFormData, content: e.target.value })} />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* MODO HISTORIAL (TIMELINE) */}
                      {wikiMode === 'history' && selectedWiki && (
                        <div className="d-flex flex-column h-100">
                          <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3 flex-shrink-0">
                            <div className="d-flex align-items-center gap-3">
                              <Button variant="white" size="sm" className="border shadow-sm rounded-circle p-2" onClick={() => setWikiMode('view')}><ArrowLeft size={16} /></Button>
                              <h5 className="fw-bold text-dark m-0 d-flex align-items-center gap-2"><History size={20} className="text-secondary" /> Historial de: {selectedWiki.title}</h5>
                            </div>
                          </div>
                          <Card className="border-0 shadow-sm bg-white flex-grow-1 overflow-auto">
                            <Card.Body className="p-3">
                              <div className="timeline-container px-3">
                                {selectedWiki.history.map((entry: any, i: number) => (
                                  <div key={i} className="d-flex gap-3 mb-4 position-relative">
                                    {/* Línea vertical conectora */}
                                    {i !== selectedWiki.history.length - 1 && (
                                      <div className="position-absolute bg-secondary opacity-25" style={{ width: '2px', top: '30px', bottom: '-20px', left: '19px' }}></div>
                                    )}
                                    <div className="rounded-circle bg-primary text-white d-flex justify-content-center align-items-center shadow-sm z-1 flex-shrink-0" style={{ width: '40px', height: '40px' }}>
                                      <Edit size={16} />
                                    </div>
                                    <div className="bg-light border border-light-subtle rounded-3 p-3 flex-grow-1 shadow-sm">
                                      <div className="d-flex justify-content-between mb-1">
                                        <strong className="text-dark">{entry.author}</strong>
                                        <span className="font-monospace text-muted x-small">{entry.date}</span>
                                      </div>
                                      <span className="small text-secondary">{entry.action}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </Card.Body>
                          </Card>
                        </div>
                      )}

                    </div>
                  )}

                  {/* SUB-TAB: TICKETS E INCIDENCIAS */}
                  {projectInnerTab === 'tickets' && canReadProjectTickets && (
                    <div className="animate__animated animate__fadeIn">
                      <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-4">
                        <h5 className="fw-bold text-dark m-0">Bug Tracker Interno</h5>
                        <Button variant="outline-secondary" size="sm" className="fw-bold rounded-pill px-3" onClick={loadProjectBugs} disabled={bugsLoading}><RefreshCw size={14} className="me-1" /> Actualizar</Button>
                      </div>

                      {canEditProjectTickets && <Card className="border-0 shadow-sm rounded-4 bg-white p-4 mb-4">
                        <Form onSubmit={createBugIssue}>
                          <Row className="g-3">
                            <Col md={5}>
                              <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>Titulo</RequiredLabel></Form.Label>
                              <Form.Control value={bugForm.titulo} onChange={(e) => setBugForm({ ...bugForm, titulo: e.target.value })} placeholder="Ej. Login falla con MFA" required />
                            </Col>
                            <Col md={2}>
                              <Form.Label className="x-small fw-bold text-muted">Severidad</Form.Label>
                              <Form.Select value={bugForm.severidad} onChange={(e) => setBugForm({ ...bugForm, severidad: e.target.value })}>
                                {['BLOCKER', 'CRITICA', 'ALTA', 'MEDIA', 'BAJA'].map(item => <option key={item} value={item}>{item}</option>)}
                              </Form.Select>
                            </Col>
                            <Col md={2}>
                              <Form.Label className="x-small fw-bold text-muted">Prioridad</Form.Label>
                              <Form.Select value={bugForm.prioridad} onChange={(e) => setBugForm({ ...bugForm, prioridad: e.target.value })}>
                                {['ALTA', 'MEDIA', 'BAJA'].map(item => <option key={item} value={item}>{item}</option>)}
                              </Form.Select>
                            </Col>
                            <Col md={3}>
                              <Form.Label className="x-small fw-bold text-muted">Componente</Form.Label>
                              <Form.Select value={bugForm.componente_id} onChange={(e) => setBugForm({ ...bugForm, componente_id: e.target.value })}>
                                <option value="">Sin componente</option>
                                {componentsList.filter((c: any) => c.projectId === managingProjectId).map((component: any) => <option key={component.id} value={component.id}>{component.name}</option>)}
                              </Form.Select>
                            </Col>
                            <Col md={9}>
                              <Form.Label className="x-small fw-bold text-muted">Descripcion</Form.Label>
                              <Form.Control as="textarea" rows={2} value={bugForm.descripcion} onChange={(e) => setBugForm({ ...bugForm, descripcion: e.target.value })} placeholder="Contexto, pasos, evidencia o impacto" />
                            </Col>
                            <Col md={3}>
                              <Form.Label className="x-small fw-bold text-muted">Build</Form.Label>
                              <Form.Select value={bugForm.build_id} onChange={(e) => setBugForm({ ...bugForm, build_id: e.target.value })}>
                                <option value="">Build activo / N/D</option>
                                {buildsList.filter((build: any) => build.projectId === managingProjectId).map((build: any) => <option key={build.id} value={build.id}>{build.name}</option>)}
                              </Form.Select>
                              <Button type="submit" variant="danger" size="sm" className="fw-bold rounded-pill px-3 mt-3 w-100"><Bug size={14} className="me-1" /> Crear bug</Button>
                            </Col>
                          </Row>
                        </Form>
                      </Card>}

                      <Row className="g-3 mb-4">
                        {['ABIERTO', 'EN_ANALISIS', 'EN_PROGRESO', 'RESUELTO', 'CERRADO'].map((estado) => {
                          const items = bugIssues.filter((bug: any) => bug.estado === estado || (estado === 'ABIERTO' && !bug.estado))
                          return (
                            <Col lg={estado === 'CERRADO' ? 2 : 3} md={6} key={estado}>
                              <Card className="border-0 shadow-sm bg-light h-100">
                                <Card.Header className="bg-white fw-bold py-3 border-bottom-0 d-flex justify-content-between align-items-center">
                                  <span><KanbanSquare size={18} className="me-2" />{estado.replaceAll('_', ' ')}</span>
                                  <Badge bg="light" text="dark" className="border">{items.length}</Badge>
                                </Card.Header>
                                <Card.Body className="d-flex flex-column gap-2 p-2 pt-0">
                                  {items.length === 0 && <div className="small text-muted p-3 bg-white rounded-3 border">Sin bugs.</div>}
                                  {items.map((bug: any) => (
                                    <div key={bug.id} className={`p-3 bg-white border rounded-3 shadow-sm border-start border-4 ${bug.severidad === 'BLOCKER' || bug.severidad === 'CRITICA' ? 'border-danger' : bug.severidad === 'ALTA' ? 'border-warning' : 'border-primary'}`}>
                                      <div className="d-flex justify-content-between mb-1"><strong className="small text-dark">{bug.codigo}</strong> <Badge bg={bug.severidad === 'BLOCKER' || bug.severidad === 'CRITICA' ? 'danger' : bug.severidad === 'ALTA' ? 'warning' : 'secondary'}>{bug.severidad}</Badge></div>
                                      <p className="x-small text-muted mb-2">{bug.titulo}</p>
                                      {bug.descripcion && <div className="x-small text-secondary mb-2">{bug.descripcion}</div>}
                                      {canEditProjectTickets ? (
                                        <Form.Select size="sm" value={bug.estado} onChange={(e) => updateBugIssue(bug, { estado: e.target.value })}>
                                          {['ABIERTO', 'EN_ANALISIS', 'EN_PROGRESO', 'RESUELTO', 'CERRADO', 'REABIERTO'].map(item => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}
                                        </Form.Select>
                                      ) : (
                                        <Badge bg="light" text="dark" className="border">{String(bug.estado || 'ABIERTO').replaceAll('_', ' ')}</Badge>
                                      )}
                                    </div>
                                  ))}
                                </Card.Body>
                              </Card>
                            </Col>
                          )
                        })}
                      </Row>

                      <Row className="g-2 d-none">
                        <Col md={4}>
                          <Card className="border-0 shadow-sm bg-light h-100">
                            <Card.Header className="bg-white fw-bold text-danger py-3 border-bottom-0"><KanbanSquare size={18} className="me-2" />Bugs Reportados</Card.Header>
                            <Card.Body className="d-flex flex-column gap-2 p-2 pt-0">
                              <div className="p-3 bg-white border rounded-3 shadow-sm border-start border-4 border-danger">
                                <div className="d-flex justify-content-between mb-1"><strong className="small text-dark">BUG-453</strong> <Badge bg="danger">Blocker</Badge></div>
                                <p className="x-small text-muted mb-2">Timeout en Login con MFA. El endpoint responde 504 en Staging.</p>
                                <div className="x-small fw-bold text-secondary">Asignado a: Dev Backend</div>
                              </div>
                              <div className="p-3 bg-white border rounded-3 shadow-sm border-start border-4 border-warning">
                                <div className="d-flex justify-content-between mb-1"><strong className="small text-dark">BUG-457</strong> <Badge bg="warning" text="dark">Medium</Badge></div>
                                <p className="x-small text-muted mb-2">Responsive incorrecto en Tablet al abrir el carrito.</p>
                                <div className="x-small fw-bold text-secondary">Asignado a: Frontend UI</div>
                              </div>
                            </Card.Body>
                          </Card>
                        </Col>
                        <Col md={4}>
                          <Card className="border-0 shadow-sm bg-light h-100">
                            <Card.Header className="bg-white fw-bold text-primary py-3 border-bottom-0"><KanbanSquare size={18} className="me-2" />Mejoras / Tasks QA</Card.Header>
                            <Card.Body className="d-flex flex-column gap-2 p-2 pt-0">
                              <div className="p-3 bg-white border rounded-3 shadow-sm border-start border-4 border-primary">
                                <div className="d-flex justify-content-between mb-1"><strong className="small text-dark">TSK-102</strong> <Badge bg="primary">To Do</Badge></div>
                                <p className="x-small text-muted mb-2">Automatizar flujo de recuperación de contraseña con IA Agent.</p>
                                <div className="x-small fw-bold text-secondary">Asignado a: Ana (QA Auto)</div>
                              </div>
                            </Card.Body>
                          </Card>
                        </Col>
                        <Col md={4}>
                          <Card className="border-0 shadow-sm bg-light h-100">
                            <Card.Header className="bg-white fw-bold text-success py-3 border-bottom-0"><CheckCircle2 size={18} className="me-2" />Resueltos (Release Ready)</Card.Header>
                            <Card.Body className="d-flex flex-column gap-2 p-2 pt-0">
                              <div className="p-3 bg-white border rounded-3 shadow-sm border-start border-4 border-success opacity-75">
                                <div className="d-flex justify-content-between mb-1"><strong className="small text-dark text-decoration-line-through">BUG-451</strong> <Badge bg="success">Done</Badge></div>
                                <p className="x-small text-muted mb-0">Fallo de validación SSL en Backend corregido en Build v2.8.5.</p>
                              </div>
                            </Card.Body>
                          </Card>
                        </Col>
                      </Row>
                    </div>
                  )}

                </div>
              </div>
            </div>
          )}
          <Modal show={showProjectStatusHelp} onHide={() => setShowProjectStatusHelp(false)} centered size="lg">
            <Modal.Header closeButton>
              <Modal.Title className="fw-bold d-flex align-items-center gap-2">
                <Info size={20} className="text-primary" />
                Estados de proyecto
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <div className="project-status-help-list">
                {projectStatusHelpItems.map((item) => {
                  const variant = projectStatusVariant(item.status)
                  return (
                    <div key={item.status} className="project-status-help-item">
                      <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
                        <Badge bg={variant} text={variant === 'light' ? 'secondary' : undefined} className={variant === 'light' ? 'border' : ''}>
                          {item.status}
                        </Badge>
                        <span className="fw-bold small text-dark">{item.summary}</span>
                      </div>
                      <div className="small text-muted">{item.restriction}</div>
                    </div>
                  )
                })}
              </div>
              <div className="small text-secondary bg-light border rounded-3 p-3 mt-3">
                En esta version el estado ya se guarda y se muestra en la interfaz. Los bloqueos operativos por estado se aplicaran en una segunda pasada.
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="primary" onClick={() => setShowProjectStatusHelp(false)}>Entendido</Button>
            </Modal.Footer>
          </Modal>
          <Modal show={showEnvironmentModal} onHide={closeEnvironmentModal} centered size="lg">
            <Form key={editingEnvironment?.id || 'new-environment'} onSubmit={submitEnvironmentModal}>
              <Modal.Header closeButton>
                <Modal.Title className="fw-bold">{editingEnvironment ? 'Editar ambiente' : 'Nuevo ambiente'}</Modal.Title>
              </Modal.Header>
              <Modal.Body>
                <Row className="g-3">
                  <Col md={6}>
                    <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>Nombre del ambiente</RequiredLabel></Form.Label>
                    <Form.Control name="envName" defaultValue={editingEnvironment?.name || ''} placeholder="QA / UAT / PreProd" required />
                  </Col>
                  <Col md={6}>
                    <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>URL / Endpoint base</RequiredLabel></Form.Label>
                    <Form.Control name="envUrl" type="url" defaultValue={editingEnvironment?.url || ''} placeholder="https://qa.api.project.com" required />
                  </Col>
                  <Col md={6}>
                    <Form.Label className="x-small fw-bold text-muted">Version desplegada</Form.Label>
                    <Form.Control name="envVersion" defaultValue={editingEnvironment?.version || ''} placeholder="v1.0.0" />
                  </Col>
                  <Col md={6}>
                    <Form.Label className="x-small fw-bold text-muted">Estado</Form.Label>
                    <Form.Select name="envStatus" defaultValue={editingEnvironment?.status || 'Online'}>
                      <option value="Online">Online</option>
                      <option value="Offline">Offline</option>
                      <option value="Maintenance">Maintenance</option>
                      <option value="Unknown">Unknown</option>
                    </Form.Select>
                  </Col>
                  <Col xs={12}>
                    <Form.Label className="x-small fw-bold text-muted">Variables base del ambiente</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={6}
                      name="envVariables"
                      className="font-monospace small"
                      defaultValue={environmentVariablesText(editingEnvironment)}
                      placeholder={'BASE_URL=https://qa.api.project.com\nTENANT=qa-platform\nAPI_TIMEOUT=30000'}
                    />
                    <div className="small text-muted mt-2">Usa estas variables para configuracion tecnica del ambiente. Los usuarios, colores y datos de negocio van en datasets.</div>
                  </Col>
                </Row>
              </Modal.Body>
              <Modal.Footer>
                <Button type="button" variant="outline-secondary" onClick={closeEnvironmentModal}>Cancelar</Button>
                <Button type="submit" variant="primary" className="fw-bold">
                  <Save size={16} className="me-1" /> Guardar ambiente
                </Button>
              </Modal.Footer>
            </Form>
          </Modal>
        </div>
  )
}
