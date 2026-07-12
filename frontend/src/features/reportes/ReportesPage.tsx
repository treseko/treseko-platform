import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Row, Col, Card, Badge, Button, Table, Modal, Form, Tab, Tabs } from 'react-bootstrap'
import { BarChart3, RefreshCw, Activity, Folders, ChevronDown, ChevronRight, Clock, User, FileText, Image as ImageIcon, Share2, Copy, Download, ShieldCheck, Bug, SlidersHorizontal, Grip, RotateCcw, Save } from 'lucide-react'
import { Responsive, WidthProvider } from 'react-grid-layout/legacy'
import type { LayoutItem, ResponsiveLayouts } from 'react-grid-layout'
import { isImageAsset, resolveAssetUrl } from '../../shared/utils/assets'
import { openInNewTab } from '../../shared/utils/openExternal'
import { isEvidenceAvailable } from '../../shared/utils/evidenceAvailability'
import { escapeHtml, escapeSpreadsheetHtmlCell } from '../../shared/utils/exportSecurity'
import { API_BASE } from '../../app/constants'
import { formatDateTime } from '../../shared/utils/dateTime'
import { RequiredLabel } from '../../shared/ui/RequiredLabel'
import { PremiumGate } from '../premium/PremiumGate'
import { featureEnabled, humanizePremiumError, type FeatureLookup } from '../premium/featureAccess'
import { formatBugPriorityOption, getBugPriorityPresentation } from '../bugs/bugPresentation'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

const ResponsiveReportesGridLayout = WidthProvider(Responsive)

type ReportesViewConfig = {
  sections: Record<string, boolean>
  kpis: Record<string, boolean>
  aiBlocks: Record<string, boolean>
  columns: Record<string, Record<string, boolean>>
}

const REPORTES_VIEW_SECTIONS = [
  { id: 'context', label: 'Contexto de build' },
  { id: 'kpis', label: 'Tarjetas KPI' },
  { id: 'temporal', label: 'Progreso temporal' },
  { id: 'aiMetrics', label: 'Métricas IA' },
  { id: 'buildComparison', label: 'Comparativa vs build anterior' },
  { id: 'filters', label: 'Filtros de detalle' },
  { id: 'bugTraceability', label: 'Trazabilidad de bugs' },
  { id: 'bugs', label: 'Bugs vigentes' },
  { id: 'failures', label: 'Fallos y bloqueos' },
  { id: 'evidence', label: 'Evidencias' },
  { id: 'statusChart', label: 'Estado de ejecuciones' },
  { id: 'executionModeChart', label: 'Modo de ejecución' },
  { id: 'priority', label: 'Resultados por prioridad' },
  { id: 'suites', label: 'Resultados por suite/carpeta' },
  { id: 'trend', label: 'Tendencia entre builds' },
  { id: 'sharedHistory', label: 'Historial de links compartidos' },
]

const REPORTES_HISTORICAL_SECTIONS = [
  { id: 'buildComparison', label: 'Mostrar comparativa vs build anterior' },
  { id: 'trend', label: 'Mostrar tendencia de calidad por builds' },
]

const REPORTES_STANDARD_SECTIONS = REPORTES_VIEW_SECTIONS.filter(
  (section) => !REPORTES_HISTORICAL_SECTIONS.some((historical) => historical.id === section.id)
)

const REPORTES_WIDGET_IDS = REPORTES_VIEW_SECTIONS.map((section) => section.id)
const REPORTES_BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
const REPORTES_COLS = { lg: 12, md: 6, sm: 6, xs: 4, xxs: 2 }
const REPORTES_BREAKPOINT_KEYS = Object.keys(REPORTES_COLS) as Array<keyof typeof REPORTES_COLS>

const REPORTES_DEFAULT_LAYOUT: LayoutItem[] = [
  { i: 'context', x: 0, y: 0, w: 12, h: 3, minW: 4, minH: 2 },
  { i: 'kpis', x: 0, y: 3, w: 12, h: 4, minW: 4, minH: 3 },
  { i: 'temporal', x: 0, y: 7, w: 12, h: 3, minW: 4, minH: 3 },
  { i: 'aiMetrics', x: 0, y: 10, w: 12, h: 5, minW: 4, minH: 4 },
  { i: 'buildComparison', x: 0, y: 15, w: 12, h: 4, minW: 4, minH: 3 },
  { i: 'filters', x: 0, y: 19, w: 12, h: 3, minW: 4, minH: 2 },
  { i: 'bugTraceability', x: 0, y: 22, w: 5, h: 4, minW: 3, minH: 3 },
  { i: 'bugs', x: 5, y: 22, w: 7, h: 4, minW: 4, minH: 3 },
  { i: 'failures', x: 0, y: 26, w: 7, h: 5, minW: 4, minH: 3 },
  { i: 'evidence', x: 7, y: 26, w: 5, h: 5, minW: 3, minH: 3 },
  { i: 'statusChart', x: 0, y: 31, w: 6, h: 5, minW: 4, minH: 4 },
  { i: 'executionModeChart', x: 6, y: 31, w: 6, h: 5, minW: 4, minH: 4 },
  { i: 'priority', x: 0, y: 36, w: 12, h: 5, minW: 4, minH: 3 },
  { i: 'suites', x: 0, y: 41, w: 12, h: 6, minW: 4, minH: 4 },
  { i: 'trend', x: 0, y: 47, w: 12, h: 5, minW: 4, minH: 4 },
  { i: 'sharedHistory', x: 0, y: 52, w: 12, h: 5, minW: 4, minH: 3 },
]

const fitReportesLayoutItemToCols = (item: LayoutItem, cols: number): LayoutItem => ({
  ...item,
  x: Math.max(0, Math.min(item.x || 0, Math.max(0, cols - 1))),
  w: Math.max(1, Math.min(item.w || cols, cols)),
  minW: item.minW ? Math.min(item.minW, cols) : undefined,
  maxW: item.maxW ? Math.min(item.maxW, cols) : undefined,
})

const defaultReportesLayouts = (): ResponsiveLayouts<string> => Object.fromEntries(
  REPORTES_BREAKPOINT_KEYS.map((breakpoint) => {
    const cols = REPORTES_COLS[breakpoint]
    return [
      breakpoint,
      REPORTES_DEFAULT_LAYOUT.map((item) => {
        const width = breakpoint === 'lg' ? item.w : breakpoint === 'md' || breakpoint === 'sm' ? Math.min(item.w, cols) : cols
        return fitReportesLayoutItemToCols({ ...item, x: breakpoint === 'lg' ? item.x : 0, w: width }, cols)
      }),
    ]
  })
)

const sanitizeReportesLayouts = (value: any): ResponsiveLayouts<string> => {
  const defaults = defaultReportesLayouts()
  if (!value || typeof value !== 'object') return defaults
  return Object.fromEntries(REPORTES_BREAKPOINT_KEYS.map((breakpoint) => {
    const cols = REPORTES_COLS[breakpoint]
    const incoming = Array.isArray(value?.[breakpoint]) ? value[breakpoint] : []
    const byId = new Map(incoming.filter((item: any) => REPORTES_WIDGET_IDS.includes(item?.i)).map((item: any) => [item.i, item]))
    return [
      breakpoint,
      defaults[breakpoint].map((base) => fitReportesLayoutItemToCols({ ...base, ...(byId.get(base.i) || {}) }, cols)),
    ]
  }))
}

const withReportesEditFlags = (layouts: ResponsiveLayouts<string>, editing: boolean): ResponsiveLayouts<string> =>
  Object.fromEntries(Object.entries(layouts).map(([breakpoint, layout]) => [
    breakpoint,
    (layout || []).map((item) => ({ ...item, isDraggable: editing, isResizable: editing, resizeHandles: ['se'] })),
  ]))

const stripReportesEditFlags = (layouts: ResponsiveLayouts<string>): ResponsiveLayouts<string> =>
  Object.fromEntries(Object.entries(layouts).map(([breakpoint, layout]) => [
    breakpoint,
    (layout || []).map(({ isDraggable, isResizable, resizeHandles, ...item }) => item),
  ]))

const REPORTES_VIEW_KPIS = [
  { id: 'assigned', label: 'Casos asignados' },
  { id: 'executed', label: 'Ejecutados' },
  { id: 'pending', label: 'Sin ejecutar' },
  { id: 'passed', label: 'Pasados' },
  { id: 'failed', label: 'Fallidos' },
  { id: 'blocked', label: 'Bloqueados' },
  { id: 'coverage', label: 'Cobertura real' },
  { id: 'successExecuted', label: 'Éxito ejecutados' },
  { id: 'successTotal', label: 'Éxito total' },
  { id: 'openBugs', label: 'Bugs abiertos' },
  { id: 'newBugs', label: 'Bugs nuevos' },
  { id: 'recurrentBugs', label: 'Reincidentes' },
  { id: 'failuresWithoutBug', label: 'Fallos sin bug' },
  { id: 'bugsWithoutEvidence', label: 'Bugs sin evidencia' },
  { id: 'blocksWithoutReason', label: 'Bloqueos sin motivo' },
]

const REPORTES_VIEW_AI_BLOCKS = [
  { id: 'summary', label: 'Resumen IA' },
  { id: 'models', label: 'Modelos usados' },
  { id: 'categories', label: 'Categorías IA' },
  { id: 'errorCodes', label: 'Códigos de error IA' },
]

const enabledRecord = (items: { id: string }[]) => Object.fromEntries(items.map((item) => [item.id, true]))

const REPORTES_VIEW_COLUMNS: Record<string, { label: string, columns: { id: string, label: string }[] }> = {
  bugs: {
    label: 'Tabla de bugs',
    columns: [
      { id: 'bug', label: 'Bug' },
      { id: 'caseSuite', label: 'Caso / suite' },
      { id: 'severity', label: 'Severidad' },
      { id: 'status', label: 'Estado' },
      { id: 'time', label: 'Tiempo' },
      { id: 'evidence', label: 'Evidencia' },
      { id: 'action', label: 'Acción' },
    ],
  },
  failures: {
    label: 'Tabla de fallos/bloqueos',
    columns: [
      { id: 'case', label: 'Caso' },
      { id: 'status', label: 'Estado' },
      { id: 'step', label: 'Paso' },
      { id: 'bug', label: 'Bug' },
      { id: 'flags', label: 'Flags' },
    ],
  },
  priority: {
    label: 'Tabla de prioridad',
    columns: [
      { id: 'priority', label: 'Prioridad' },
      { id: 'total', label: 'Total' },
      { id: 'passed', label: 'Pasados' },
      { id: 'failed', label: 'Fallados' },
      { id: 'blocked', label: 'Bloqueados' },
      { id: 'pending', label: 'Sin ejecutar' },
      { id: 'coverage', label: 'Cobertura' },
      { id: 'success', label: 'Éxito ejec.' },
      { id: 'bugs', label: 'Bugs abiertos' },
      { id: 'risk', label: 'Riesgo' },
    ],
  },
  suites: {
    label: 'Tabla de suite/carpeta',
    columns: [
      { id: 'suite', label: 'Suite' },
      { id: 'total', label: 'Total' },
      { id: 'passed', label: 'Pasados' },
      { id: 'failed', label: 'Fallados' },
      { id: 'blocked', label: 'Bloqueados' },
      { id: 'pending', label: 'Sin ejecutar' },
      { id: 'successExecuted', label: 'Éxito ejec.' },
      { id: 'coverage', label: 'Cobertura' },
      { id: 'successTotal', label: 'Éxito total' },
      { id: 'bugs', label: 'Bugs' },
      { id: 'risk', label: 'Riesgo' },
      { id: 'lastExecution', label: 'Última ejec.' },
      { id: 'time', label: 'Tiempo' },
    ],
  },
  sharedHistory: {
    label: 'Historial de links',
    columns: [
      { id: 'snapshot', label: 'Snapshot' },
      { id: 'typeUser', label: 'Tipo / usuario' },
      { id: 'buildComponent', label: 'Build / componente' },
      { id: 'qaDefinition', label: 'Decisión QA' },
      { id: 'status', label: 'Estado' },
      { id: 'links', label: 'Links' },
      { id: 'actions', label: 'Acciones' },
    ],
  },
}

const PROJECT_REPORT_SETTING_GROUPS = {
  executive: [
    { id: 'summary', label: 'Resumen y decisión QA', group: 'normal' },
    { id: 'kpis', label: 'KPIs ejecutivos', group: 'normal' },
    { id: 'risks', label: 'Riesgos principales', group: 'normal' },
    { id: 'trend', label: 'Tendencia simple', group: 'trend' },
    { id: 'findings', label: 'Top hallazgos relevantes', group: 'technical' },
  ],
  development: [
    { id: 'summary', label: 'Resumen técnico', group: 'normal' },
    { id: 'distribution', label: 'Distribución de resultados', group: 'normal' },
    { id: 'failures', label: 'Fallos y bloqueos diagnosticables', group: 'technical' },
    { id: 'bugs', label: 'Bugs asociados a la build', group: 'technical' },
    { id: 'bug_details', label: 'Fichas públicas completas de bugs', group: 'technical' },
    { id: 'bug_tracking', label: 'Seguimiento por build', group: 'trend' },
    { id: 'regressions', label: 'Regresiones y reincidencias', group: 'trend' },
    { id: 'actions', label: 'Acciones recomendadas', group: 'normal' },
  ],
  internal: [
    { id: 'summary', label: 'Resumen y KPIs internos', group: 'normal' },
    { id: 'distribution', label: 'Distribución de resultados', group: 'normal' },
    { id: 'integrity', label: 'Integridad del snapshot', group: 'technical' },
    { id: 'temporal', label: 'Progreso temporal', group: 'trend' },
    { id: 'traceability', label: 'Trazabilidad de bugs', group: 'technical' },
    { id: 'trend', label: 'Tendencia entre builds', group: 'trend' },
    { id: 'failures', label: 'Fallos y bloqueos diagnosticables', group: 'technical' },
    { id: 'failed_steps', label: 'Pasos con incidencia', group: 'technical' },
    { id: 'bugs', label: 'Bugs asociados a la build', group: 'technical' },
    { id: 'evidence', label: 'Evidencias vinculadas', group: 'technical' },
    { id: 'bug_tracking', label: 'Seguimiento por build', group: 'trend' },
    { id: 'cases', label: 'Casos del snapshot', group: 'technical' },
  ],
}

type ProjectReportType = keyof typeof PROJECT_REPORT_SETTING_GROUPS

const PROJECT_REPORT_TYPE_META: Record<ProjectReportType, { label: string; title: string; description: string }> = {
  executive: {
    label: 'Ejecutivo',
    title: 'Informe Ejecutivo',
    description: 'Pensado para decisión, riesgos y lectura de calidad.',
  },
  development: {
    label: 'Desarrollo',
    title: 'Informe Desarrollo',
    description: 'Pensado para diagnóstico, bugs y replicación técnica.',
  },
  internal: {
    label: 'Interno',
    title: 'Informe Interno',
    description: 'Pensado para auditoría completa, trazabilidad y snapshot operativo.',
  },
}

const PROJECT_REPORT_SECTION_GROUPS = [
  { id: 'normal', label: 'Secciones principales' },
  { id: 'trend', label: 'Tendencias históricas' },
  { id: 'technical', label: 'Detalle técnico' },
] as const

const DEFAULT_PROJECT_REPORT_SETTINGS = {
  version: 'project-report-settings-v1',
  executive: { sections: enabledRecord(PROJECT_REPORT_SETTING_GROUPS.executive) },
  development: { sections: enabledRecord(PROJECT_REPORT_SETTING_GROUPS.development) },
  internal: { sections: enabledRecord(PROJECT_REPORT_SETTING_GROUPS.internal) },
}

const DEFAULT_REPORTES_VIEW: ReportesViewConfig = {
  sections: enabledRecord(REPORTES_VIEW_SECTIONS),
  kpis: enabledRecord(REPORTES_VIEW_KPIS),
  aiBlocks: enabledRecord(REPORTES_VIEW_AI_BLOCKS),
  columns: Object.fromEntries(Object.entries(REPORTES_VIEW_COLUMNS).map(([table, config]) => [table, enabledRecord(config.columns)])),
}

const REPORTES_VIEW_SUMMARY: ReportesViewConfig = {
  ...DEFAULT_REPORTES_VIEW,
  sections: {
    ...enabledRecord(REPORTES_VIEW_SECTIONS),
    aiMetrics: false,
    buildComparison: false,
    filters: false,
    bugTraceability: false,
    bugs: false,
    failures: false,
    evidence: false,
    priority: false,
    trend: false,
    sharedHistory: false,
  },
  kpis: {
    ...enabledRecord(REPORTES_VIEW_KPIS),
    newBugs: false,
    recurrentBugs: false,
    failuresWithoutBug: false,
    bugsWithoutEvidence: false,
    blocksWithoutReason: false,
  },
}

const mergeReportesView = (value: any): ReportesViewConfig => ({
  sections: { ...DEFAULT_REPORTES_VIEW.sections, ...(value?.sections || {}) },
  kpis: { ...DEFAULT_REPORTES_VIEW.kpis, ...(value?.kpis || {}) },
  aiBlocks: { ...DEFAULT_REPORTES_VIEW.aiBlocks, ...(value?.aiBlocks || {}) },
  columns: Object.fromEntries(Object.entries(DEFAULT_REPORTES_VIEW.columns).map(([table, columns]) => [
    table,
    { ...columns, ...(value?.columns?.[table] || {}) },
  ])),
})

const mergeProjectReportSettings = (value: any) => ({
  version: value?.version || DEFAULT_PROJECT_REPORT_SETTINGS.version,
  executive: {
    sections: {
      ...DEFAULT_PROJECT_REPORT_SETTINGS.executive.sections,
      ...(value?.executive?.sections || {}),
    },
  },
  development: {
    sections: {
      ...DEFAULT_PROJECT_REPORT_SETTINGS.development.sections,
      ...(value?.development?.sections || {}),
    },
  },
  internal: {
    sections: {
      ...DEFAULT_PROJECT_REPORT_SETTINGS.internal.sections,
      ...(value?.internal?.sections || {}),
    },
  },
})

type ReportesPageProps = {
  metricsLoading: boolean
  projectMetrics: any
  expandedMetricSuites: Set<string>
  setExpandedMetricSuites: (suites: Set<string>) => void
  loadProjectMetrics: (buildId?: string, options?: { silent?: boolean }) => void
  showFeedback: (title: string, message: string, variant?: string) => void
  onOpenEvidence: (attachmentOrUrl: any) => void
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  currentProjectId: string
  currentBuildId: string
  onOpenHistorial?: (filters?: Record<string, any>, runId?: string) => void
  onOpenBugTracker?: () => void
  canAccessCapability?: (capabilityId: any, level?: any) => boolean
  hasSystemFeature?: FeatureLookup
  loggedUser?: any
  onPreferencesUpdated?: (preferences: any) => void
}

export function ReportesPage({
  metricsLoading,
  projectMetrics,
  expandedMetricSuites,
  setExpandedMetricSuites,
  loadProjectMetrics,
  showFeedback,
  onOpenEvidence,
  fetchWithAuth,
  currentProjectId,
  currentBuildId,
  onOpenHistorial,
  onOpenBugTracker,
  canAccessCapability,
  hasSystemFeature,
  loggedUser,
  onPreferencesUpdated,
}: ReportesPageProps) {
  const [sharingReport, setSharingReport] = useState(false)
  const [sharedReport, setSharedReport] = useState<any | null>(null)
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareAcknowledged, setShareAcknowledged] = useState(false)
  const [sharedReportHistory, setSharedReportHistory] = useState<any[]>([])
  const [sharedReportHistoryBuildId, setSharedReportHistoryBuildId] = useState<string | null>(null)
  const [loadingSharedHistory, setLoadingSharedHistory] = useState(false)
  const [showFullSharedHistory, setShowFullSharedHistory] = useState(false)
  const [buildDefinition, setBuildDefinition] = useState('')
  const [qaComment, setQaComment] = useState('')
  const [detailFilters, setDetailFilters] = useState({
    suite: '',
    priority: '',
    status: '',
    owner: '',
    executionMode: '',
    bug: 'open',
    evidence: '',
  })
  const [snapshotBugLinks, setSnapshotBugLinks] = useState<Record<string, any>>({})
  const [creatingSnapshotBugId, setCreatingSnapshotBugId] = useState<string | null>(null)
  const [showViewConfig, setShowViewConfig] = useState(false)
  const [savingViewConfig, setSavingViewConfig] = useState(false)
  const profileSettings = loggedUser?.profileSettings || {}
  const reportesView = mergeReportesView(profileSettings.reportes_view)
  const [viewDraft, setViewDraft] = useState<ReportesViewConfig>(() => reportesView)
  const [editingReportesLayout, setEditingReportesLayout] = useState(false)
  const [reportesLayouts, setReportesLayouts] = useState<ResponsiveLayouts<string>>(() => sanitizeReportesLayouts(profileSettings.reportes_layout))
  const [reportesWidgets, setReportesWidgets] = useState<string[]>(() => (
    Array.isArray(profileSettings.reportes_widgets)
      ? REPORTES_WIDGET_IDS.filter((id) => profileSettings.reportes_widgets.includes(id))
      : REPORTES_WIDGET_IDS
  ))
  const [showReportSettings, setShowReportSettings] = useState(false)
  const [loadingReportSettings, setLoadingReportSettings] = useState(false)
  const [savingReportSettings, setSavingReportSettings] = useState(false)
  const [projectReportSettings, setProjectReportSettings] = useState<any>(() => DEFAULT_PROJECT_REPORT_SETTINGS)
  const [projectReportSettingsDraft, setProjectReportSettingsDraft] = useState<any>(() => DEFAULT_PROJECT_REPORT_SETTINGS)
  const reportsAdvancedEnabled = featureEnabled(hasSystemFeature, 'reports.advanced')
  const reportSnapshotsEnabled = featureEnabled(hasSystemFeature, 'reports.snapshots')
  const canExportReports = canAccessCapability ? canAccessCapability('reportes.exportar', 'read') : true
  const canViewSharedReportsByPermission = canAccessCapability ? canAccessCapability('reportes.compartir', 'read') : true
  const canShareReportsByPermission = canAccessCapability ? canAccessCapability('reportes.compartir', 'edit') : true
  const canConfigureReportsByPermission = canAccessCapability ? canAccessCapability('reportes.configurar', 'edit') : false
  const canViewSharedReports = canViewSharedReportsByPermission && reportSnapshotsEnabled
  const canShareReports = canShareReportsByPermission && reportSnapshotsEnabled
  const canConfigureReports = canConfigureReportsByPermission && reportsAdvancedEnabled
  const canCreateBugs = canAccessCapability ? canAccessCapability('bugs.crear', 'edit') : true

  const currentReportBuildId = projectMetrics?.build_id || currentBuildId
  const normalizeId = (value: any) => value ? String(value) : ''
  const hasAllSharedReportLinks = (item: any) => (
    Boolean(item?.links?.executive && item?.links?.development && item?.links?.internal)
  )
  const sharedReportMatchesCurrentBuild = (item: any, historyBuildId = sharedReportHistoryBuildId) => {
    if (!currentReportBuildId) return true
    const snapshotBuildIds = (item?.snapshots || []).map((snapshot: any) => snapshot?.build_id).filter(Boolean)
    const currentBuild = normalizeId(currentReportBuildId)
    return normalizeId(item?.build_id) === currentBuild
      || snapshotBuildIds.some((snapshotBuildId: any) => normalizeId(snapshotBuildId) === currentBuild)
      || normalizeId(historyBuildId) === currentBuild
  }
  const findReusableSharedReport = (history: any[], historyBuildId = sharedReportHistoryBuildId) => history.find((item) => (
    item?.activo
    && item?.is_latest === true
    && item?.has_new_values === false
    && hasAllSharedReportLinks(item)
    && sharedReportMatchesCurrentBuild(item, historyBuildId)
  ))
  const isCurrentSharedReportReusable = (report: any) => (
    report?.activo !== false
    && report?.has_new_values !== true
    && hasAllSharedReportLinks(report)
    && sharedReportMatchesCurrentBuild(report, null)
  )
  const reusableSharedReport = findReusableSharedReport(sharedReportHistory)
  const hasOutdatedSharedReport = sharedReportHistory.some((item) => item?.activo && item?.has_new_values)
  const buildDefinitionRequiresComment = ['RECHAZADA', 'BLOQUEADA', 'APROBADA_CON_OBSERVACIONES', 'PENDIENTE_DE_VALIDACION'].includes(buildDefinition)
  useEffect(() => {
    setViewDraft(reportesView)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(profileSettings.reportes_view || {})])

  useEffect(() => {
    setReportesLayouts(sanitizeReportesLayouts(profileSettings.reportes_layout))
    setReportesWidgets(
      Array.isArray(profileSettings.reportes_widgets)
        ? REPORTES_WIDGET_IDS.filter((id) => profileSettings.reportes_widgets.includes(id))
        : REPORTES_WIDGET_IDS
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedUser?.id, JSON.stringify(profileSettings.reportes_layout || {}), JSON.stringify(profileSettings.reportes_widgets || [])])

  const visibleReportesWidgetIds = useMemo(
    () => REPORTES_WIDGET_IDS.filter((id) => reportesWidgets.includes(id)),
    [reportesWidgets]
  )
  const editableReportesLayouts = useMemo(
    () => withReportesEditFlags(reportesLayouts, editingReportesLayout),
    [reportesLayouts, editingReportesLayout]
  )

  const isSectionVisible = (sectionId: string) => reportesView.sections[sectionId] !== false
  const isKpiVisible = (kpiId: string) => reportesView.kpis[kpiId] !== false
  const isAiBlockVisible = (blockId: string) => reportesView.aiBlocks[blockId] !== false
  const isColumnVisible = (table: string, columnId: string) => reportesView.columns?.[table]?.[columnId] !== false
  const visibleColumnCount = (table: string) => Math.max(1, REPORTES_VIEW_COLUMNS[table]?.columns.filter((column) => isColumnVisible(table, column.id)).length || 1)
  const setDraftGroupValue = (group: 'sections' | 'kpis' | 'aiBlocks', id: string, value: boolean) => {
    setViewDraft((current) => ({
      ...current,
      [group]: { ...current[group], [id]: value },
    }))
  }
  const setDraftColumnValue = (table: string, columnId: string, value: boolean) => {
    setViewDraft((current) => ({
      ...current,
      columns: {
        ...current.columns,
        [table]: { ...(current.columns[table] || {}), [columnId]: value },
      },
    }))
  }
  const countDraftEnabled = (items: { id: string }[], group: 'sections' | 'kpis' | 'aiBlocks') =>
    items.filter((item) => viewDraft[group]?.[item.id] !== false).length
  const countDraftColumnsEnabled = (table: string, columns: { id: string }[]) =>
    columns.filter((column) => viewDraft.columns?.[table]?.[column.id] !== false).length
  const setDraftGroupValues = (items: { id: string }[], group: 'sections' | 'kpis' | 'aiBlocks', value: boolean) => {
    setViewDraft((current) => ({
      ...current,
      [group]: {
        ...current[group],
        ...Object.fromEntries(items.map((item) => [item.id, value])),
      },
    }))
  }
  const setDraftColumnTableValues = (table: string, columns: { id: string }[], value: boolean) => {
    setViewDraft((current) => ({
      ...current,
      columns: {
        ...current.columns,
        [table]: {
          ...(current.columns[table] || {}),
          ...Object.fromEntries(columns.map((column) => [column.id, value])),
        },
      },
    }))
  }
  const applyViewPreset = (preset: 'all' | 'summary' | 'default') => {
    const next = preset === 'summary' ? REPORTES_VIEW_SUMMARY : DEFAULT_REPORTES_VIEW
    setViewDraft(mergeReportesView(next))
  }
  const saveReportesView = async () => {
    try {
      setSavingViewConfig(true)
      const nextSettings = {
        ...profileSettings,
        reportes_view: mergeReportesView(viewDraft),
      }
      const response = await fetchWithAuth(`${API_BASE}/users/me/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({ profile_settings: nextSettings }),
      })
      if (!response.ok) throw new Error(await response.text())
      const preferences = await response.json()
      onPreferencesUpdated?.(preferences)
      setShowViewConfig(false)
      showFeedback('Vista guardada', 'Tu configuración de Reportes y Métricas quedó guardada en tu perfil.', 'success')
    } catch (error: any) {
      showFeedback('No se pudo guardar', error?.message || 'Error guardando la vista personal.', 'danger')
    } finally {
      setSavingViewConfig(false)
    }
  }

  const saveReportesLayout = async () => {
    try {
      const nextSettings = {
        ...profileSettings,
        reportes_layout: stripReportesEditFlags(reportesLayouts),
        reportes_widgets: visibleReportesWidgetIds,
      }
      const response = await fetchWithAuth(`${API_BASE}/users/me/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({ profile_settings: nextSettings }),
      })
      if (!response.ok) throw new Error(await response.text())
      const preferences = await response.json()
      onPreferencesUpdated?.(preferences)
      setEditingReportesLayout(false)
      showFeedback('Layout guardado', 'El orden y tamaño de Reportes y Métricas quedó guardado en tu perfil.', 'success')
    } catch (error: any) {
      showFeedback('No se pudo guardar', error?.message || 'Error guardando el layout de reportes.', 'danger')
    }
  }

  const resetReportesLayout = () => {
    setReportesLayouts(defaultReportesLayouts())
    setReportesWidgets(REPORTES_WIDGET_IDS)
  }

  const renderReportesWidget = (id: string, children: ReactNode, visible = isSectionVisible(id)) => {
    const section = REPORTES_VIEW_SECTIONS.find((item) => item.id === id)
    if (!visible || !children) return null
    return (
      <div key={id} className="reportes-grid-item">
        <div className="reportes-widget-card">
          {editingReportesLayout && (
            <div className="reportes-widget-header" title={`Mover ${section?.label || id}`}>
              <Grip size={15} />
              <span>{section?.label || id}</span>
            </div>
          )}
          <div className="reportes-widget-body">
            {children}
          </div>
        </div>
      </div>
    )
  }

  const loadProjectReportSettings = async (options?: { open?: boolean }) => {
    if (!currentProjectId) return
    if (!canConfigureReports) {
      if (options?.open && canConfigureReportsByPermission && !reportsAdvancedEnabled) {
        showFeedback('Informes Premium', 'La configuracion avanzada de informes requiere Treseko Premium.', 'info')
      }
      return
    }
    setLoadingReportSettings(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/report-settings`)
      if (!response.ok) throw new Error(humanizePremiumError(await response.text()))
      const data = mergeProjectReportSettings(await response.json())
      setProjectReportSettings(data)
      setProjectReportSettingsDraft(data)
      if (options?.open) setShowReportSettings(true)
    } catch (error: any) {
      showFeedback('Configuración de informes', humanizePremiumError(error?.message) || 'No se pudo cargar la configuración del proyecto.', 'danger')
    } finally {
      setLoadingReportSettings(false)
    }
  }

  useEffect(() => {
    if (canConfigureReports) loadProjectReportSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, canConfigureReports])

  const setProjectReportSection = (reportType: ProjectReportType, sectionId: string, value: boolean) => {
    setProjectReportSettingsDraft((current: any) => ({
      ...current,
      [reportType]: {
        ...(current?.[reportType] || {}),
        sections: {
          ...(current?.[reportType]?.sections || {}),
          [sectionId]: value,
        },
      },
    }))
  }

  const setAllProjectReportSections = (reportType: ProjectReportType, value: boolean) => {
    setProjectReportSettingsDraft((current: any) => ({
      ...current,
      [reportType]: {
        ...(current?.[reportType] || {}),
        sections: Object.fromEntries(PROJECT_REPORT_SETTING_GROUPS[reportType].map((item) => [item.id, value])),
      },
    }))
  }

  const countProjectReportSectionsEnabled = (reportType: ProjectReportType) => {
    const sections = projectReportSettingsDraft?.[reportType]?.sections || {}
    return PROJECT_REPORT_SETTING_GROUPS[reportType].filter((section) => sections[section.id] !== false).length
  }

  const saveProjectReportSettings = async () => {
    if (!currentProjectId || !canConfigureReports) return
    setSavingReportSettings(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/report-settings`, {
        method: 'PATCH',
        body: JSON.stringify(projectReportSettingsDraft),
      })
      if (!response.ok) throw new Error(humanizePremiumError(await response.text()))
      const data = mergeProjectReportSettings(await response.json())
      setProjectReportSettings(data)
      setProjectReportSettingsDraft(data)
      setShowReportSettings(false)
      showFeedback('Informes configurados', 'La configuración del proyecto se aplicará a los próximos links compartidos.', 'success')
    } catch (error: any) {
      showFeedback('No se pudo guardar', humanizePremiumError(error?.message) || 'Error guardando la configuración de informes.', 'danger')
    } finally {
      setSavingReportSettings(false)
    }
  }

  const normalizeSharedReportFromHistory = (item: any) => ({
    snapshot_group_id: item.snapshot_group_id,
    metrics_hash: item.metrics_hash,
    reused: true,
    reusedFromHistory: true,
    created_at: item.created_at,
    expires_at: item.expires_at,
    activo: item.activo,
    build_id: item.build_id,
    componente_id: item.componente_id,
    links: item.links || {},
    tokens: item.tokens || {},
    snapshots: item.snapshots || [],
    requested_report_type: item.requested_report_type,
    build_definition: item.build_definition,
    qa_comment: item.qa_comment,
    definition_responsible_id: item.definition_responsible_id,
    definition_responsible_display: item.definition_responsible_display,
    definition_at: item.definition_at,
  })

  const openShareModal = async () => {
    if (!canShareReports) {
      showFeedback('Informes compartidos Premium', 'Los snapshots compartibles y su historial requieren Treseko Premium.', 'info')
      return
    }
    const { items, buildId } = await loadSharedReportHistory()
    const reusable = findReusableSharedReport(items, buildId)
    setSharedReport(reusable ? normalizeSharedReportFromHistory(reusable) : null)
    setShareAcknowledged(false)
    setShowShareModal(true)
  }

  const loadSharedReportHistory = useCallback(async () => {
    const emptyResult = { items: [] as any[], buildId: null as string | null }
    if (!currentProjectId || !canViewSharedReports) {
      setSharedReportHistory([])
      setSharedReportHistoryBuildId(null)
      return emptyResult
    }
    setLoadingSharedHistory(true)
    const buildId = projectMetrics?.build_id || currentBuildId || null
    try {
      const params = new URLSearchParams({ proyecto_id: currentProjectId })
      if (buildId) params.set('build_id', buildId)
      const response = await fetchWithAuth(`${API_BASE}/reports/share/history?${params.toString()}`)
      if (!response.ok) throw new Error(humanizePremiumError(await response.text()))
      const items = await response.json()
      setSharedReportHistory(items)
      setSharedReportHistoryBuildId(buildId)
      return { items, buildId }
    } catch (error) {
      setSharedReportHistory([])
      setSharedReportHistoryBuildId(null)
      return emptyResult
    } finally {
      setLoadingSharedHistory(false)
    }
  }, [currentProjectId, canViewSharedReports, projectMetrics?.build_id, currentBuildId, fetchWithAuth])

  useEffect(() => {
    loadSharedReportHistory()
  }, [loadSharedReportHistory])

  const shareReport = async () => {
    if (!canShareReports) {
      showFeedback('Informes compartidos Premium', 'Compartir informes congelados requiere Treseko Premium.', 'info')
      return
    }
    if (!currentProjectId || !projectMetrics) {
      showFeedback('Sin datos', 'No hay metricas del proyecto para compartir.', 'warning')
      return
    }
    if (!buildDefinition) {
      showFeedback('Decisión requerida', 'Selecciona la decisión tomada por QA antes de compartir.', 'warning')
      return
    }
    if (buildDefinitionRequiresComment && !qaComment.trim()) {
      showFeedback('Comentario requerido', 'Agrega una justificacion QA para esta definicion de build.', 'warning')
      return
    }
    setSharingReport(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/reports/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proyecto_id: currentProjectId,
          build_id: projectMetrics.build_id || currentBuildId || null,
          requested_report_type: 'all',
          build_definition: buildDefinition,
          qa_comment: qaComment.trim() || null,
        }),
      })
      if (!response.ok) throw new Error(humanizePremiumError(await response.text()))
      const data = await response.json()
      setSharedReport(data)
      setShareAcknowledged(true)
      setShowShareModal(true)
      showFeedback(
        data?.reused ? 'Snapshot reutilizado' : 'Paquete compartible creado',
        data?.reused
          ? 'No hubo cambios; se reutilizo el snapshot existente.'
          : 'Se generaron links Ejecutivo, Desarrollo e Interno.',
        'success'
      )
      loadSharedReportHistory()
    } catch (error: any) {
      showFeedback('No se pudo compartir', humanizePremiumError(error?.message) || 'Revisa permisos o metricas.', 'danger')
    } finally {
      setSharingReport(false)
    }
  }

  const copyLink = async (link?: string, label = 'Link') => {
    if (!link) return
    await navigator.clipboard?.writeText(link)
    showFeedback('Copiado', `${label} copiado al portapapeles.`, 'success')
  }

  const sharedReportTypes = [
    {
      type: 'executive',
      title: 'Informe ejecutivo',
      badge: 'Publico',
      description: 'Resumen para negocio, decision QA, estado general y riesgos principales.',
    },
    {
      type: 'development',
      title: 'Informe para desarrollo',
      badge: 'Publico sanitizado',
      description: 'Detalle tecnico accionable para el equipo, sin exponer datos internos sensibles.',
    },
    {
      type: 'internal',
      title: 'Informe interno actual',
      badge: 'Autenticado',
      description: 'Vista completa del informe que estas revisando, con mayor contexto operativo.',
    },
  ]

  const sharedReportFilename = (type: string, extension: string) => {
    const suffix = type === 'executive' ? 'ejecutivo' : type === 'development' ? 'desarrollo' : 'interno'
    return reportFilename(extension).replace(`.${extension}`, `-${suffix}.${extension}`)
  }

  const sharedMarkdownUrl = (report: any, type: string) => {
    const link = report?.links?.[type]
    return link ? `${link}.md` : ''
  }

  const proxiedReportUrl = (url: string) => {
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
    } catch (error) {
      return url
    }
    return url
  }

  const frontendReportUrl = (url: string) => {
    try {
      const parsed = new URL(url, window.location.origin)
      if (parsed.pathname.startsWith('/informes/') || parsed.pathname.startsWith('/informes-internos/')) {
        return `${window.location.origin}${parsed.pathname}${parsed.search}`
      }
      if (parsed.pathname.startsWith('/s/reports') || parsed.pathname.startsWith('/reports/internal')) {
        return `${window.location.origin}${API_BASE}${parsed.pathname}${parsed.search}`
      }
    } catch (error) {
      return url
    }
    return url
  }

  const internalReportViewerUrl = (url: string) => {
    try {
      const parsed = new URL(url, window.location.origin)
      const prettyMatch = parsed.pathname.match(/^\/informes-internos\/[^/]+\/[^/]+\/[^/]+\/([^/?#]+)$/)
      if (prettyMatch?.[1]) {
        return `${window.location.origin}${parsed.pathname}`
      }
      const match = parsed.pathname.match(/^\/reports\/internal\/([^/?#]+)$/)
      if (match?.[1]) {
        return `${window.location.origin}/?internal_report=${encodeURIComponent(match[1])}`
      }
    } catch (error) {
      return url
    }
    return url
  }

  const shareableReportUrl = (url: string, type: string) => (
    type === 'internal' ? internalReportViewerUrl(url) : frontendReportUrl(url)
  )

  const sharedReportPreview = (report: any, type: string) => {
    const snapshot = (report?.snapshots || []).find((item: any) => item?.token === report?.tokens?.[type])
      || (report?.snapshots || []).find((item: any) => String(item?.payload?.metadata?.report_type || '').toLowerCase() === type)
      || {}
    const metadata = snapshot?.payload?.metadata || {}
    const metrics = snapshot?.payload?.metrics || {}
    return {
      organization: metadata.organizacion || 'Solucion',
      project: metadata.proyecto || 'Proyecto',
      build: metadata.build || metrics.build_name || 'Build',
      component: metadata.componente || 'Componente',
      qa: report?.build_definition || metadata.build_definition || 'Sin decisión QA',
    }
  }

  const isInternalReportUrl = (url: string) => {
    try {
      const pathname = new URL(url, window.location.origin).pathname
      return pathname.startsWith('/reports/internal') || pathname.startsWith('/informes-internos/')
    } catch (error) {
      return false
    }
  }

  const openSharedReport = async (url?: string, label = 'Informe') => {
    if (!url) return
    if (!isInternalReportUrl(url)) {
      openInNewTab(proxiedReportUrl(url))
      return
    }

    const reportWindow = window.open('', '_blank')
    if (!reportWindow) {
      showFeedback('Popup bloqueado', 'Habilita ventanas emergentes para abrir el informe.', 'warning')
      return
    }
    reportWindow.opener = null
    reportWindow.document.write('<p style="font-family:Arial,sans-serif;padding:24px">Abriendo informe interno...</p>')
    try {
      const response = await fetchWithAuth(proxiedReportUrl(url))
      if (!response.ok) throw new Error(await response.text())
      const html = await response.text()
      const baseTag = `<base href="${escapeHtml(frontendReportUrl(url))}">`
      const withBase = html.match(/<head[^>]*>/i)
        ? html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`)
        : html
      reportWindow.document.open()
      reportWindow.document.write(withBase)
      reportWindow.document.close()
      reportWindow.opener = null
    } catch (error: any) {
      reportWindow.close()
      showFeedback('No se pudo abrir', error?.message || `No se pudo abrir ${label}.`, 'danger')
    }
  }

  const downloadSharedMarkdown = async (report: any, type: string, label: string) => {
    const url = sharedMarkdownUrl(report, type)
    if (!url) return
    try {
      const response = await fetchWithAuth(proxiedReportUrl(url))
      if (!response.ok) throw new Error(await response.text())
      const content = await response.text()
      downloadTextFile(content, sharedReportFilename(type, 'md'), 'text/markdown;charset=utf-8')
      showFeedback('Markdown generado', `${label} descargado en .md.`, 'success')
    } catch (error: any) {
      showFeedback('No se pudo descargar .md', error?.message || 'Revisa el link del informe.', 'danger')
    }
  }

  const createBugFromReportSnapshot = async (snapshot: any) => {
    if (!snapshot?.id) return
    setCreatingSnapshotBugId(snapshot.id)
    try {
      const note = snapshot.comentarios || snapshot.error_log || ''
      const response = await fetchWithAuth(`${API_BASE}/snapshots/${snapshot.id}/bugs/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resultado_obtenido: note || 'Fallo observado desde Reportes y Metricas.',
          notas_qa: note || null,
        }),
      })
      if (!response.ok) throw new Error(await response.text())
      const bug = await response.json()
      setSnapshotBugLinks((current) => ({ ...current, [snapshot.id]: bug }))
      showFeedback('Bug creado', `${bug.codigo} quedo vinculado al snapshot del reporte.`, 'success')
    } catch (error: any) {
      showFeedback('No se pudo crear bug', error?.message || 'Revisa permisos y contexto del snapshot.', 'danger')
    } finally {
      setCreatingSnapshotBugId(null)
    }
  }

  const exportSharedReportPdf = async (url: string, type: string, label: string) => {
    if (!url) return
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      showFeedback('Popup bloqueado', 'Habilita ventanas emergentes para exportar el PDF.', 'warning')
      return
    }
    printWindow.opener = null
    printWindow.document.write('<p style="font-family:Arial,sans-serif;padding:24px">Preparando PDF...</p>')
    try {
      const response = await fetchWithAuth(proxiedReportUrl(url))
      if (!response.ok) throw new Error(await response.text())
      const html = await response.text()
      const baseTag = `<base href="${escapeHtml(frontendReportUrl(url))}">`
      const printScript = '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},300);});</script>'
      const withBase = html.match(/<head[^>]*>/i)
        ? html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`)
        : html
      const printableHtml = withBase.match(/<\/body>/i)
        ? withBase.replace(/<\/body>/i, `${printScript}</body>`)
        : `${withBase}${printScript}`
      printWindow.document.open()
      printWindow.document.write(printableHtml)
      printWindow.document.close()
      printWindow.opener = null
      showFeedback('Exportacion PDF', `${label} abierto para guardar como PDF.`, 'success')
    } catch (error: any) {
      printWindow.close()
      showFeedback('No se pudo exportar PDF', error?.message || 'Revisa el link del informe.', 'danger')
    }
  }

  const revokeSharedBundle = async (item: any) => {
    if (!canViewSharedReports) return
    const token = item?.tokens?.executive || item?.tokens?.development || item?.tokens?.internal
    if (!token) return
    try {
      const response = await fetchWithAuth(`${API_BASE}/reports/share/${token}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(humanizePremiumError(await response.text()))
      showFeedback('Paquete revocado', 'Se revocaron las vistas Ejecutivo, Desarrollo e Interno del snapshot.', 'success')
      loadSharedReportHistory()
    } catch (error: any) {
      showFeedback('No se pudo revocar', humanizePremiumError(error?.message) || 'Revisa permisos del usuario.', 'danger')
    }
  }

  const markdownUrl = sharedReport?.public_url ? `${sharedReport.public_url}.md` : ''

  const exportMarkdown = () => {
    if (!shareAcknowledged || !markdownUrl) return
    const anchor = document.createElement('a')
    anchor.href = markdownUrl
    anchor.download = `${sharedReport?.tokens?.executive || 'informe-qa'}.md`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  const reportFilename = (extension: string) => {
    const projectPart = String(projectMetrics?.project_name || projectMetrics?.proyecto || 'reporte-qa')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'reporte-qa'
    const buildPart = String(projectMetrics?.build_name || projectMetrics?.build || currentBuildId || 'build')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'build'
    return `${projectPart}-${buildPart}.${extension}`
  }

  const downloadTextFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  const flattenSuiteRowsForExport = (nodes: any[], parent = ''): any[] => nodes.flatMap((node: any) => {
    const suiteName = parent ? `${parent} / ${node.nombre}` : node.nombre
    const suiteRows = [{
      tipo: 'Suite',
      suite: suiteName,
      codigo: '',
      titulo: '',
      estado: '',
      prioridad: '',
      modo: '',
      total: node.total,
      pasados: node.pasados,
      fallados: node.fallados,
      bloqueados: node.bloqueados,
      pendientes: node.pendientes || 0,
      tasa: Number(node.total || 0) > 0 ? `${((Number(node.pasados || 0) / Number(node.total || 1)) * 100).toFixed(1)}%` : '0.0%',
      fecha: '',
      ejecutado_por: '',
      observaciones: '',
    }]
    const caseRows = (node.casos || []).map((caso: any) => ({
      tipo: 'Caso',
      suite: caso.suite_breadcrumb || suiteName,
      codigo: caso.codigo || '',
      titulo: caso.titulo || '',
      estado: caso.estado || '',
      prioridad: caso.prioridad || '',
      modo: caso.execution_mode || '',
      total: '',
      pasados: '',
      fallados: '',
      bloqueados: '',
      pendientes: '',
      tasa: '',
      fecha: caso.fecha_ejecucion ? formatDateTime(caso.fecha_ejecucion) : '',
      ejecutado_por: caso.ejecutado_por || '',
      observaciones: caso.observaciones || '',
    }))
    return [...suiteRows, ...caseRows, ...flattenSuiteRowsForExport(node.children || [], suiteName)]
  })

  const buildReportTablesHtml = () => {
    const suiteRows = flattenSuiteRowsForExport(suiteTree)
    const priorityRows = Object.entries(projectMetrics?.por_prioridad || {})
    const historyRows = projectMetrics?.historico_versions || []
    const summaryRows = [
      ['Cobertura', `${projectMetrics?.cobertura_porcentaje ?? 0}%`],
      ['Casos asignados', projectMetrics?.total_casos_asignados ?? 0],
      ['Casos ejecutados', projectMetrics?.total_ejecutados ?? 0],
      ['Pasados', reportStats.pasados ?? 0],
      ['Fallados', reportStats.fallados ?? 0],
      ['Bloqueados', reportStats.bloqueados ?? 0],
      ['Pendientes', reportStats.pendientes ?? 0],
      ['Bugs abiertos', bugMetrics.open ?? 0],
      ['Bugs totales', bugMetrics.total ?? 0],
    ]

    return `
      <h2>Resumen ejecutivo</h2>
      <table>
        <tbody>
          ${summaryRows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeSpreadsheetHtmlCell(value)}</td></tr>`).join('')}
        </tbody>
      </table>

      <h2>Resultados por prioridad</h2>
      <table>
        <thead><tr><th>Prioridad</th><th>Total</th><th>Pasados</th><th>Fallados</th><th>Bloqueados</th><th>Sin ejecutar</th></tr></thead>
        <tbody>
          ${priorityRows.length ? priorityRows.map(([prioridad, data]: [string, any]) => `
            <tr>
              <td>${escapeSpreadsheetHtmlCell(formatBugPriorityOption(prioridad))}</td>
              <td>${escapeSpreadsheetHtmlCell(data.total)}</td>
              <td>${escapeSpreadsheetHtmlCell(data.pasados)}</td>
              <td>${escapeSpreadsheetHtmlCell(data.fallados)}</td>
              <td>${escapeSpreadsheetHtmlCell(data.bloqueados)}</td>
              <td>${escapeSpreadsheetHtmlCell(data.pendientes || 0)}</td>
            </tr>
          `).join('') : '<tr><td colspan="6">Sin datos por prioridad</td></tr>'}
        </tbody>
      </table>

      <h2>Suites y casos</h2>
      <table>
        <thead><tr><th>Tipo</th><th>Suite</th><th>Codigo</th><th>Titulo</th><th>Estado</th><th>Prioridad</th><th>Modo</th><th>Total</th><th>Pasados</th><th>Fallados</th><th>Bloqueados</th><th>Pendientes</th><th>Tasa</th><th>Fecha</th><th>Ejecutado por</th><th>Observaciones</th></tr></thead>
        <tbody>
          ${suiteRows.length ? suiteRows.map(row => `
            <tr>
              <td>${escapeSpreadsheetHtmlCell(row.tipo)}</td>
              <td>${escapeSpreadsheetHtmlCell(row.suite)}</td>
              <td>${escapeSpreadsheetHtmlCell(row.codigo)}</td>
              <td>${escapeSpreadsheetHtmlCell(row.titulo)}</td>
              <td>${escapeSpreadsheetHtmlCell(row.estado)}</td>
              <td>${escapeSpreadsheetHtmlCell(formatBugPriorityOption(row.prioridad))}</td>
              <td>${escapeSpreadsheetHtmlCell(row.modo)}</td>
              <td>${escapeSpreadsheetHtmlCell(row.total)}</td>
              <td>${escapeSpreadsheetHtmlCell(row.pasados)}</td>
              <td>${escapeSpreadsheetHtmlCell(row.fallados)}</td>
              <td>${escapeSpreadsheetHtmlCell(row.bloqueados)}</td>
              <td>${escapeSpreadsheetHtmlCell(row.pendientes)}</td>
              <td>${escapeSpreadsheetHtmlCell(row.tasa)}</td>
              <td>${escapeSpreadsheetHtmlCell(row.fecha)}</td>
              <td>${escapeSpreadsheetHtmlCell(row.ejecutado_por)}</td>
              <td>${escapeSpreadsheetHtmlCell(row.observaciones)}</td>
            </tr>
          `).join('') : '<tr><td colspan="16">Sin suites ni casos para exportar</td></tr>'}
        </tbody>
      </table>

      <h2>Tendencia por build</h2>
      <table>
        <thead><tr><th>Build</th><th>Pasados</th><th>Fallados</th><th>Bloqueados</th><th>Cobertura</th></tr></thead>
        <tbody>
          ${historyRows.length ? historyRows.map((item: any) => `
            <tr>
              <td>${escapeSpreadsheetHtmlCell(item.build_name || item.nombre || '')}</td>
              <td>${escapeSpreadsheetHtmlCell(item.pasados)}</td>
              <td>${escapeSpreadsheetHtmlCell(item.fallados)}</td>
              <td>${escapeSpreadsheetHtmlCell(item.bloqueados)}</td>
              <td>${escapeSpreadsheetHtmlCell(item.cobertura_porcentaje ?? item.cobertura ?? '')}</td>
            </tr>
          `).join('') : '<tr><td colspan="5">Sin historial de builds</td></tr>'}
        </tbody>
      </table>
    `
  }

  const exportPdfReport = () => {
    if (!projectMetrics) {
      showFeedback('Sin datos', 'No hay metricas para exportar.', 'warning')
      return
    }
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      showFeedback('Popup bloqueado', 'Habilita ventanas emergentes para exportar el PDF.', 'warning')
      return
    }
    printWindow.opener = null
    const generatedAt = formatDateTime(new Date().toISOString())
    const html = `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(reportFilename('pdf'))}</title>
          <style>
            body{font-family:Arial,sans-serif;color:#111827;margin:32px;background:#fff}
            h1{font-size:24px;margin:0 0 6px}
            h2{font-size:16px;margin:24px 0 8px;color:#1d4ed8}
            .meta{color:#64748b;font-size:12px;margin-bottom:18px}
            table{width:100%;border-collapse:collapse;margin-bottom:18px;font-size:11px}
            th,td{border:1px solid #dbe3ef;padding:6px;text-align:left;vertical-align:top}
            th{background:#eef4ff;color:#334155}
            @media print{body{margin:14mm}button{display:none}}
          </style>
        </head>
        <body>
          <h1>Reporte analitico de calidad</h1>
          <div class="meta">
            Build: ${escapeHtml(projectMetrics?.build_name || projectMetrics?.build || currentBuildId || 'N/D')}<br/>
            Generado: ${escapeHtml(generatedAt)}
          </div>
          ${buildReportTablesHtml()}
          <script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 250); });</script>
        </body>
      </html>`
    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.opener = null
    showFeedback('Exportacion PDF', 'Se abrio la vista imprimible. Usa Guardar como PDF.', 'success')
  }

  const exportExcelReport = () => {
    if (!projectMetrics) {
      showFeedback('Sin datos', 'No hay metricas para exportar.', 'warning')
      return
    }
    const html = `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            table{border-collapse:collapse}
            th,td{border:1px solid #999;padding:5px}
            th{background:#d9eaf7;font-weight:bold}
          </style>
        </head>
        <body>
          <h1>Reporte analitico de calidad</h1>
          <p>Build: ${escapeHtml(projectMetrics?.build_name || projectMetrics?.build || currentBuildId || 'N/D')}</p>
          ${buildReportTablesHtml()}
        </body>
      </html>`
    downloadTextFile(`\ufeff${html}`, reportFilename('xls'), 'application/vnd.ms-excel;charset=utf-8')
    showFeedback('Exportacion Excel', 'Archivo XLS generado correctamente.', 'success')
  }

  const suiteTree = projectMetrics?.por_suite_tree?.length
    ? projectMetrics.por_suite_tree
    : Object.entries(projectMetrics?.por_suite || {}).map(([id, data]: [string, any]) => ({ id, ...data, children: [] }))
  const aiMetrics = projectMetrics?.ai_metrics || {}
  const bugMetrics = projectMetrics?.bug_metrics || {}
  const buildContext = projectMetrics?.build_context || {}
  const qaStatus = projectMetrics?.qa_status || {}
  const temporalMetrics = projectMetrics?.temporal_metrics || {}
  const bugTraceability = projectMetrics?.bug_traceability || {}
  const failureItems = projectMetrics?.failures_and_blockers || []
  const evidenceItems = projectMetrics?.evidence_items || []
  const evidenceSummary = projectMetrics?.evidence_summary || {}
  const comparison = projectMetrics?.comparison || {}
  const reportStats = projectMetrics?.stats || {}
  const formatInt = (value: any) => Number(value || 0).toLocaleString()
  const formatPercent = (value: any) => `${Number(value || 0).toFixed(1)}%`
  const formatHours = (value: any) => {
    if (value === null || value === undefined || value === '') return 'N/D'
    const hours = Number(value || 0)
    if (hours < 1) return `${Math.round(hours * 60)} min`
    if (hours < 48) return `${hours.toFixed(1)} h`
    return `${(hours / 24).toFixed(1)} dias`
  }
  const formatSeconds = (value: any) => {
    const seconds = Number(value || 0)
    if (!seconds) return '0 min'
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`
    return `${(seconds / 3600).toFixed(1)} h`
  }
  const riskVariant = (risk: any) => {
    const normalized = String(risk || '').toUpperCase()
    if (['ALTO', 'ALTA', 'CRITICA', 'CRITICO', 'P0', 'P1'].includes(normalized)) return 'danger'
    if (['MEDIO', 'MEDIA', 'P2'].includes(normalized)) return 'warning'
    return 'success'
  }
  const statusVariant = (state: any) => {
    const normalized = String(state || '').toUpperCase()
    if (normalized === 'BLOQUEADO' || normalized === 'NO_RECOMENDADO') return 'danger'
    if (normalized === 'RECOMENDADO_CON_OBSERVACIONES' || normalized === 'EN_EVALUACION') return 'warning'
    return 'success'
  }
  const displayedSharedHistory = showFullSharedHistory ? sharedReportHistory : sharedReportHistory.slice(0, 5)
  const uniqueOptions = (items: any[], getter: (item: any) => any) => Array.from(new Set(
    items.map(getter).filter((value) => value !== null && value !== undefined && String(value).trim() !== '').map((value) => String(value))
  )).sort((a, b) => a.localeCompare(b))
  const allReportBugs = projectMetrics?.bugs || []
  const suiteFilterOptions = uniqueOptions([...allReportBugs, ...failureItems], (item) => item.suite)
  const priorityFilterOptions = uniqueOptions([...allReportBugs, ...failureItems], (item) => item.prioridad)
  const ownerFilterOptions = uniqueOptions([...allReportBugs, ...failureItems], (item) => item.responsable)
  const matchesDetailFilters = (item: any, kind: 'bug' | 'failure' | 'evidence') => {
    const suite = String(item.suite || '')
    const priority = String(item.prioridad || '')
    const status = String(item.estado || item.status || '')
    const owner = String(item.responsable || item.created_by || '')
    const mode = String(item.execution_mode || '')
    const hasBug = kind === 'bug'
      ? true
      : Array.isArray(item.bug) ? item.bug.length > 0 : Boolean(item.bug)
    const bugIsOpen = kind === 'bug'
      ? item.is_open !== false
      : true
    const hasEvidence = kind === 'bug'
      ? Boolean(item.has_evidence)
      : kind === 'evidence'
        ? item.status === 'completa'
        : !item.flags?.sin_evidencia
    return (!detailFilters.suite || suite === detailFilters.suite)
      && (!detailFilters.priority || priority === detailFilters.priority)
      && (!detailFilters.status || status === detailFilters.status)
      && (!detailFilters.owner || owner === detailFilters.owner)
      && (!detailFilters.executionMode || mode === detailFilters.executionMode)
      && (!detailFilters.bug || (kind === 'bug'
        ? detailFilters.bug === 'open' ? bugIsOpen : detailFilters.bug === 'closed' ? !bugIsOpen : true
        : detailFilters.bug === 'with' ? hasBug : detailFilters.bug === 'without' ? !hasBug : true))
      && (!detailFilters.evidence || (detailFilters.evidence === 'with' ? hasEvidence : !hasEvidence))
  }
  const filteredReportBugs = allReportBugs.filter((item: any) => matchesDetailFilters(item, 'bug'))
  const filteredFailures = failureItems.filter((item: any) => matchesDetailFilters(item, 'failure'))
  const filteredEvidenceItems = evidenceItems.filter((item: any) => matchesDetailFilters(item, 'evidence'))
  const bugStatusIsOpen = (status: any) => !['RESUELTO', 'CERRADO', 'DUPLICADO', 'NO_REPRODUCIBLE', 'NO_CORRESPONDE'].includes(String(status || '').toUpperCase())
  const formatMoney = (value: any) => `$${Number(value || 0).toFixed(5)}`
  const formatMs = (value: any) => {
    const ms = Number(value || 0)
    if (!ms) return '0ms'
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
    return `${ms}ms`
  }
  const aiModels = Object.entries(aiMetrics.models || {}).sort((a: any, b: any) => Number(b[1]) - Number(a[1]))
  const aiFailureCategories = Object.entries(aiMetrics.failure_categories || {}).sort((a: any, b: any) => Number(b[1]) - Number(a[1]))
  const aiErrorCodes = Object.entries(aiMetrics.error_codes || {}).sort((a: any, b: any) => Number(b[1]) - Number(a[1]))
  const readableAiLabel = (value: any) => {
    const raw = String(value || '').trim()
    const labels: Record<string, string> = {
      blocked_by_engine: 'Bloqueado por el motor',
      target_not_found: 'Objetivo no encontrado',
      validation_failed: 'Validacion fallida',
      timeout: 'Tiempo agotado',
      navigation_failed: 'Navegacion fallida',
      unknown: 'Sin clasificar',
      AI_HUMAN_REVIEW_REQUIRED: 'Requiere revision humana',
      TARGET_NOT_FOUND: 'Objetivo no encontrado',
      VALIDATION_FAILED: 'Validacion fallida',
      TIMEOUT: 'Tiempo agotado',
      NAVIGATION_FAILED: 'Navegacion fallida',
    }
    if (labels[raw]) return labels[raw]
    return raw
      .replace(/^AI_/, '')
      .replace(/[_-]+/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, char => char.toUpperCase())
  }
  const pendingStatus = Number(reportStats.pendientes || 0)
  const statusChartData = [
    { name: 'Pasados', value: Number(reportStats.pasados || 0), color: '#198754' },
    { name: 'Fallados', value: Number(reportStats.fallados || 0), color: '#dc3545' },
    { name: 'Bloqueados', value: Number(reportStats.bloqueados || 0), color: '#0d6efd' },
    { name: 'Sin ejecutar', value: pendingStatus, color: '#6c757d' },
  ].filter(item => item.value > 0)
  const executionModeMetrics = projectMetrics?.por_modo_ejecucion || projectMetrics?.por_tipo_ejecucion || {}
  const executionModeData = [
    { name: 'Manual', cantidad: Number(executionModeMetrics.manual || 0), fill: '#6c757d' },
    { name: 'IA', cantidad: Number(executionModeMetrics.ia || executionModeMetrics.automatizada_ia || 0), fill: '#0d6efd' },
    { name: 'Automatizada', cantidad: Number(executionModeMetrics.automatizada || 0), fill: '#6f42c1' },
  ]
  const caseTypeMetrics = projectMetrics?.por_tipo_prueba || {}
  const caseTypeData = [
    { name: 'Manual', cantidad: Number(caseTypeMetrics.manual || 0) },
    { name: 'Automatizada', cantidad: Number(caseTypeMetrics.automatizada || 0) },
    { name: 'Automatizada IA', cantidad: Number(caseTypeMetrics.automatizada_ia || 0) },
  ].filter(item => item.cantidad > 0)
  const executedStatusTotal = Number(reportStats.pasados || 0) + Number(reportStats.fallados || 0) + Number(reportStats.bloqueados || 0)
  const assignedStatusTotal = Number(projectMetrics?.total_casos_asignados || (executedStatusTotal + pendingStatus))
  const statusChartTotal = statusChartData.reduce((sum, item) => sum + item.value, 0)
  let statusCursor = 0
  const statusGradient = statusChartData.length === 1
    ? statusChartData[0].color
    : `conic-gradient(${statusChartData.map(item => {
      const start = statusCursor
      statusCursor += statusChartTotal > 0 ? (item.value / statusChartTotal) * 100 : 0
      return `${item.color} ${start}% ${statusCursor}%`
    }).join(', ')})`
  const executionModeMax = Math.max(1, ...executionModeData.map(item => item.cantidad))
  const hasExecutionModeData = executionModeData.some(item => item.cantidad > 0)
  const workflowNodeSummary = Number(aiMetrics.workflow_custom_nodes_configured || 0) > 0
    ? `${formatInt(aiMetrics.workflow_base_nodes_configured)} base + ${formatInt(aiMetrics.workflow_custom_nodes_configured)} custom`
    : `${formatInt(aiMetrics.workflow_nodes_configured)} nodos configurados`

  const collectSuiteIds = (nodes: any[]): string[] => nodes.flatMap(node => [node.id, ...collectSuiteIds(node.children || [])])

  const renderEvidenceList = (caso: any) => {
    const evidencias = Array.isArray(caso.evidencias) ? caso.evidencias : []
    if (evidencias.length === 0 && !caso.evidencia_url) return null

    return (
      <div className="d-flex flex-wrap gap-2 mt-2">
        {evidencias.length > 0 ? evidencias.map((attachment: any) => (
          isEvidenceAvailable(attachment) && isImageAsset(attachment) ? (
            <button
              key={attachment.id}
              type="button"
              className="border rounded-2 bg-white p-0"
              title={attachment.filename_original}
              onClick={() => onOpenEvidence(attachment)}
            >
              <img src={resolveAssetUrl(attachment.public_url)} alt={attachment.filename_original} className="rounded-2" style={{ width: 42, height: 42, objectFit: 'cover' }} />
            </button>
          ) : (
            <Button key={attachment.id} variant={isEvidenceAvailable(attachment) ? 'outline-secondary' : 'outline-warning'} size="sm" className="x-small py-1 d-flex align-items-center gap-1" onClick={() => onOpenEvidence(attachment)}>
              <FileText size={13} /> {attachment.filename_original || 'Ver evidencia'}
              {!isEvidenceAvailable(attachment) && <Badge bg="warning" text="dark">Archivo no disponible</Badge>}
            </Button>
          )
        )) : (
          <Button variant="outline-secondary" size="sm" className="x-small py-1 d-flex align-items-center gap-1" onClick={() => onOpenEvidence(caso.evidencia_url)}>
            <ImageIcon size={13} /> Ver evidencia legacy
          </Button>
        )}
      </div>
    )
  }

  const renderSuiteRows = (nodes: any[], depth = 0): any[] => nodes.flatMap((data: any) => {
    const suiteId = data.id
    const ejecutadas = Number(data.pasados || 0) + Number(data.fallados || 0) + Number(data.bloqueados || 0)
    const tasaExito = Number(data.exito_sobre_ejecutados_porcentaje ?? (ejecutadas > 0 ? ((Number(data.pasados || 0) / ejecutadas) * 100) : 0)).toFixed(1)
    const isExpanded = expandedMetricSuites.has(suiteId)
    const hasDetails = (data.casos && data.casos.length > 0) || (data.children && data.children.length > 0)
    const rows = [
      <tr key={suiteId} style={{ cursor: hasDetails ? 'pointer' : 'default' }} onClick={() => {
        if (!hasDetails) return
        const newExpanded = new Set(expandedMetricSuites)
        if (isExpanded) newExpanded.delete(suiteId)
        else newExpanded.add(suiteId)
        setExpandedMetricSuites(newExpanded)
      }}>
        {isColumnVisible('suites', 'suite') && (
        <td className="text-center">
          {hasDetails && (isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
        </td>
        )}
        {isColumnVisible('suites', 'suite') && (
        <td className="fw-bold" style={{ paddingLeft: `${depth * 24 + 8}px` }}>
          {data.nombre}
          {data.breadcrumb && data.breadcrumb !== data.nombre && (
            <div className="x-small text-muted fw-normal">{data.breadcrumb}</div>
          )}
        </td>
        )}
        {isColumnVisible('suites', 'total') && <td className="text-center">{data.total}</td>}
        {isColumnVisible('suites', 'passed') && <td className="text-center text-success fw-bold">{data.pasados}</td>}
        {isColumnVisible('suites', 'failed') && <td className="text-center text-danger fw-bold">{data.fallados}</td>}
        {isColumnVisible('suites', 'blocked') && <td className="text-center text-primary fw-bold">{data.bloqueados}</td>}
        {isColumnVisible('suites', 'pending') && <td className="text-center text-secondary fw-bold">{data.pendientes || 0}</td>}
        {isColumnVisible('suites', 'successExecuted') && (
        <td className="text-center">
          <Badge bg={parseFloat(tasaExito) >= 80 ? 'success' : parseFloat(tasaExito) >= 50 ? 'warning' : 'danger'}>
            {tasaExito}%
          </Badge>
        </td>
        )}
        {isColumnVisible('suites', 'coverage') && <td className="text-center">{formatPercent(data.cobertura_porcentaje)}</td>}
        {isColumnVisible('suites', 'successTotal') && <td className="text-center">{formatPercent(data.exito_sobre_total_porcentaje)}</td>}
        {isColumnVisible('suites', 'bugs') && <td className="text-center">{formatInt(data.bugs_abiertos)}</td>}
        {isColumnVisible('suites', 'risk') && <td className="text-center"><Badge bg={riskVariant(data.riesgo)}>{data.riesgo || 'BAJO'}</Badge></td>}
        {isColumnVisible('suites', 'lastExecution') && <td className="text-center small">{data.ultima_ejecucion ? formatDateTime(data.ultima_ejecucion) : 'N/D'}</td>}
        {isColumnVisible('suites', 'time') && <td className="text-center small">{formatHours(data.duracion_horas)}</td>}
      </tr>
    ]

    if (isExpanded) {
      rows.push(...(data.casos || []).map((caso: any) => {
        const failedSnapshot = (caso.snapshots || []).find((snapshot: any) => ['FALLO', 'BLOQUEADO'].includes(String(snapshot.estado_paso || '').toUpperCase()))
        const linkedCaseBugs = Array.isArray(caso.bugs) ? caso.bugs : []
        const snapshotBug = failedSnapshot ? snapshotBugLinks[failedSnapshot.id] : null
        const visibleCaseBugs = snapshotBug && !linkedCaseBugs.some((bug: any) => String(bug.id) === String(snapshotBug.id))
          ? [...linkedCaseBugs, snapshotBug]
          : linkedCaseBugs
        const hasLinkedBugForFailure = visibleCaseBugs.length > 0
        return (
        <tr key={`${suiteId}-${caso.id}`} className="bg-light">
          {isColumnVisible('suites', 'suite') && <td></td>}
          <td colSpan={visibleColumnCount('suites')}>
            <div className="d-flex align-items-start gap-3 py-2 px-3" style={{ paddingLeft: `${depth * 24 + 16}px` }}>
              <Badge bg={caso.estado === 'PASO' ? 'success' : caso.estado === 'FALLO' ? 'danger' : caso.estado === 'BLOQUEADO' ? 'primary' : 'secondary'} className="mt-1">
                {caso.estado}
              </Badge>
              <div className="flex-grow-1">
                <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
                  <span className="font-monospace fw-bold text-primary x-small">{caso.codigo}</span>
                  <span className="fw-bold text-dark">{caso.titulo}</span>
                  {(() => {
                    const priority = getBugPriorityPresentation(caso.prioridad)
                    return (
                      <Badge bg={priority?.bg || 'light'} text={priority?.text || 'dark'} title={priority?.title || String(caso.prioridad || '')} className={`x-small ${priority?.bg === 'light' || !priority ? 'border' : ''}`}>
                        {priority?.shortLabel || caso.prioridad}
                      </Badge>
                    )
                  })()}
                  <Badge bg="light" text="dark" className="border x-small">{caso.tipo_prueba === 'AUTOMATIZADA_AI' ? 'IA' : caso.tipo_prueba === 'AUTOMATIZADA' ? 'AUTO' : 'MANUAL'}</Badge>
                  <Badge bg={caso.execution_mode === 'IA' ? 'primary' : caso.execution_mode === 'AUTOMATIZADA' ? 'info' : caso.execution_mode === 'EXTERNA' ? 'success' : 'secondary'} className="x-small">
                    Ejec. {caso.execution_mode === 'IA' ? 'IA' : caso.execution_mode === 'AUTOMATIZADA' ? 'Auto' : caso.execution_mode === 'EXTERNA' ? 'Externa' : 'Manual'}
                  </Badge>
                  {caso.review_status === 'REQUIERE_REVISION' && <Badge bg="warning" text="dark" className="x-small">Revision IA pendiente</Badge>}
                  {caso.review_status === 'REVISADA' && <Badge bg="success" className="x-small">IA revisada</Badge>}
                  {caso.ai?.error_code && <Badge bg="danger" className="x-small">{caso.ai.error_code}</Badge>}
                </div>
                <div className="x-small text-muted mb-1">{caso.suite_breadcrumb || data.breadcrumb || data.nombre}</div>
                {caso.descripcion && <p className="x-small text-muted mb-1">{caso.descripcion}</p>}
                <div className="d-flex gap-3 x-small text-muted flex-wrap">
                  {caso.fecha_ejecucion && (
                    <span>
                      <Clock size={12} className="me-1" />
                      {formatDateTime(caso.fecha_ejecucion, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                  {caso.ejecutado_por && (
                    <span>
                      <User size={12} className="me-1" />
                      {caso.ejecutado_por}
                    </span>
                  )}
                  {caso.duracion_segundos > 0 && (
                    <span>
                      <Activity size={12} className="me-1" />
                      {caso.duracion_segundos}s
                    </span>
                  )}
                  <span>v{caso.version_ejecutada}</span>
                </div>
                {caso.observaciones && (
                  <div className="mt-1 x-small text-secondary fst-italic">"{caso.observaciones}"</div>
                )}
                {renderEvidenceList(caso)}
                {visibleCaseBugs.length > 0 && (
                  <div className="mt-2 d-flex flex-wrap gap-2 align-items-center">
                    {visibleCaseBugs.map((bug: any) => (
                      <Badge
                        key={bug.id || bug.codigo}
                        bg={bugStatusIsOpen(bug.estado) || bug.is_open ? 'danger' : 'secondary'}
                        className="px-3 py-2"
                        title={bug.titulo || bug.estado || ''}
                      >
                        <Bug size={13} className="me-1" />
                        {bug.codigo}
                        {bug.estado && <span className="ms-1">· {bug.estado}</span>}
                      </Badge>
                    ))}
                    <span className="x-small text-muted">Bug vinculado a este caso/snapshot.</span>
                  </div>
                )}
                {failedSnapshot && canCreateBugs && !hasLinkedBugForFailure && (
                  <div className="mt-2 d-flex flex-wrap gap-2 align-items-center">
                    <Button
                      size="sm"
                      variant="outline-danger"
                      disabled={creatingSnapshotBugId === failedSnapshot.id}
                      onClick={(event) => {
                        event.stopPropagation()
                        createBugFromReportSnapshot(failedSnapshot)
                      }}
                    >
                      <Bug size={14} className="me-1" />
                      {creatingSnapshotBugId === failedSnapshot.id ? 'Creando bug...' : 'Crear bug'}
                    </Button>
                    <span className="x-small text-muted">Desde snapshot fallido del reporte.</span>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
        )
      }))
      rows.push(...renderSuiteRows(data.children || [], depth + 1))
    }

    return rows
  })

  return (
    <div className={`p-4 animate__animated animate__fadeIn text-dark text-start reportes-page ${editingReportesLayout ? 'is-editing-layout' : ''}`}>
      <div className="reportes-header d-flex flex-column flex-xl-row justify-content-between align-items-start gap-3 mb-4">
        <div className="reportes-header-title">
          <h4 className="fw-bold text-primary m-0 d-flex align-items-center gap-2">
            <BarChart3 size={24} className="flex-shrink-0" />
            <span>Centro de Control de Build QA</span>
          </h4>
          <div className="small text-muted">Reportes analiticos, trazabilidad, bugs, evidencias y decision QA de la build.</div>
        </div>
        <div className="reportes-toolbar d-flex flex-wrap gap-2 justify-content-start justify-content-xl-end">
          <div className="reportes-toolbar-group">
            <Button
              variant="outline-secondary"
              size="sm"
              className="fw-bold px-3 border-2 rounded-3 hover-bg-light shadow-none"
              onClick={() => {
                setViewDraft(reportesView)
                setShowViewConfig(true)
              }}
            >
              <SlidersHorizontal size={14} className="me-1" /> Configurar vista
            </Button>
            <Button
              variant={editingReportesLayout ? 'primary' : 'outline-secondary'}
              size="sm"
              className="fw-bold px-3 border-2 rounded-3 hover-bg-light shadow-none"
              disabled={!projectMetrics}
              onClick={() => setEditingReportesLayout((value) => !value)}
            >
              <Grip size={14} className="me-1" /> {editingReportesLayout ? 'Editando layout' : 'Ordenar bloques'}
            </Button>
            {editingReportesLayout && (
              <>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  className="fw-bold px-3 border-2 rounded-3 hover-bg-light shadow-none"
                  onClick={resetReportesLayout}
                >
                  <RotateCcw size={14} className="me-1" /> Restaurar layout
                </Button>
                <Button
                  variant="success"
                  size="sm"
                  className="fw-bold px-3 border-0 rounded-3 shadow-none"
                  onClick={saveReportesLayout}
                >
                  <Save size={14} className="me-1" /> Guardar layout
                </Button>
              </>
            )}
          </div>
          {canConfigureReportsByPermission && (
            <PremiumGate
              feature="reports.advanced"
              hasFeature={hasSystemFeature}
              title="Configuracion de informes Premium"
              description="Define plantillas Ejecutivo, Desarrollo e Interno por proyecto al activar Treseko Premium."
              mode="disabled"
            >
              <Button
                variant="outline-secondary"
                size="sm"
                className="fw-bold px-3 border-2 rounded-3 hover-bg-light shadow-none"
                disabled={loadingReportSettings}
                onClick={() => loadProjectReportSettings({ open: true })}
              >
                <SlidersHorizontal size={14} className="me-1" /> Configurar informes
              </Button>
            </PremiumGate>
          )}
          <div className="reportes-toolbar-group reportes-toolbar-group-exports">
            <Button variant="outline-secondary" size="sm" className="fw-bold px-3 border-2 rounded-3 hover-bg-light shadow-none" onClick={() => loadProjectMetrics()}>
              <RefreshCw size={14} className="me-1" /> Actualizar
            </Button>
            {canExportReports && (
              <Button variant="outline-secondary" size="sm" className="fw-bold px-3 border-2 rounded-3 hover-bg-light shadow-none" disabled={!projectMetrics} onClick={exportPdfReport}>
                <Download size={14} className="me-1" /> PDF
              </Button>
            )}
            {canShareReportsByPermission && (
              <PremiumGate
                feature="reports.snapshots"
                hasFeature={hasSystemFeature}
                title="Informes compartidos Premium"
                description="Crea snapshots congelados con links Ejecutivo, Desarrollo e Interno y trazabilidad de revocacion."
                mode="disabled"
              >
                <Button variant="outline-primary" size="sm" className="fw-bold px-3 border-2 rounded-3 hover-bg-light shadow-none" disabled={sharingReport || loadingSharedHistory || !projectMetrics} onClick={openShareModal}>
                  <Share2 size={14} className="me-1" /> {loadingSharedHistory ? 'Revisando...' : 'Compartir'}
                </Button>
              </PremiumGate>
            )}
            {canExportReports && (
              <Button variant="primary" size="sm" className="fw-bold px-3 border-0 shadow rounded-3 shadow-none" disabled={!projectMetrics} onClick={exportExcelReport}>
                <Download size={14} className="me-1" /> XLS
              </Button>
            )}
          </div>
        </div>
      </div>

      {metricsLoading ? (
        <div className="text-center py-5">
          <RefreshCw size={32} className="text-primary animate-pulse" />
          <p className="text-muted mt-2">Cargando metricas...</p>
        </div>
      ) : projectMetrics ? (
        <ResponsiveReportesGridLayout
          className="layout reportes-layout-grid"
          layouts={editableReportesLayouts}
          breakpoints={REPORTES_BREAKPOINTS}
          cols={REPORTES_COLS}
          rowHeight={76}
          isDraggable={editingReportesLayout}
          isResizable={editingReportesLayout}
          isBounded
          draggableHandle=".reportes-widget-header"
          draggableCancel=".reportes-widget-body, button, a, input, textarea, select, .form-check, table"
          resizeHandles={['se']}
          compactType="vertical"
          onLayoutChange={(_, allLayouts) => {
            if (editingReportesLayout) setReportesLayouts(stripReportesEditFlags(allLayouts))
          }}
        >
          {renderReportesWidget('context', (
          <Card className="border-0 shadow-sm p-4 rounded-3 bg-white mb-4">
            <div className="d-flex flex-wrap align-items-start justify-content-between gap-3">
              <div>
                <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
                  <Badge bg="light" text="dark" className="border">{buildContext.organization || 'Organizacion N/D'}</Badge>
                  <Badge bg="light" text="dark" className="border">{buildContext.project || 'Proyecto N/D'}</Badge>
                  <Badge bg="light" text="dark" className="border">{buildContext.component || 'Sin componente'}</Badge>
                  <Badge bg="primary">{buildContext.build || projectMetrics.build_name || 'Build'}</Badge>
                </div>
                <h5 className="fw-bold mb-1">{buildContext.build || projectMetrics.build_name || 'Build seleccionada'}</h5>
                <div className="small text-muted">
                  Plataforma: {buildContext.platform || 'N/D'} · Responsable: {buildContext.responsible || 'Sin responsable calculado'}
                </div>
              </div>
              <div className="text-end">
                <Badge bg={statusVariant(qaStatus.state)} className="px-3 py-2 mb-2">
                  {qaStatus.label || 'En evaluacion'}
                </Badge>
                <div>
                  <Badge bg={riskVariant(qaStatus.risk)} className="px-3 py-2">Riesgo {qaStatus.risk || 'BAJO'}</Badge>
                </div>
              </div>
            </div>
            <Row className="g-3 mt-3">
              {[
                ['Creacion build', buildContext.build_created_at ? formatDateTime(buildContext.build_created_at) : 'N/D'],
                ['Inicio ejecucion', buildContext.execution_started_at ? formatDateTime(buildContext.execution_started_at) : 'Sin ejecuciones'],
                ['Ultima ejecucion', buildContext.last_execution_at ? formatDateTime(buildContext.last_execution_at) : 'Sin ejecuciones'],
                ['Desde creacion', formatHours(buildContext.elapsed_since_build_creation_hours)],
                ['Tiempo ejecutado', formatSeconds(buildContext.total_execution_seconds)],
              ].map(([label, value]) => (
                <Col md key={label}>
                  <div className="border rounded-3 p-3 h-100">
                    <div className="x-small text-muted fw-bold text-uppercase">{label}</div>
                    <div className="fw-bold text-dark">{value}</div>
                  </div>
                </Col>
              ))}
            </Row>
            {Array.isArray(qaStatus.reasons) && qaStatus.reasons.length > 0 && (
              <div className="small text-muted mt-3">
                Motivo: {qaStatus.reasons.join(' · ')}
              </div>
            )}
          </Card>
          ))}

          {renderReportesWidget('kpis', (
          <Row className="g-3 mb-4 text-center">
            {[
              { id: 'assigned', l: 'Casos asignados', v: formatInt(projectMetrics.total_casos_asignados), c: 'dark', s: 'base total de calculo' },
              { id: 'executed', l: 'Ejecutados', v: formatInt(projectMetrics.total_ejecutados), c: 'primary', s: 'PASO + FALLO + BLOQUEADO' },
              { id: 'pending', l: 'Sin ejecutar', v: formatInt(reportStats.pendientes), c: 'secondary', s: 'asignados - ejecutados' },
              { id: 'passed', l: 'Pasados', v: formatInt(reportStats.pasados), c: 'success', s: 'ultimo resultado por caso' },
              { id: 'failed', l: 'Fallidos', v: formatInt(reportStats.fallados), c: 'danger', s: 'requieren analisis' },
              { id: 'blocked', l: 'Bloqueados', v: formatInt(reportStats.bloqueados), c: 'primary', s: 'requieren desbloqueo' },
              { id: 'coverage', l: 'Cobertura real', v: formatPercent(projectMetrics.cobertura_porcentaje), c: 'primary', s: 'ejecutados / asignados' },
              { id: 'successExecuted', l: 'Exito ejecutados', v: formatPercent(projectMetrics.exito_sobre_ejecutados_porcentaje), c: 'success', s: 'pasados / ejecutados' },
              { id: 'successTotal', l: 'Exito total', v: formatPercent(projectMetrics.exito_sobre_total_porcentaje), c: 'success', s: 'pasados / asignados' },
              { id: 'openBugs', l: 'Bugs abiertos', v: formatInt(bugMetrics.open), c: 'warning', s: `${formatInt(bugMetrics.total)} asociados` },
              { id: 'newBugs', l: 'Bugs nuevos', v: formatInt(bugMetrics.new_in_build), c: 'danger', s: 'detectados en esta build' },
              { id: 'recurrentBugs', l: 'Reincidentes', v: formatInt(bugMetrics.recurrent), c: 'danger', s: 'aparecen en mas de una referencia' },
              { id: 'failuresWithoutBug', l: 'Fallos sin bug', v: formatInt(failureItems.filter((item: any) => item?.flags?.sin_bug_asociado).length), c: 'danger', s: 'fallos/bloqueos accionables sin bug abierto' },
              { id: 'bugsWithoutEvidence', l: 'Bugs sin evidencia', v: formatInt(bugMetrics.without_evidence), c: 'warning', s: 'requieren adjunto o link' },
              { id: 'blocksWithoutReason', l: 'Bloqueos sin motivo', v: formatInt(failureItems.filter((item: any) => item?.flags?.bloqueo_sin_motivo).length), c: 'primary', s: 'sin diagnostico documentado' },
            ].filter((x) => isKpiVisible(x.id)).map((x) => (
              <Col md={4} xl={2} key={x.id}>
                <Card className="border-0 shadow-sm p-3 rounded-3 bg-white h-100">
                  <small className="text-muted fw-bold text-uppercase">{x.l}</small>
                  <h4 className={`fw-bold my-1 text-${x.c}`}>{x.v}</h4>
                  <span className="text-muted x-small">{x.s}</span>
                </Card>
              </Col>
            ))}
          </Row>
          ))}

          {renderReportesWidget('temporal', (
          <Row className="g-4 mb-4">
            <Col md={12}>
              <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
                <h6 className="fw-bold mb-3 text-secondary text-start d-flex align-items-center gap-2">
                  <Clock size={18} /> Progreso temporal de la build
                </h6>
                <Row className="g-3 text-center">
                  {[
                    ['Build a primera ejec.', formatHours(temporalMetrics.build_to_first_execution_hours)],
                    ['Primera a ultima ejec.', formatHours(temporalMetrics.first_to_last_execution_hours)],
                    ['Ciclo QA total', formatHours(temporalMetrics.qa_cycle_hours)],
                    ['Promedio por caso', formatSeconds(temporalMetrics.average_seconds_per_executed_case)],
                    ['Ultima actividad', temporalMetrics.last_activity_at ? formatDateTime(temporalMetrics.last_activity_at) : 'N/D'],
                    ['Dias sin actividad', temporalMetrics.days_without_activity === null || temporalMetrics.days_without_activity === undefined ? 'N/D' : Number(temporalMetrics.days_without_activity).toFixed(1)],
                    ['Tiempo restante estimado', formatSeconds(temporalMetrics.estimated_remaining_seconds)],
                  ].map(([label, value]) => (
                    <Col md={3} xl key={label}>
                      <div className="border rounded-3 p-3 h-100">
                        <div className="x-small text-muted fw-bold text-uppercase">{label}</div>
                        <div className="fw-bold text-dark">{value}</div>
                      </div>
                    </Col>
                  ))}
                </Row>
              </Card>
            </Col>
          </Row>
          ))}

          {renderReportesWidget('aiMetrics', Number(aiMetrics.executions || 0) > 0 ? (
            <Row className="g-4 mb-4">
              <Col md={12}>
                <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
                  <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                    <div>
                      <h6 className="fw-bold mb-1 text-secondary text-start d-flex align-items-center gap-2">
                        <Activity size={18} /> Metricas de ejecucion IA
                      </h6>
                      <div className="small text-muted text-start">
                        Datos agregados desde reportes IA y trazas del workflow para esta build.
                      </div>
                    </div>
                    {Number(aiMetrics.tokens_missing_executions || 0) > 0 && (
                      <Badge bg="warning" text="dark">
                        {formatInt(aiMetrics.tokens_missing_executions)} ejec. sin usage del proveedor
                      </Badge>
                    )}
                  </div>
                  {isAiBlockVisible('summary') && (
                  <Row className="g-3 text-center">
                    {[
                      { l: 'Ejecuciones IA', v: formatInt(aiMetrics.executions), s: `${formatInt(aiMetrics.passed)} pasadas / ${formatInt(aiMetrics.failed)} fallidas / ${formatInt(aiMetrics.blocked)} bloqueadas`, c: 'primary' },
                      { l: 'Revision IA', v: formatInt(aiMetrics.human_review_pending || aiMetrics.human_review_required), s: `${formatInt(aiMetrics.human_review_reviewed)} revisadas / ${formatInt(aiMetrics.human_review_required)} requeridas`, c: Number(aiMetrics.human_review_pending || aiMetrics.human_review_required || 0) > 0 ? 'warning' : 'success' },
                      { l: 'Confianza promedio', v: `${Number(aiMetrics.avg_confidence || 0).toFixed(0)}%`, s: 'solo ejecuciones con confianza', c: Number(aiMetrics.avg_confidence || 0) >= 80 ? 'success' : 'warning' },
                      { l: 'Tokens reportados', v: formatInt(aiMetrics.total_tokens), s: `${formatInt(aiMetrics.tokens_reported_executions)} ejecuciones con usage`, c: Number(aiMetrics.total_tokens || 0) > 0 ? 'info' : 'secondary' },
                      { l: 'Costo estimado', v: formatMoney(aiMetrics.estimated_cost), s: 'segun costo configurado', c: 'success' },
                      { l: 'Latencia IA', v: formatMs(aiMetrics.latency_ms), s: `promedio ${formatMs(aiMetrics.avg_latency_ms)}`, c: 'dark' },
                      { l: 'Trazas workflow', v: formatInt(aiMetrics.workflow_traces), s: workflowNodeSummary, c: 'primary' },
                    ].map((item, index) => {
                      const isReviewCard = item.l === 'Revision IA'
                      return (
                      <Col md={4} xl={2} key={index}>
                        <div className={`border rounded-3 p-3 h-100 ${isReviewCard ? 'bg-warning-subtle' : ''}`}>
                          <small className="text-muted fw-bold text-uppercase">{item.l}</small>
                          <h5 className={`fw-bold my-1 text-${item.c}`}>{item.v}</h5>
                          <span className="text-muted x-small">{item.s}</span>
                          {isReviewCard && Number(aiMetrics.human_review_pending || aiMetrics.human_review_required || 0) > 0 && (
                            <Button
                              variant="outline-warning"
                              size="sm"
                              className="w-100 mt-2 fw-bold"
                              onClick={() => {
                                const historyBuildId = projectMetrics.build_id || currentBuildId || null
                                if (!historyBuildId) {
                                  showFeedback('Historial', 'Selecciona una build para revisar ejecuciones IA.', 'warning')
                                  return
                                }
                                onOpenHistorial?.({ origin: 'IA', ai_review_status: 'REQUIERE_REVISION', build_id: historyBuildId })
                              }}
                            >
                              Revisar en historial
                            </Button>
                          )}
                        </div>
                      </Col>
                      )
                    })}
                  </Row>
                  )}
                  <Row className="g-3 mt-1">
                    {isAiBlockVisible('models') && (
                    <Col md={4}>
                      <div className="border rounded-3 p-3 h-100">
                        <div className="x-small text-muted fw-bold text-uppercase mb-2">Modelos usados</div>
                        {aiModels.length > 0 ? aiModels.map(([model, count]: any) => (
                          <div key={model} className="d-flex justify-content-between small border-top py-1">
                            <span className="font-monospace">{model}</span>
                            <strong>{count}</strong>
                          </div>
                        )) : <div className="small text-muted">Sin modelo informado en ai_report.</div>}
                      </div>
                    </Col>
                    )}
                    {isAiBlockVisible('categories') && (
                    <Col md={4}>
                      <div className="border rounded-3 p-3 h-100">
                        <div className="x-small text-muted fw-bold text-uppercase mb-2">Categorias IA</div>
                        {aiFailureCategories.length > 0 ? aiFailureCategories.map(([category, count]: any) => (
                          <div key={category} className="d-flex justify-content-between small border-top py-1">
                            <span>{readableAiLabel(category)}</span>
                            <strong>{count}</strong>
                          </div>
                        )) : <div className="small text-muted">Sin categorias de fallo registradas.</div>}
                      </div>
                    </Col>
                    )}
                    {isAiBlockVisible('errorCodes') && (
                    <Col md={4}>
                      <div className="border rounded-3 p-3 h-100">
                        <div className="x-small text-muted fw-bold text-uppercase mb-2">Codigos de error IA</div>
                        {aiErrorCodes.length > 0 ? aiErrorCodes.map(([code, count]: any) => (
                          <div key={code} className="d-flex justify-content-between small border-top py-1">
                            <span>{readableAiLabel(code)}</span>
                            <strong>{count}</strong>
                          </div>
                        )) : <div className="small text-muted">Sin codigos de error IA registrados.</div>}
                      </div>
                    </Col>
                    )}
                  </Row>
                </Card>
              </Col>
            </Row>
          ) : null)}

          {renderReportesWidget('buildComparison', (() => {
            const buildHistory = Array.isArray(projectMetrics.historico_versions) ? projectMetrics.historico_versions : []
            const currentIndex = Math.max(0, buildHistory.findIndex((item: any) => item.build_id === projectMetrics.build_id))
            const current = buildHistory[currentIndex]
            const previous = buildHistory[currentIndex + 1]
            if (!current || !previous) {
              return (
                <Row className="g-4 mb-4">
                  <Col md={12}>
                    <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
                      <h6 className="fw-bold mb-2 text-secondary text-start d-flex align-items-center gap-2">
                        <Activity size={18} /> Comparativa vs build anterior
                      </h6>
                      <div className="small text-muted">Sin build anterior para comparar.</div>
                    </Card>
                  </Col>
                </Row>
              )
            }
            const totalCurrent = current.pasados + current.fallados + current.bloqueados
            const totalPrevious = previous.pasados + previous.fallados + previous.bloqueados
            const tasaCurrent = totalCurrent > 0 ? (current.pasados / totalCurrent) * 100 : 0
            const tasaPrevious = totalPrevious > 0 ? (previous.pasados / totalPrevious) * 100 : 0
            const diffTasa = tasaCurrent - tasaPrevious
            const diffPasados = current.pasados - previous.pasados
            const diffFallados = current.fallados - previous.fallados
            return (
              <Row className="g-4 mb-4">
                <Col md={12}>
                  <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
                    <h6 className="fw-bold mb-3 text-secondary text-start d-flex align-items-center gap-2">
                      <Activity size={18} /> Comparativa vs build anterior
                    </h6>
                    <div className="d-flex justify-content-between align-items-center mb-3">
                      <div>
                        <Badge bg="light" text="dark" className="me-2 border">{previous.build_name}</Badge>
                        <span className="text-muted x-small">vs</span>
                        <Badge bg="primary" className="ms-2">{current.build_name}</Badge>
                      </div>
                    </div>
                    <Row className="g-3 text-center">
                      <Col md={2}>
                        <div className="border rounded-3 p-3">
                          <small className="text-muted d-block">Tasa de Éxito</small>
                          <h5 className={`fw-bold mb-1 ${diffTasa >= 0 ? 'text-success' : 'text-danger'}`}>
                            {tasaCurrent.toFixed(1)}%
                          </h5>
                          <span className={`x-small fw-bold ${diffTasa >= 0 ? 'text-success' : 'text-danger'}`}>
                            {diffTasa >= 0 ? '+' : ''}{diffTasa.toFixed(1)}%
                          </span>
                        </div>
                      </Col>
                      <Col md={2}>
                        <div className="border rounded-3 p-3">
                          <small className="text-muted d-block">Pasados</small>
                          <h5 className="fw-bold mb-1 text-success">{current.pasados}</h5>
                          <span className={`x-small fw-bold ${diffPasados >= 0 ? 'text-success' : 'text-danger'}`}>
                            {diffPasados >= 0 ? '+' : ''}{diffPasados}
                          </span>
                        </div>
                      </Col>
                      <Col md={2}>
                        <div className="border rounded-3 p-3">
                          <small className="text-muted d-block">Fallados</small>
                          <h5 className="fw-bold mb-1 text-danger">{current.fallados}</h5>
                          <span className={`x-small fw-bold ${diffFallados <= 0 ? 'text-success' : 'text-danger'}`}>
                            {diffFallados >= 0 ? '+' : ''}{diffFallados}
                          </span>
                        </div>
                      </Col>
                      <Col md={2}>
                        <div className="border rounded-3 p-3">
                          <small className="text-muted d-block">Bloqueados</small>
                          <h5 className="fw-bold mb-1 text-primary">{current.bloqueados}</h5>
                          <span className="x-small text-muted">
                            anterior: {previous.bloqueados}
                          </span>
                        </div>
                      </Col>
                      <Col md={2}>
                        <div className="border rounded-3 p-3">
                          <small className="text-muted d-block">Cobertura</small>
                          <h5 className={`fw-bold mb-1 ${(comparison.coverage_delta || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                            {formatPercent(current.cobertura_porcentaje)}
                          </h5>
                          <span className={`x-small fw-bold ${(comparison.coverage_delta || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                            {(comparison.coverage_delta || 0) >= 0 ? '+' : ''}{Number(comparison.coverage_delta || 0).toFixed(1)}%
                          </span>
                        </div>
                      </Col>
                      <Col md={2}>
                        <div className="border rounded-3 p-3">
                          <small className="text-muted d-block">Bugs abiertos</small>
                          <h5 className="fw-bold mb-1 text-warning">{formatInt(comparison.open_bugs_current)}</h5>
                          <span className="x-small text-muted">Reincidentes: {formatInt(comparison.recurrent_bugs_current)}</span>
                        </div>
                      </Col>
                    </Row>
                  </Card>
                </Col>
              </Row>
            )
          })())}

          {renderReportesWidget('filters', (
          <Card className="border-0 shadow-sm p-4 rounded-3 bg-white mb-4">
            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
              <div>
                <h6 className="fw-bold mb-1 text-secondary">Filtros de detalle</h6>
                <div className="small text-muted">Aplican a bugs, fallos/bloqueos y evidencias visibles en las tablas inferiores.</div>
              </div>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => setDetailFilters({ suite: '', priority: '', status: '', owner: '', executionMode: '', bug: 'open', evidence: '' })}
              >
                Limpiar filtros
              </Button>
            </div>
            <Row className="g-2">
              <Col md={3}>
                <Form.Select size="sm" value={detailFilters.suite} onChange={(event) => setDetailFilters((current) => ({ ...current, suite: event.target.value }))}>
                  <option value="">Todas las suites</option>
                  {suiteFilterOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Select size="sm" value={detailFilters.priority} onChange={(event) => setDetailFilters((current) => ({ ...current, priority: event.target.value }))}>
                  <option value="">Todas las prioridades</option>
                  {priorityFilterOptions.map((value) => <option key={value} value={value}>{formatBugPriorityOption(value)}</option>)}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Select size="sm" value={detailFilters.status} onChange={(event) => setDetailFilters((current) => ({ ...current, status: event.target.value }))}>
                  <option value="">Todos los estados</option>
                  {uniqueOptions([...allReportBugs, ...failureItems], (item) => item.estado).map((value) => <option key={value} value={value}>{value}</option>)}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Select size="sm" value={detailFilters.owner} onChange={(event) => setDetailFilters((current) => ({ ...current, owner: event.target.value }))}>
                  <option value="">Todos los responsables</option>
                  {ownerFilterOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Select size="sm" value={detailFilters.executionMode} onChange={(event) => setDetailFilters((current) => ({ ...current, executionMode: event.target.value }))}>
                  <option value="">Todos los modos</option>
                  {uniqueOptions([...allReportBugs, ...failureItems], (item) => item.execution_mode).map((value) => <option key={value} value={value}>{value}</option>)}
                </Form.Select>
              </Col>
              <Col md={1}>
                <Form.Select size="sm" value={detailFilters.bug} onChange={(event) => setDetailFilters((current) => ({ ...current, bug: event.target.value }))}>
                  <option value="open">Bugs vigentes</option>
                  <option value="closed">Cerrados/no corresponde</option>
                  <option value="">Todos</option>
                  <option value="with">Fallos con bug</option>
                  <option value="without">Fallos sin bug</option>
                </Form.Select>
              </Col>
              <Col md={1}>
                <Form.Select size="sm" value={detailFilters.evidence} onChange={(event) => setDetailFilters((current) => ({ ...current, evidence: event.target.value }))}>
                  <option value="">Evidencia</option>
                  <option value="with">Con evidencia</option>
                  <option value="without">Sin evidencia</option>
                </Form.Select>
              </Col>
            </Row>
          </Card>
          ))}

          {renderReportesWidget('bugTraceability', (
          <Row className="g-4 mb-4">
            {isSectionVisible('bugTraceability') && (
            <Col lg={isSectionVisible('bugs') ? 5 : 12}>
              <Card className="border-0 shadow-sm p-4 rounded-3 bg-white h-100">
                <h6 className="fw-bold mb-3 text-secondary text-start d-flex align-items-center gap-2">
                  <Bug size={18} /> Trazabilidad de bugs
                </h6>
                <Row className="g-2 text-center">
                  {[
                    ['MTTR', formatHours(bugTraceability.mttr_hours)],
                    ['Prom. abierto', formatHours(bugTraceability.avg_bug_open_hours)],
                    ['1er comentario', formatHours(bugTraceability.avg_first_comment_hours)],
                    ['Reabiertos', formatPercent(bugTraceability.reopened_percent)],
                    ['Con evidencia', formatPercent(bugTraceability.with_evidence_percent)],
                    ['Fallos con bug', formatPercent(bugTraceability.failures_with_bug_percent)],
                    ['Vencidos SLA', formatInt(bugTraceability.bugs_overdue_sla)],
                    ['Sin responsable', formatInt(bugMetrics.without_responsible)],
                  ].map(([label, value]) => (
                    <Col xs={6} key={label}>
                      <div className="border rounded-3 p-2 h-100">
                        <div className="x-small text-muted fw-bold text-uppercase">{label}</div>
                        <div className="fw-bold">{value}</div>
                      </div>
                    </Col>
                  ))}
                </Row>
              </Card>
            </Col>
            )}
            {isSectionVisible('bugs') && (
            <Col lg={isSectionVisible('bugTraceability') ? 7 : 12}>
              <Card className="border-0 shadow-sm p-4 rounded-3 bg-white h-100">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h6 className="fw-bold text-secondary text-start d-flex align-items-center gap-2 m-0">
                    <Bug size={18} /> Bugs vigentes asociados a la build
                  </h6>
                  <Badge bg="light" text="dark" className="border">{formatInt(filteredReportBugs.length)} registros</Badge>
                </div>
                <Table hover responsive className="mb-0 align-middle">
                  <thead>
                    <tr>
                      {isColumnVisible('bugs', 'bug') && <th>Bug</th>}
                      {isColumnVisible('bugs', 'caseSuite') && <th>Caso / suite</th>}
                      {isColumnVisible('bugs', 'severity') && <th>Sev.</th>}
                      {isColumnVisible('bugs', 'status') && <th>Estado</th>}
                      {isColumnVisible('bugs', 'time') && <th>Tiempo</th>}
                      {isColumnVisible('bugs', 'evidence') && <th>Evidencia</th>}
                      {isColumnVisible('bugs', 'action') && <th className="text-end">Accion</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReportBugs.slice(0, 8).map((bug: any) => (
                      <tr key={bug.id}>
                        {isColumnVisible('bugs', 'bug') && (
                        <td>
                          <div className="fw-bold">{bug.codigo}</div>
                          <div className="x-small text-muted text-truncate" style={{ maxWidth: 220 }}>{bug.titulo}</div>
                        </td>
                        )}
                        {isColumnVisible('bugs', 'caseSuite') && (
                        <td>
                          <div className="fw-semibold x-small">{bug.case_code || 'Sin caso'}</div>
                          <div className="x-small text-muted text-truncate" style={{ maxWidth: 220 }}>{bug.suite || 'Sin suite'}</div>
                        </td>
                        )}
                        {isColumnVisible('bugs', 'severity') && <td><Badge bg={riskVariant(bug.severidad)}>{bug.severidad}</Badge></td>}
                        {isColumnVisible('bugs', 'status') && (
                        <td>
                          <Badge bg={bug.is_open ? 'warning' : 'secondary'} text={bug.is_open ? 'dark' : undefined}>{bug.estado}</Badge>
                          {bug.recurrent && <Badge bg="danger" className="ms-1">Reinc.</Badge>}
                        </td>
                        )}
                        {isColumnVisible('bugs', 'time') && <td className="small">{formatHours(bug.tiempo_abierto_horas ?? bug.tiempo_resolucion_horas)}</td>}
                        {isColumnVisible('bugs', 'evidence') && (
                        <td>
                          <Badge bg={bug.has_evidence ? 'success' : 'danger'}>{bug.has_evidence ? 'Completa' : 'Faltante'}</Badge>
                        </td>
                        )}
                        {isColumnVisible('bugs', 'action') && (
                        <td className="text-end">
                          <Button variant="outline-primary" size="sm" onClick={() => onOpenBugTracker ? onOpenBugTracker() : showFeedback('Bug Tracker', 'Abre la seccion Bug Tracker para ver el detalle completo.', 'info')}>
                            Ver
                          </Button>
                        </td>
                        )}
                      </tr>
                    ))}
                    {filteredReportBugs.length === 0 && (
                      <tr><td colSpan={visibleColumnCount('bugs')} className="text-center text-muted py-4">Sin bugs asociados para los filtros seleccionados.</td></tr>
                    )}
                  </tbody>
                </Table>
              </Card>
            </Col>
            )}
          </Row>
          ), isSectionVisible('bugTraceability') || isSectionVisible('bugs'))}

          {renderReportesWidget('failures', (
          <Row className="g-4 mb-4">
            {isSectionVisible('failures') && (
            <Col lg={isSectionVisible('evidence') ? 7 : 12}>
              <Card className="border-0 shadow-sm p-4 rounded-3 bg-white h-100">
                <h6 className="fw-bold mb-3 text-secondary text-start">Fallos y bloqueos accionables</h6>
                <Table hover responsive className="mb-0 align-middle">
                  <thead>
                    <tr>
                      {isColumnVisible('failures', 'case') && <th>Caso</th>}
                      {isColumnVisible('failures', 'status') && <th>Estado</th>}
                      {isColumnVisible('failures', 'step') && <th>Paso</th>}
                      {isColumnVisible('failures', 'bug') && <th>Bug</th>}
                      {isColumnVisible('failures', 'flags') && <th>Flags</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFailures.slice(0, 8).map((item: any) => (
                      <tr key={`${item.case_id}-${item.failed_step || 'case'}`}>
                        {isColumnVisible('failures', 'case') && (
                        <td>
                          <div className="fw-bold">{item.case_code}</div>
                          <div className="x-small text-muted text-truncate" style={{ maxWidth: 260 }}>{item.case_title}</div>
                          <div className="x-small text-muted">{item.suite}</div>
                        </td>
                        )}
                        {isColumnVisible('failures', 'status') && <td><Badge bg={item.estado === 'FALLO' ? 'danger' : 'primary'}>{item.estado}</Badge></td>}
                        {isColumnVisible('failures', 'step') && <td className="small">{item.failed_step || 'Caso'}</td>}
                        {isColumnVisible('failures', 'bug') && <td className="small">{item.bug?.length ? item.bug.map((bug: any) => bug.codigo).join(', ') : 'Sin bug abierto'}</td>}
                        {isColumnVisible('failures', 'flags') && (
                        <td>
                          <div className="d-flex flex-wrap gap-1">
                            {item.flags?.sin_evidencia && <Badge bg="danger">Sin evidencia</Badge>}
                            {item.flags?.sin_bug_asociado && <Badge bg="warning" text="dark">Sin bug</Badge>}
                            {item.flags?.bloqueo_sin_motivo && <Badge bg="primary">Sin motivo</Badge>}
                          </div>
                        </td>
                        )}
                      </tr>
                    ))}
                    {filteredFailures.length === 0 && (
                      <tr><td colSpan={visibleColumnCount('failures')} className="text-center text-muted py-4">Sin fallos ni bloqueos para los filtros seleccionados.</td></tr>
                    )}
                  </tbody>
                </Table>
              </Card>
            </Col>
            )}
            {isSectionVisible('evidence') && (
            <Col lg={isSectionVisible('failures') ? 5 : 12}>
              <Card className="border-0 shadow-sm p-4 rounded-3 bg-white h-100">
                <h6 className="fw-bold mb-3 text-secondary text-start d-flex align-items-center gap-2">
                  <ImageIcon size={18} /> Evidencias
                </h6>
                <Row className="g-2 text-center mb-3">
                  {[
                    ['Total', evidenceSummary.total],
                    ['Completas', evidenceSummary.complete],
                    ['Insuficientes', evidenceSummary.insufficient],
                    ['Faltantes', evidenceSummary.missing],
                  ].map(([label, value]) => (
                    <Col xs={6} key={label}>
                      <div className="border rounded-3 p-2">
                        <div className="x-small text-muted fw-bold text-uppercase">{label}</div>
                        <div className="fw-bold">{formatInt(value)}</div>
                      </div>
                    </Col>
                  ))}
                </Row>
                <div className="d-flex flex-column gap-2">
                  {filteredEvidenceItems.slice(0, 5).map((item: any, index: number) => (
                    <div key={`${item.case_code}-${item.bug}-${index}`} className="border rounded-3 p-2 d-flex justify-content-between gap-2">
                      <div>
                        <div className="fw-semibold small">{item.case_code || item.bug || 'Evidencia'}</div>
                        <div className="x-small text-muted">{item.name || item.type}</div>
                      </div>
                      <Badge bg={item.status === 'completa' ? 'success' : item.status === 'insuficiente' ? 'warning' : 'danger'}>
                        {item.status}
                      </Badge>
                    </div>
                  ))}
                  {filteredEvidenceItems.length === 0 && <div className="text-center text-muted small py-4">Sin evidencias para los filtros seleccionados.</div>}
                </div>
              </Card>
            </Col>
            )}
          </Row>
          ), isSectionVisible('failures') || isSectionVisible('evidence'))}

          {renderReportesWidget('statusChart', (
          <Row className="g-4 mb-4">
            {isSectionVisible('statusChart') && (
            <Col md={isSectionVisible('executionModeChart') ? 6 : 12}>
              <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
                <h6 className="fw-bold mb-4 text-secondary text-start">Estado de Ejecuciones</h6>
                <div style={{ height: '260px' }}>
                  {statusChartData.length > 0 ? (
                    <div className="h-100 d-flex flex-column align-items-center justify-content-center gap-3">
                      <div
                        className="rounded-circle position-relative shadow-sm"
                        style={{
                          width: 150,
                          height: 150,
                          background: statusGradient,
                        }}
                        role="img"
                        aria-label={`Estado de ejecuciones: ${statusChartData.map(item => `${item.name} ${formatInt(item.value)}`).join(', ')}`}
                      >
                        <div
                          className="position-absolute top-50 start-50 translate-middle rounded-circle bg-white d-flex flex-column align-items-center justify-content-center text-center"
                          style={{ width: 86, height: 86 }}
                        >
                          <span className="fw-bold text-dark">{formatInt(statusChartTotal)}</span>
                          <span className="x-small text-muted">casos</span>
                        </div>
                      </div>
                      <div className="d-flex flex-wrap justify-content-center gap-3">
                        {statusChartData.map(item => (
                          <div key={item.name} className="d-flex align-items-center gap-1 x-small text-muted">
                            <span className="rounded-1 d-inline-block" style={{ width: 10, height: 10, backgroundColor: item.color }}></span>
                            <span>{item.name}</span>
                            <strong className="text-dark">{formatInt(item.value)}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="h-100 d-flex align-items-center justify-content-center text-muted small">
                      Sin ejecuciones registradas para graficar.
                    </div>
                  )}
                </div>
                <div className="text-muted x-small text-center mt-2">
                  Total asignadas: {formatInt(assignedStatusTotal)}{'\u00b7'}{' '}
                  Total ejecutadas: {formatInt(executedStatusTotal)}
                </div>
              </Card>
            </Col>
            )}

            {isSectionVisible('executionModeChart') && (
            <Col md={isSectionVisible('statusChart') ? 6 : 12}>
              <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
                <h6 className="fw-bold mb-4 text-secondary text-start">Por modo de ejecucion</h6>
                <div style={{ height: '260px' }}>
                  {hasExecutionModeData ? (
                    <div className="h-100 d-flex flex-column justify-content-end">
                      <div className="d-flex align-items-end justify-content-around gap-3 flex-grow-1 border-bottom px-2 pb-2">
                        {executionModeData.map(item => {
                          const heightPercent = item.cantidad > 0 ? Math.max(12, (item.cantidad / executionModeMax) * 100) : 0
                          return (
                            <div key={item.name} className="d-flex flex-column align-items-center justify-content-end h-100 flex-fill" style={{ minWidth: 74 }}>
                              <div className="fw-bold small text-dark mb-1">{formatInt(item.cantidad)}</div>
                              <div
                                className="rounded-top shadow-sm w-100"
                                style={{
                                  maxWidth: 72,
                                  height: `${heightPercent}%`,
                                  minHeight: item.cantidad > 0 ? 18 : 0,
                                  backgroundColor: item.fill,
                                  opacity: item.cantidad > 0 ? 1 : 0.18,
                                }}
                                title={`${item.name}: ${formatInt(item.cantidad)}`}
                              ></div>
                            </div>
                          )
                        })}
                      </div>
                      <div className="d-flex justify-content-around gap-3 pt-2 px-2">
                        {executionModeData.map(item => (
                          <div key={item.name} className="text-center x-small text-muted flex-fill" style={{ minWidth: 74 }}>
                            <span className="rounded-1 d-inline-block me-1" style={{ width: 9, height: 9, backgroundColor: item.fill }}></span>
                            {item.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="h-100 d-flex align-items-center justify-content-center text-muted small">
                      Sin ejecuciones reales para graficar por modo.
                    </div>
                  )}
                </div>
                {caseTypeData.length > 0 && (
                  <div className="border-top mt-3 pt-3">
                    <div className="x-small text-muted fw-bold text-uppercase mb-2">Tipo de caso</div>
                    <div className="d-flex flex-wrap gap-2">
                      {caseTypeData.map(item => (
                        <Badge key={item.name} bg="light" text="dark" className="border">
                          {item.name}: {formatInt(item.cantidad)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            </Col>
            )}
          </Row>
          ), isSectionVisible('statusChart') || isSectionVisible('executionModeChart'))}

          {renderReportesWidget('priority', Object.keys(projectMetrics.por_prioridad).length > 0 ? (
            <Row className="g-4 mb-4">
              <Col md={12}>
                <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
                  <h6 className="fw-bold mb-4 text-secondary text-start">Resultados por Prioridad</h6>
                  <Table hover responsive className="mb-0">
                    <thead>
                      <tr>
                        {isColumnVisible('priority', 'priority') && <th>Prioridad</th>}
                        {isColumnVisible('priority', 'total') && <th className="text-center">Total</th>}
                        {isColumnVisible('priority', 'passed') && <th className="text-center text-success">Pasados</th>}
                        {isColumnVisible('priority', 'failed') && <th className="text-center text-danger">Fallados</th>}
                        {isColumnVisible('priority', 'blocked') && <th className="text-center text-primary">Bloqueados</th>}
                        {isColumnVisible('priority', 'pending') && <th className="text-center text-secondary">Sin ejecutar</th>}
                        {isColumnVisible('priority', 'coverage') && <th className="text-center">Cobertura</th>}
                        {isColumnVisible('priority', 'success') && <th className="text-center">Exito ejec.</th>}
                        {isColumnVisible('priority', 'bugs') && <th className="text-center">Bugs abiertos</th>}
                        {isColumnVisible('priority', 'risk') && <th className="text-center">Riesgo</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(projectMetrics.por_prioridad).map(([prioridad, data]: [string, any]) => (
                        <tr key={prioridad}>
                          {isColumnVisible('priority', 'priority') && (
                            <td className="fw-bold text-capitalize" title={getBugPriorityPresentation(prioridad)?.title || prioridad}>
                              {getBugPriorityPresentation(prioridad)?.shortLabel || prioridad}
                            </td>
                          )}
                          {isColumnVisible('priority', 'total') && <td className="text-center">{data.total}</td>}
                          {isColumnVisible('priority', 'passed') && <td className="text-center text-success fw-bold">{data.pasados}</td>}
                          {isColumnVisible('priority', 'failed') && <td className="text-center text-danger fw-bold">{data.fallados}</td>}
                          {isColumnVisible('priority', 'blocked') && <td className="text-center text-primary fw-bold">{data.bloqueados}</td>}
                          {isColumnVisible('priority', 'pending') && <td className="text-center text-secondary fw-bold">{data.pendientes || 0}</td>}
                          {isColumnVisible('priority', 'coverage') && <td className="text-center">{formatPercent(data.cobertura_porcentaje)}</td>}
                          {isColumnVisible('priority', 'success') && <td className="text-center">{formatPercent(data.exito_sobre_ejecutados_porcentaje)}</td>}
                          {isColumnVisible('priority', 'bugs') && <td className="text-center">{formatInt(data.bugs_abiertos)}</td>}
                          {isColumnVisible('priority', 'risk') && <td className="text-center"><Badge bg={riskVariant(data.riesgo)}>{data.riesgo || 'BAJO'}</Badge></td>}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              </Col>
            </Row>
          ) : null)}

          {renderReportesWidget('suites', suiteTree.length > 0 ? (
            <Row className="g-4 mb-4">
              <Col md={12}>
                <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
                  <div className="d-flex justify-content-between align-items-center mb-4">
                    <h6 className="fw-bold text-secondary text-start d-flex align-items-center gap-2 m-0">
                      <Folders size={18} /> Resultados por Suite / Carpeta
                    </h6>
                    <div className="d-flex gap-2">
                      <Button variant="outline-secondary" size="sm" className="x-small fw-bold" onClick={() => setExpandedMetricSuites(new Set(collectSuiteIds(suiteTree)))}>
                        Desplegar todo
                      </Button>
                      <Button variant="outline-secondary" size="sm" className="x-small fw-bold" onClick={() => setExpandedMetricSuites(new Set())}>
                        Contraer todo
                      </Button>
                    </div>
                  </div>
                  <Table hover responsive className="mb-0">
                    <thead>
                      <tr>
                        {isColumnVisible('suites', 'suite') && <th style={{ width: '40px' }}></th>}
                        {isColumnVisible('suites', 'suite') && <th>Suite</th>}
                        {isColumnVisible('suites', 'total') && <th className="text-center">Total</th>}
                        {isColumnVisible('suites', 'passed') && <th className="text-center text-success">Pasados</th>}
                        {isColumnVisible('suites', 'failed') && <th className="text-center text-danger">Fallados</th>}
                        {isColumnVisible('suites', 'blocked') && <th className="text-center text-primary">Bloqueados</th>}
                        {isColumnVisible('suites', 'pending') && <th className="text-center text-secondary">Sin ejecutar</th>}
                        {isColumnVisible('suites', 'successExecuted') && <th className="text-center">Exito ejec.</th>}
                        {isColumnVisible('suites', 'coverage') && <th className="text-center">Cobertura</th>}
                        {isColumnVisible('suites', 'successTotal') && <th className="text-center">Exito total</th>}
                        {isColumnVisible('suites', 'bugs') && <th className="text-center">Bugs</th>}
                        {isColumnVisible('suites', 'risk') && <th className="text-center">Riesgo</th>}
                        {isColumnVisible('suites', 'lastExecution') && <th className="text-center">Ultima ejec.</th>}
                        {isColumnVisible('suites', 'time') && <th className="text-center">Tiempo</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {renderSuiteRows(suiteTree)}
                    </tbody>
                  </Table>
                </Card>
              </Col>
            </Row>
          ) : null)}

          {renderReportesWidget('trend', projectMetrics.historico_versions && projectMetrics.historico_versions.length > 1 ? (
            <Row className="g-4 mb-4">
              <Col md={12}>
                <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
                  <h6 className="fw-bold mb-4 text-secondary text-start d-flex align-items-center gap-2">
                    <BarChart3 size={18} /> Tendencia entre builds
                  </h6>
                  <div style={{ height: '280px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[...projectMetrics.historico_versions].reverse().map(h => ({
                        name: h.build_name,
                        pasados: h.pasados,
                        fallados: h.fallados,
                        bloqueados: h.bloqueados
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="pasados" name="Pasados" fill="#198754" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="fallados" name="Fallados" fill="#dc3545" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="bloqueados" name="Bloqueados" fill="#0d6efd" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </Col>
            </Row>
          ) : null)}
        </ResponsiveReportesGridLayout>
      ) : (
        <Card className="border-0 shadow-sm p-5 rounded-3 bg-white text-center">
          <BarChart3 size={48} className="text-muted mb-3" />
          <h5 className="text-muted">No hay metricas disponibles</h5>
          <p className="text-muted small">Selecciona un proyecto con ejecuciones para ver reportes.</p>
          <Button variant="primary" size="sm" className="fw-bold px-4 rounded-pill" onClick={() => loadProjectMetrics()}>
            Cargar Métricas
          </Button>
        </Card>
      )}
      {canViewSharedReportsByPermission && !reportSnapshotsEnabled && isSectionVisible('sharedHistory') && (
        <PremiumGate
          feature="reports.snapshots"
          hasFeature={hasSystemFeature}
          title="Historial de links compartidos Premium"
          description="Community mantiene las metricas locales. Premium habilita snapshots versionados, links publicos y revocacion por build."
          mode="card"
          className="mb-4"
        />
      )}
      {canViewSharedReports && isSectionVisible('sharedHistory') && (
        <Card className="border-0 shadow-sm p-4 rounded-3 bg-white mb-4">
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
            <div>
              <h6 className="fw-bold mb-1 text-secondary d-flex align-items-center gap-2">
                <Share2 size={18} /> Historial de links compartidos
              </h6>
              <div className="small text-muted">Paquetes congelados por build con vistas Ejecutivo, Desarrollo e Interno.</div>
            </div>
            <div className="d-flex gap-2">
              {sharedReportHistory.length > 5 && (
                <Button variant="outline-secondary" size="sm" onClick={() => setShowFullSharedHistory((value) => !value)}>
                  {showFullSharedHistory ? 'Ver ultimos 5' : 'Ver historial completo'}
                </Button>
              )}
              <Button variant="outline-secondary" size="sm" onClick={loadSharedReportHistory} disabled={loadingSharedHistory}>
                <RefreshCw size={14} className="me-1" /> Actualizar
              </Button>
            </div>
          </div>
          <Table hover responsive className="mb-0 align-middle">
            <thead>
              <tr>
                {isColumnVisible('sharedHistory', 'snapshot') && <th>Snapshot</th>}
                {isColumnVisible('sharedHistory', 'typeUser') && <th>Tipo / usuario</th>}
                {isColumnVisible('sharedHistory', 'buildComponent') && <th>Build / componente</th>}
                {isColumnVisible('sharedHistory', 'qaDefinition') && <th>Decisión tomada por QA</th>}
                {isColumnVisible('sharedHistory', 'status') && <th>Estado</th>}
                {isColumnVisible('sharedHistory', 'links') && <th>Links</th>}
                {isColumnVisible('sharedHistory', 'actions') && <th className="text-end">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {sharedReportHistory.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumnCount('sharedHistory')} className="text-center text-muted py-4">
                    {loadingSharedHistory ? 'Cargando historial...' : 'Todavia no hay links compartidos para este build.'}
                  </td>
                </tr>
              ) : displayedSharedHistory.map((item) => (
                <tr key={item.snapshot_group_id}>
                  {isColumnVisible('sharedHistory', 'snapshot') && (
                  <td>
                    <div className="fw-bold">{formatDateTime(item.created_at)}</div>
                    <div className="small text-muted font-monospace">{String(item.metrics_hash || '').slice(0, 12)}</div>
                  </td>
                  )}
                  {isColumnVisible('sharedHistory', 'typeUser') && (
                  <td>
                    <div className="d-flex flex-wrap gap-1 mb-1">
                      {(item.report_types || []).map((type: string) => (
                        <Badge key={type} bg="light" text="dark" className="border">
                          {type === 'executive' ? 'Ejecutivo' : type === 'development' ? 'Desarrollo' : 'Interno'}
                        </Badge>
                      ))}
                    </div>
                    <div className="x-small text-muted">{item.created_by_display || item.created_by || 'Usuario N/D'}</div>
                  </td>
                  )}
                  {isColumnVisible('sharedHistory', 'buildComponent') && (
                  <td>
                    <div className="fw-semibold">{item.build || projectMetrics?.build_name || 'Build'}</div>
                    <div className="small text-muted">{item.componente || 'Sin componente'}</div>
                  </td>
                  )}
                  {isColumnVisible('sharedHistory', 'qaDefinition') && (
                  <td>
                    <Badge bg="light" text="dark" className="border">{item.build_definition || 'Sin decisión'}</Badge>
                    {item.qa_comment && <div className="x-small text-muted mt-1 text-truncate" style={{ maxWidth: 220 }}>{item.qa_comment}</div>}
                  </td>
                  )}
                  {isColumnVisible('sharedHistory', 'status') && (
                  <td>
                    <div className="d-flex flex-column gap-1">
                      <Badge bg={item.activo ? (item.is_latest ? 'success' : 'secondary') : 'dark'}>
                        {!item.activo ? 'Revocado' : item.is_latest ? 'Vigente' : 'Anterior'}
                      </Badge>
                      {item.has_new_values && <Badge bg="warning" text="dark">Tiene cambios</Badge>}
                    </div>
                  </td>
                  )}
                  {isColumnVisible('sharedHistory', 'links') && (
                  <td>
                    <div className="d-flex flex-wrap gap-2">
                      {(['executive', 'development', 'internal'] as const).map((type) => (
                        item.links?.[type] ? (
                          <Button key={type} variant="outline-primary" size="sm" onClick={() => openSharedReport(item.links[type], type)}>
                            {type === 'executive' ? 'Ejecutivo' : type === 'development' ? 'Desarrollo' : 'Interno'}
                          </Button>
                        ) : null
                      ))}
                    </div>
                  </td>
                  )}
                  {isColumnVisible('sharedHistory', 'actions') && (
                  <td className="text-end">
                    <div className="d-flex justify-content-end gap-2">
                      <Button variant="outline-secondary" size="sm" onClick={() => copyLink(item.links?.executive, 'Link Ejecutivo')}>
                        <Copy size={14} />
                      </Button>
                      {canShareReports && item.activo && (
                        <Button variant="outline-danger" size="sm" onClick={() => revokeSharedBundle(item)}>
                          Revocar
                        </Button>
                      )}
                    </div>
                  </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      <Modal show={showViewConfig} onHide={() => setShowViewConfig(false)} centered size="xl">
        <Modal.Header closeButton>
          <Modal.Title className="fw-bold d-flex align-items-center gap-2">
            <SlidersHorizontal size={20} /> Configurar vista de Reportes
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="d-flex flex-wrap gap-2 mb-4">
            <Button variant="outline-primary" size="sm" onClick={() => applyViewPreset('all')}>
              Mostrar todo
            </Button>
            <Button variant="outline-secondary" size="sm" onClick={() => applyViewPreset('summary')}>
              Vista resumida
            </Button>
            <Button variant="outline-success" size="sm" onClick={() => applyViewPreset('all')}>
              Vista QA completa
            </Button>
            <Button variant="outline-dark" size="sm" onClick={() => applyViewPreset('default')}>
              Restaurar predeterminado
            </Button>
          </div>

          <Tabs defaultActiveKey="sections" className="report-view-config-tabs mb-3">
            <Tab
              eventKey="sections"
              title={
                <span className="d-inline-flex align-items-center gap-2">
                  Vista
                  <Badge bg="light" text="dark" className="border">
                    {countDraftEnabled(REPORTES_STANDARD_SECTIONS, 'sections') + countDraftEnabled(REPORTES_HISTORICAL_SECTIONS, 'sections')}
                  </Badge>
                </span>
              }
            >
              <Row className="g-3">
                <Col lg={7}>
                  <Card className="border shadow-none h-100">
                    <Card.Body>
                      <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                        <div>
                          <h6 className="fw-bold text-secondary mb-1">Secciones principales</h6>
                          <div className="small text-muted">Controlan los bloques grandes visibles en el reporte.</div>
                        </div>
                        <Badge bg="light" text="dark" className="border flex-shrink-0">
                          {countDraftEnabled(REPORTES_STANDARD_SECTIONS, 'sections')} / {REPORTES_STANDARD_SECTIONS.length}
                        </Badge>
                      </div>
                      <div className="d-flex gap-2 mb-3">
                        <Button variant="outline-secondary" size="sm" onClick={() => setDraftGroupValues(REPORTES_STANDARD_SECTIONS, 'sections', true)}>Activar</Button>
                        <Button variant="outline-secondary" size="sm" onClick={() => setDraftGroupValues(REPORTES_STANDARD_SECTIONS, 'sections', false)}>Ocultar</Button>
                      </div>
                      <Row className="g-2">
                        {REPORTES_STANDARD_SECTIONS.map((section) => (
                          <Col md={6} key={section.id}>
                            <div className="border rounded-3 px-3 py-2 h-100 bg-light">
                              <Form.Check
                                type="switch"
                                id={`report-view-section-${section.id}`}
                                label={section.label}
                                checked={viewDraft.sections[section.id] !== false}
                                onChange={(event) => setDraftGroupValue('sections', section.id, event.target.checked)}
                              />
                            </div>
                          </Col>
                        ))}
                      </Row>
                    </Card.Body>
                  </Card>
                </Col>

                <Col lg={5}>
                  <Card className="border shadow-none h-100">
                    <Card.Body>
                      <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                        <div>
                          <h6 className="fw-bold text-secondary mb-1">Comparativas históricas</h6>
                          <div className="small text-muted">Analizan la build actual contra versiones anteriores.</div>
                        </div>
                        <Badge bg="light" text="dark" className="border flex-shrink-0">
                          {countDraftEnabled(REPORTES_HISTORICAL_SECTIONS, 'sections')} / {REPORTES_HISTORICAL_SECTIONS.length}
                        </Badge>
                      </div>
                      <div className="d-flex flex-column gap-2">
                        {REPORTES_HISTORICAL_SECTIONS.map((section) => (
                          <div className="border rounded-3 px-3 py-2 bg-light" key={section.id}>
                            <Form.Check
                              type="switch"
                              id={`report-view-historical-${section.id}`}
                              label={section.label}
                              checked={viewDraft.sections[section.id] !== false}
                              onChange={(event) => setDraftGroupValue('sections', section.id, event.target.checked)}
                            />
                          </div>
                        ))}
                      </div>
                    </Card.Body>
                  </Card>
                </Col>
              </Row>
            </Tab>

            <Tab
              eventKey="kpis"
              title={
                <span className="d-inline-flex align-items-center gap-2">
                  KPIs
                  <Badge bg="light" text="dark" className="border">{countDraftEnabled(REPORTES_VIEW_KPIS, 'kpis')}</Badge>
                </span>
              }
            >
              <Card className="border shadow-none">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                    <div>
                      <h6 className="fw-bold text-secondary mb-1">Tarjetas KPI</h6>
                      <div className="small text-muted">Selecciona los indicadores de resumen que querés ver arriba.</div>
                    </div>
                    <Badge bg="light" text="dark" className="border flex-shrink-0">
                      {countDraftEnabled(REPORTES_VIEW_KPIS, 'kpis')} / {REPORTES_VIEW_KPIS.length}
                    </Badge>
                  </div>
                  <div className="d-flex gap-2 mb-3">
                    <Button variant="outline-secondary" size="sm" onClick={() => setDraftGroupValues(REPORTES_VIEW_KPIS, 'kpis', true)}>Activar</Button>
                    <Button variant="outline-secondary" size="sm" onClick={() => setDraftGroupValues(REPORTES_VIEW_KPIS, 'kpis', false)}>Ocultar</Button>
                  </div>
                  <Row className="g-2">
                    {REPORTES_VIEW_KPIS.map((kpi) => (
                      <Col md={4} key={kpi.id}>
                        <div className="border rounded-3 px-3 py-2 h-100 bg-light">
                          <Form.Check
                            type="switch"
                            id={`report-view-kpi-${kpi.id}`}
                            label={kpi.label}
                            checked={viewDraft.kpis[kpi.id] !== false}
                            onChange={(event) => setDraftGroupValue('kpis', kpi.id, event.target.checked)}
                          />
                        </div>
                      </Col>
                    ))}
                  </Row>
                </Card.Body>
              </Card>
            </Tab>

            <Tab
              eventKey="ai"
              title={
                <span className="d-inline-flex align-items-center gap-2">
                  IA
                  <Badge bg="light" text="dark" className="border">{countDraftEnabled(REPORTES_VIEW_AI_BLOCKS, 'aiBlocks')}</Badge>
                </span>
              }
            >
              <Card className="border shadow-none">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                    <div>
                      <h6 className="fw-bold text-secondary mb-1">Bloques IA</h6>
                      <div className="small text-muted">Controla los paneles de análisis y diagnósticos asistidos por IA.</div>
                    </div>
                    <Badge bg="light" text="dark" className="border flex-shrink-0">
                      {countDraftEnabled(REPORTES_VIEW_AI_BLOCKS, 'aiBlocks')} / {REPORTES_VIEW_AI_BLOCKS.length}
                    </Badge>
                  </div>
                  <Row className="g-2">
                    {REPORTES_VIEW_AI_BLOCKS.map((block) => (
                      <Col md={6} key={block.id}>
                        <div className="border rounded-3 px-3 py-2 h-100 bg-light">
                          <Form.Check
                            type="switch"
                            id={`report-view-ai-${block.id}`}
                            label={block.label}
                            checked={viewDraft.aiBlocks[block.id] !== false}
                            onChange={(event) => setDraftGroupValue('aiBlocks', block.id, event.target.checked)}
                          />
                        </div>
                      </Col>
                    ))}
                  </Row>
                </Card.Body>
              </Card>
            </Tab>

            <Tab eventKey="columns" title="Columnas">
              <Row className="g-3">
                {Object.entries(REPORTES_VIEW_COLUMNS).map(([table, config]) => (
                  <Col md={6} xl={4} key={table}>
                    <Card className="border shadow-none h-100">
                      <Card.Body>
                        <div className="d-flex justify-content-between align-items-start gap-2 mb-3">
                          <div>
                            <h6 className="fw-bold mb-1">{config.label}</h6>
                            <div className="x-small text-muted">Columnas visibles en esta tabla.</div>
                          </div>
                          <Badge bg="light" text="dark" className="border flex-shrink-0">
                            {countDraftColumnsEnabled(table, config.columns)} / {config.columns.length}
                          </Badge>
                        </div>
                        <div className="d-flex gap-2 mb-3">
                          <Button variant="outline-secondary" size="sm" onClick={() => setDraftColumnTableValues(table, config.columns, true)}>Todas</Button>
                          <Button variant="outline-secondary" size="sm" onClick={() => setDraftColumnTableValues(table, config.columns, false)}>Ninguna</Button>
                        </div>
                        <div className="d-flex flex-column gap-2">
                          {config.columns.map((column) => (
                            <div className="border rounded-3 px-3 py-2 bg-light" key={column.id}>
                              <Form.Check
                                type="switch"
                                id={`report-view-column-${table}-${column.id}`}
                                label={column.label}
                                checked={viewDraft.columns?.[table]?.[column.id] !== false}
                                onChange={(event) => setDraftColumnValue(table, column.id, event.target.checked)}
                              />
                            </div>
                          ))}
                        </div>
                      </Card.Body>
                    </Card>
                  </Col>
                ))}
              </Row>
            </Tab>
          </Tabs>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={resetReportesLayout} disabled={savingViewConfig}>
            <RotateCcw size={14} className="me-1" /> Restaurar layout
          </Button>
          <Button variant="outline-success" onClick={saveReportesLayout} disabled={savingViewConfig}>
            <Save size={14} className="me-1" /> Guardar layout
          </Button>
          <Button variant="outline-secondary" onClick={() => setShowViewConfig(false)} disabled={savingViewConfig}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={saveReportesView} disabled={savingViewConfig}>
            {savingViewConfig ? 'Guardando...' : 'Guardar vista'}
          </Button>
        </Modal.Footer>
      </Modal>
      <Modal show={showReportSettings} onHide={() => setShowReportSettings(false)} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title className="fw-bold d-flex align-items-center gap-2">
            <SlidersHorizontal size={20} /> Configurar informes del proyecto
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="border rounded-3 bg-light p-3 mb-3 small text-muted">
            Esta configuración pertenece al proyecto actual. Los próximos links Ejecutivo, Desarrollo e Interno quedarán congelados con estos switches; los links viejos no cambian.
          </div>
          <Tabs defaultActiveKey="executive" className="mb-3">
            {(Object.keys(PROJECT_REPORT_SETTING_GROUPS) as ProjectReportType[]).map((reportType) => (
              <Tab
                key={reportType}
                eventKey={reportType}
                title={
                  <span className="d-inline-flex align-items-center gap-2">
                    {PROJECT_REPORT_TYPE_META[reportType].label}
                    <Badge bg="light" text="dark" className="border">
                      {countProjectReportSectionsEnabled(reportType)}
                    </Badge>
                  </span>
                }
              >
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <div>
                    <h6 className="fw-bold mb-1">{PROJECT_REPORT_TYPE_META[reportType].title}</h6>
                    <div className="small text-muted">{PROJECT_REPORT_TYPE_META[reportType].description}</div>
                  </div>
                  <div className="d-flex gap-2">
                    <Button variant="outline-secondary" size="sm" onClick={() => setAllProjectReportSections(reportType, true)}>
                      Activar todo
                    </Button>
                    <Button variant="outline-secondary" size="sm" onClick={() => setAllProjectReportSections(reportType, false)}>
                      Ocultar todo
                    </Button>
                  </div>
                </div>
                <Row className="g-3">
                  {PROJECT_REPORT_SECTION_GROUPS.map((group) => {
                    const sections = PROJECT_REPORT_SETTING_GROUPS[reportType].filter((section) => section.group === group.id)
                    if (!sections.length) return null
                    const enabledCount = sections.filter((section) => projectReportSettingsDraft?.[reportType]?.sections?.[section.id] !== false).length
                    return (
                      <Col lg={4} md={6} key={group.id}>
                        <Card className="border shadow-none h-100">
                          <Card.Body>
                            <div className="d-flex justify-content-between align-items-start gap-2 mb-3">
                              <h6 className="fw-bold text-secondary mb-0">{group.label}</h6>
                              <Badge bg="light" text="dark" className="border flex-shrink-0">
                                {enabledCount} / {sections.length}
                              </Badge>
                            </div>
                            <div className="d-flex flex-column gap-2">
                              {sections.map((section) => (
                                <div className="border rounded-3 px-3 py-2 bg-light" key={section.id}>
                                  <Form.Check
                                    type="switch"
                                    id={`project-report-${reportType}-${section.id}`}
                                    label={section.label}
                                    checked={projectReportSettingsDraft?.[reportType]?.sections?.[section.id] !== false}
                                    onChange={(event) => setProjectReportSection(reportType, section.id, event.target.checked)}
                                  />
                                </div>
                              ))}
                            </div>
                          </Card.Body>
                        </Card>
                      </Col>
                    )
                  })}
                </Row>
              </Tab>
            ))}
          </Tabs>
          <div className="small text-muted">
            El informe de Desarrollo puede exponer fichas completas de bugs en modo público solo lectura. No incluye acciones de edición ni secretos técnicos.
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setShowReportSettings(false)} disabled={savingReportSettings}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={saveProjectReportSettings} disabled={savingReportSettings}>
            {savingReportSettings ? 'Guardando...' : 'Guardar configuración'}
          </Button>
        </Modal.Footer>
      </Modal>
      <Modal show={showShareModal} onHide={() => setShowShareModal(false)} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title className="fw-bold">{sharedReport ? 'Links vigentes reutilizados' : 'Compartir informe'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {!sharedReport ? (
            <>
              <div className="border rounded-3 bg-light p-3 mb-3">
                <h6 className="fw-bold text-dark mb-2">Definir y compartir informe</h6>
                <p className="small text-muted mb-2">
                  Se congelaran tres vistas coherentes del mismo build: Ejecutivo publico, Desarrollo publico sanitizado e Interno autenticado.
                </p>
                <p className="small text-muted mb-0">
                  Si no hay cambios desde el ultimo paquete vigente, se reutilizaran los mismos links.
                </p>
              </div>
              <div className="border rounded-3 bg-primary bg-opacity-10 p-3 mb-3 small text-primary-emphasis">
                Se usará la configuración de informes del proyecto para Ejecutivo y Desarrollo. Si esa configuración cambió, se generará un nuevo snapshot aunque las métricas sean iguales.
              </div>
              {hasOutdatedSharedReport && (
                <div className="border rounded-3 bg-info bg-opacity-10 p-3 mb-3 small text-info-emphasis fw-bold">
                  Hay datos nuevos; se generara un nuevo snapshot para reflejar las metricas actuales.
                </div>
              )}
              <Row className="g-3 mb-3">
                <Col md={12}>
                  <Form.Label className="small fw-bold">Decisión tomada por QA</Form.Label>
                  <Form.Select value={buildDefinition} onChange={(event) => setBuildDefinition(event.target.value)}>
                    <option value="">Seleccionar definicion...</option>
                    <option value="APROBADA">Aprobada</option>
                    <option value="APROBADA_CON_OBSERVACIONES">Aprobada con observaciones</option>
                    <option value="RECHAZADA">Rechazada</option>
                    <option value="BLOQUEADA">Bloqueada</option>
                    <option value="PENDIENTE_DE_VALIDACION">Pendiente de validacion</option>
                    <option value="EN_ANALISIS">En analisis</option>
                    <option value="NO_APLICA">No aplica</option>
                  </Form.Select>
                </Col>
                <Col md={12}>
                  <Form.Label className="small fw-bold"><RequiredLabel required={buildDefinitionRequiresComment}>Comentario QA</RequiredLabel></Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    value={qaComment}
                    onChange={(event) => setQaComment(event.target.value)}
                    placeholder="Agrega contexto, riesgos pendientes o notas para el paquete compartido."
                  />
                </Col>
              </Row>
              <div className="border rounded-3 bg-light p-3 mb-3 small">
                <strong>Estado sugerido por metricas:</strong> {qaStatus.label || 'N/D'}
                {Array.isArray(qaStatus.reasons) && qaStatus.reasons.length > 0 && (
                  <span className="text-muted"> · {qaStatus.reasons.join(' · ')}</span>
                )}
                <div className="text-muted mt-1">La definicion elegida se aplica al paquete completo: Ejecutivo, Desarrollo e Interno.</div>
              </div>
              <div className="border rounded-3 bg-warning bg-opacity-10 p-3">
                <div className="d-flex align-items-start gap-2">
                  <ShieldCheck size={22} className="text-warning flex-shrink-0 mt-1" />
                  <div>
                    <h6 className="fw-bold text-dark mb-2">Confirmar snapshot publico e inmutable</h6>
                    <p className="small text-muted mb-2">
                      Al crear el link, los resultados visibles quedan congelados aunque luego cambien ejecuciones, bugs o evidencias.
                    </p>
                    <p className="small text-muted mb-0">
                      Los informes publicos no exponen tokens, hosts, IPs, workers internos, JSON crudo ni logs completos.
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {sharedReport?.reusedFromHistory ? (
                <div className="border rounded-3 bg-success bg-opacity-10 p-3 mb-3 small text-success fw-bold">
                  Links vigentes reutilizados.
                </div>
              ) : sharedReport?.reused && (
                <div className="border rounded-3 bg-success bg-opacity-10 p-3 mb-3 small text-success fw-bold">
                  No hubo cambios; se reutilizo el snapshot existente.
                </div>
              )}
              <p className="small text-muted">
                Cada vista conserva este snapshot congelado; si luego aparecen datos nuevos, los links viejos avisaran y podran abrir la version vigente.
              </p>
              <Row className="g-3">
                {sharedReportTypes.map(({ type, title, badge, description }) => {
                  const link = sharedReport?.links?.[type]
                  if (!link) return null
                  const displayLink = shareableReportUrl(link, type)
                  const preview = sharedReportPreview(sharedReport, type)
                  return (
                    <Col md={12} key={type}>
                      <div className="border rounded-3 p-3 bg-white">
                        <div className="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-2">
                          <div>
                            <div className="d-flex align-items-center gap-2 mb-1">
                              <h6 className="fw-bold mb-0 text-dark">{title}</h6>
                              <Badge bg={type === 'internal' ? 'secondary' : 'primary'}>{badge}</Badge>
                            </div>
                            <div className="small text-muted">{description}</div>
                          </div>
                          <div className="d-flex flex-wrap gap-2">
                            <Button variant="primary" size="sm" onClick={() => openSharedReport(link, title)}>
                              Abrir
                            </Button>
                            <Button variant="outline-secondary" size="sm" onClick={() => copyLink(displayLink, title)}>
                              <Copy size={14} className="me-1" /> Copiar
                            </Button>
                            {canExportReports && (
                              <>
                                <Button variant="outline-primary" size="sm" onClick={() => exportSharedReportPdf(link, type, title)}>
                                  <Download size={14} className="me-1" /> PDF
                                </Button>
                                <Button variant="outline-primary" size="sm" onClick={() => downloadSharedMarkdown(sharedReport, type, title)}>
                                  <Download size={14} className="me-1" /> .md
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                        <Form.Control readOnly value={displayLink} className="font-monospace small" />
                        <div className="mt-2 rounded-3 border bg-light px-3 py-2 small text-muted">
                          <div className="fw-bold text-dark mb-1">Previsualización del link</div>
                          <div className="d-flex flex-wrap gap-2">
                            <Badge bg="light" text="dark" className="border">{preview.organization}</Badge>
                            <Badge bg="light" text="dark" className="border">{preview.project}</Badge>
                            <Badge bg="light" text="dark" className="border">{preview.component}</Badge>
                            <Badge bg="primary">{preview.build}</Badge>
                            <Badge bg={String(preview.qa).toUpperCase().includes('RECHAZ') ? 'danger' : 'success'}>{preview.qa}</Badge>
                          </div>
                        </div>
                      </div>
                    </Col>
                  )
                })}
              </Row>
              {sharedReport?.description && <div className="small text-muted mt-3">{sharedReport.description}</div>}
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setShowShareModal(false)}>Cerrar</Button>
          {!sharedReport ? (
            <Button
              variant="warning"
              className="fw-bold"
              onClick={shareReport}
              disabled={sharingReport || !canShareReports || !buildDefinition || (buildDefinitionRequiresComment && !qaComment.trim())}
            >
              {sharingReport ? 'Creando...' : 'Crear paquete de informes'}
            </Button>
          ) : (
            <>
              {canExportReports && <Button variant="outline-primary" onClick={exportPdfReport}><Download size={16} className="me-1" /> PDF vista actual</Button>}
              {canExportReports && <Button variant="outline-success" onClick={exportExcelReport}><Download size={16} className="me-1" /> XLS vista actual</Button>}
            </>
          )}
        </Modal.Footer>
      </Modal>
    </div>

  )
}
