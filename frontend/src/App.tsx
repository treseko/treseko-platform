import { useState, useEffect, Fragment, useRef, useMemo, useCallback, type FormEvent } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts'
import { BuildCaseSelector } from './BuildCaseSelector'
import { ScriptEditor } from './ScriptEditor'
import { EvidenceUpload, type AttachmentMeta } from './EvidenceUpload'
import { findSuiteById, flattenSuites, getRootSuiteId as getRootSuiteIdFromTree, getSuiteDepth as getSuiteDepthFromTree } from './testRepositoryUtils'
import type { ConfirmDialogOptions, ConfirmDialogState } from './shared/components/ConfirmDialog'
import { ConfiguracionRoute } from './app/ConfiguracionRoute'
import { ProyectosRoute } from './app/ProyectosRoute'
import { AppModals } from './app/AppModals'
import { EjecutarPruebasRoute } from './app/EjecutarPruebasRoute'
import { DashboardRoute } from './app/DashboardRoute'
import { ReportesRoute } from './app/ReportesRoute'
import { HistorialRoute } from './app/HistorialRoute'
import { RedminePage } from './features/redmine/RedminePage'
import { MotorIaPage } from './features/motor-ia/MotorIaPage'
import { BugTrackerPage } from './features/bugs/BugTrackerPage'
import { createIaMissionActions } from './features/motor-ia/iaMissionActions'
import { InventarioPage } from './features/inventario/InventarioPage'
import { useExecutionRunDetail } from './features/historial/hooks/useExecutionRunDetail'
import { useHistorialController } from './features/historial/hooks/useHistorialController'
import { createHistoryComparisonData } from './features/historial/mappers/historialMappers'
import { useAiEngineConfig } from './features/configuracion/hooks/useAiEngineConfig'
import { useAdminUserRolesConfig } from './features/configuracion/hooks/useAdminUserRolesConfig'
import { useConfigurationPreload } from './features/configuracion/hooks/useConfigurationPreload'
import { useGeneralConfiguration } from './features/configuracion/hooks/useGeneralConfiguration'
import { useSessionConfig } from './features/configuracion/hooks/useSessionConfig'
import { useWorkflowSchedulerLauncher } from './features/configuracion/hooks/useWorkflowSchedulerLauncher'
import { UpdateMaintenanceOverlay } from './features/configuracion/components/UpdateMaintenanceOverlay'
import {
  UPDATE_MAINTENANCE_EVENT,
  announceUpdateMaintenance,
  clearUpdateMaintenanceSignal,
  readUpdateMaintenanceSignal,
  updateMaintenanceConnectionState,
  type UpdateMaintenanceState
} from './features/configuracion/updateMaintenance'
import { defaultAiEngineConfig, defaultAttachmentConfig, normalizeAiAgentWorkflow } from './features/configuracion/mappers/configuracionMappers'
import { createOrganizationActions } from './features/configuracion/organizationActions'
import { AutomatizacionPage } from './features/automatizacion/AutomatizacionPage'
import { humanizePremiumError } from './features/premium/featureAccess'
import { useReportesMetrics } from './features/reportes/hooks/useReportesMetrics'
import { LoginPage } from './features/auth/LoginPage'
import { createAuthClient } from './features/auth/authClient'
import { createAuthActions } from './features/auth/authActions'
import { FirstRunOnboarding } from './features/onboarding/FirstRunOnboarding'
import { ForcePasswordChangeModal, needsForcedPasswordChange } from './features/onboarding/ForcePasswordChangeModal'
import { AnadirPruebasPage } from './features/casos/AnadirPruebasPage'
import { AuthoringSuiteTreeView } from './features/casos/AuthoringSuiteTreeView'
import { CaseVersionsModal } from './features/casos/CaseVersionsModal'
import { createCaseActions } from './features/casos/caseActions'
import { createCaseEditorActions } from './features/casos/caseEditorActions'
import { createCaseVersionRows } from './features/casos/caseVersionUtils'
import { createSuiteActions } from './features/casos/suiteActions'
import { CaseReferenceList } from './features/ejecutar-pruebas/CaseReferenceList'
import { ExecutionSuiteTreeView } from './features/ejecutar-pruebas/ExecutionSuiteTreeView'
import { useExecutionPreparation } from './features/ejecutar-pruebas/hooks/useExecutionPreparation'
import { createExecutionDryRunActions } from './features/ejecucion/dryRunActions'
import { createEjecucionActionBundle } from './features/ejecucion/ejecucionActionBundle'
import { createBuildExecutionStatusActions } from './features/proyectos/buildExecutionStatusActions'
import { createBuildScopeActions } from './features/proyectos/buildScopeActions'
import { createProyectosActions } from './features/proyectos/proyectosActions'
import { createProjectLoaders } from './features/proyectos/projectLoaders'
import { AppShell } from './layout/AppShell'
import { ALLOW_LOCAL_FALLBACK, API_BASE, DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD, IS_DEV_ENV, MODULE_PERMISSIONS, ROLE_ACCESS } from './app/constants'
import { DEFAULT_BRANDING, normalizeBrandingState, type BrandingState } from './app/branding'
import { createContextActions } from './app/contextActions'
import { createInitialLoadActions } from './app/initialLoadActions'
import { createNavigationActions } from './app/navigationActions'
import { allSidebarItems } from './app/navigationModel'
import { buildProjectViewModel } from './app/projectViewModel'
import { readWorkspacePreferences, saveWorkspacePreferences, tabFromCurrentUri, uriForTab } from './app/workspacePreferences'
import { useLiveRefresh } from './shared/hooks/useLiveRefresh'
import { useProjectRealtime } from './shared/realtime/useProjectRealtime'
import type { RealtimeEvent } from './shared/realtime/realtimeTypes'
import {
  initialAdConfig,
  initialAgents,
  initialAppUsers,
  initialBuilds,
  initialComponents,
  initialCustomInventoryItems,
  initialDevices,
  initialEnvironments,
  initialIaLogs,
  initialInventoryCategories,
  initialOrganizations,
  initialProjects,
  initialRedmineBugs,
  initialRedmineSettings,
  initialRunHistory,
  initialWikiPages
} from './app/seedData'
import { isValidUUID } from './app/validation'
import type { AuthMode, ModuleId, PermissionLevel, RoleKey, SessionUser } from './app/types'
import {
  buildCaseEditorSnapshot,
  createSessionUser,
  firstUrlFromText,
  mapBackendOrganizationMemberToItem,
  mapBackendOrganizationToItem,
  mapBackendProjectToCard,
  mapBackendUserToSession,
  modulesFromPermissions,
  sortBuildsNewestFirst
} from './app/mappers'
import { canAccessCapability as canAccessCapabilityForUser, canAccessModule as canAccessModuleForUser } from './app/rbac/permissions'
import { mapBackendCasoToTest as mapBackendCasoToTestBase } from './features/casos/caseUtils'
import {
  buildBugDescription,
  getExecutionHistoryStats,
  getStatusColor,
  mapBackendExecutionStatus,
  normalizeExecutionHistory
} from './features/ejecucion/executionUtils'

const CLOSED_BUG_STATES = new Set(['RESUELTO', 'CERRADO', 'DUPLICADO', 'NO_REPRODUCIBLE', 'NO_CORRESPONDE'])
const isOpenBugState = (estado?: string | null) => !CLOSED_BUG_STATES.has(String(estado || '').toUpperCase())
const readInternalReportTokenFromLocation = () => {
  const queryToken = new URLSearchParams(window.location.search).get('internal_report') || ''
  if (queryToken) return queryToken
  const match = window.location.pathname.match(/^\/informes-internos\/[^/]+\/[^/]+\/[^/]+\/([^/?#]+)$/)
  return match?.[1] ? decodeURIComponent(match[1]) : ''
}

function WorkspaceAccessEmptyState({ userName, hasOrganizationAccess }: { userName: string; hasOrganizationAccess: boolean }) {
  return (
    <div className="min-vh-100 bg-light d-flex align-items-center justify-content-center p-4">
      <div className="bg-white border rounded-3 shadow-sm p-4 p-md-5 text-center" style={{ maxWidth: '640px' }}>
        <div className="mx-auto mb-3 rounded-circle bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center fw-bold" style={{ width: '56px', height: '56px' }}>
          !
        </div>
        <h1 className="h4 fw-bold text-dark mb-2">{hasOrganizationAccess ? 'Todavia no tenes proyectos asignados' : 'Todavia no tenes acceso asignado'}</h1>
        <p className="text-muted mb-3">
          {hasOrganizationAccess
            ? `Hola ${userName}. Tu cuenta tiene acceso a la solucion, pero todavia no pertenece a ningun proyecto.`
            : `Hola ${userName}. Tu cuenta esta activa, pero aun no pertenece a ninguna solucion o proyecto de Treseko.`}
        </p>
        <div className="alert alert-info text-start small mb-0">
          {hasOrganizationAccess
            ? 'Pedile a un administrador que te agregue al equipo de un proyecto. Cuando tengas proyecto, vas a ver automaticamente las secciones disponibles para tu rol.'
            : 'Pedile a un administrador que te agregue a una solucion o al equipo de un proyecto. Cuando tengas acceso, vas a ver automaticamente las secciones disponibles para tu rol.'}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const active = localStorage.getItem('qa_session_active') === 'true'
    if (!active) return false
    const expiresAt = localStorage.getItem('qa_session_expires_at')
    if (expiresAt) {
      const expiresMs = Date.parse(expiresAt)
      if (Number.isFinite(expiresMs) && expiresMs <= Date.now()) {
        localStorage.removeItem('qa_session_active')
        localStorage.removeItem('qa_session_user')
        localStorage.removeItem('qa_access_token')
        localStorage.removeItem('qa_session_expires_at')
        return false
      }
    }
    if (!localStorage.getItem('qa_access_token')) return false
    return true
  })
  const [authMode, setAuthMode] = useState<AuthMode>('local')
  const [loginForm, setLoginForm] = useState({
    email: IS_DEV_ENV ? DEV_ADMIN_EMAIL : '',
    password: IS_DEV_ENV ? DEV_ADMIN_PASSWORD : '',
    domain: 'enterprise.local'
  })
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [loggedUser, setLoggedUser] = useState<SessionUser>(() => {
    const saved = localStorage.getItem('qa_session_user')
    if (saved) {
      try {
        return JSON.parse(saved) as SessionUser
      } catch {
        localStorage.removeItem('qa_session_user')
      }
    }
    return createSessionUser(IS_DEV_ENV ? DEV_ADMIN_EMAIL : '')
  })
  const [activeTab, setActiveTab] = useState('dashboard')
  const [deepLinkBugId, setDeepLinkBugId] = useState(() => new URLSearchParams(window.location.search).get('bug_id') || '')
  const [internalReportToken, setInternalReportToken] = useState(() => readInternalReportTokenFromLocation())
  const [internalReportHtml, setInternalReportHtml] = useState('')
  const [internalReportLoading, setInternalReportLoading] = useState(false)
  const [internalReportError, setInternalReportError] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'manual_exec'>('list')
  const [selectedSuiteId, setSelectedSuiteId] = useState<string>('s1')
  const [selectedTest, setSelectedTest] = useState<any>(null)
  const [showExecSelector, setShowExecSelector] = useState(false)
  const [stepResults, setStepResults] = useState<Record<number, string>>({})
  const [currentExecutionRun, setCurrentExecutionRun] = useState<any>(null)
  const [automationMonitor, setAutomationMonitor] = useState<{ show: boolean; run: any; jobs: any[]; mode?: 'execution' | 'dry-run' }>({ show: false, run: null, jobs: [], mode: 'execution' })
  const [automationDebugMode, setAutomationDebugMode] = useState(false)
  const [currentExecutionCase, setCurrentExecutionCase] = useState<any>(null)
  const [executionSnapshots, setExecutionSnapshots] = useState<any[]>([])
  const [executionLoading, setExecutionLoading] = useState(false)
  const [executionMode, setExecutionMode] = useState<'manual' | 'automated' | 'ia' | null>(null)
  const [selectedExecutionTestIds, setSelectedExecutionTestIds] = useState<string[]>([])
  const [executionModalCaseIds, setExecutionModalCaseIds] = useState<string[] | null>(null)
  const [activeExecutionCaseIds, setActiveExecutionCaseIds] = useState<string[]>([])
  const [selectedExecutionEnvironmentId, setSelectedExecutionEnvironmentId] = useState('')
  const [selectedExecutionDatasetId, setSelectedExecutionDatasetId] = useState('')
  const [executionDatasetPreview, setExecutionDatasetPreview] = useState<any>(null)
  const [executionDatasetPreviewLoading, setExecutionDatasetPreviewLoading] = useState(false)
  const latestResultsRequestRef = useRef<Record<string, number>>({})
  const initialBackendLoadKeyRef = useRef('')
  const organizationMembersLoadKeyRef = useRef('')
  const loadCasosFromBackendRef = useRef<null | ((projectId: string, componentsSnapshot?: any[]) => Promise<void>)>(null)
  const workspacePreferencesHydratedRef = useRef('')
  const deepLinkPermissionNoticeRef = useRef('')
  const suiteExplorerResizeCleanupRef = useRef<(() => void) | null>(null)
  const [workspacePreferencesHydrated, setWorkspacePreferencesHydrated] = useState(false)
  const [latestResultsLoadingByBuild, setLatestResultsLoadingByBuild] = useState<Record<string, boolean>>({})
  const [buildCaseResultHistoryByBuild, setBuildCaseResultHistoryByBuild] = useState<Record<string, Record<string, any[]>>>({})
  const [snapshotNotes, setSnapshotNotes] = useState<Record<number, string>>({})
  const [snapshotAttachments, setSnapshotAttachments] = useState<Record<string, AttachmentMeta[]>>({})
  const [generalExecutionSnapshot, setGeneralExecutionSnapshot] = useState<any | null>(null)
  const [generalExecutionAttachments, setGeneralExecutionAttachments] = useState<AttachmentMeta[]>([])
  const [generalExecutionStatus, setGeneralExecutionStatus] = useState('SIN_CORRER')
  const [generalExecutionNote, setGeneralExecutionNote] = useState('')
  const [showRedmineDrawer, setShowRedmineDrawer] = useState(false)
  const [showRedminePrompt, setShowRedminePrompt] = useState(false)
  const [redmineDecisionByExecution, setRedmineDecisionByExecution] = useState<Record<string, 'reported' | 'deferred'>>({})
  const [creatingInternalBugContextId, setCreatingInternalBugContextId] = useState<string | null>(null)
  const [internalBugDraft, setInternalBugDraft] = useState<Record<string, any> | null>(null)
  const [internalBugAdditionalContext, setInternalBugAdditionalContext] = useState<{ key: string; value: string }[]>([])
  const [internalBugEvidence, setInternalBugEvidence] = useState<AttachmentMeta[]>([])
  const [bugTrackerRefreshToken, setBugTrackerRefreshToken] = useState(0)
  const [openBugsByCase, setOpenBugsByCase] = useState<Record<string, any[]>>({})
  const [openBugsLoading, setOpenBugsLoading] = useState(false)
  const [relatedCaseBugs, setRelatedCaseBugs] = useState<any[]>([])
  const [relatedCaseBugsLoading, setRelatedCaseBugsLoading] = useState(false)
  const lastRelatedCaseIdRef = useRef<string | null>(null)
  const relatedBugDecisionResolverRef = useRef<((value: 'create' | 'cancel') => void) | null>(null)
  const [relatedBugDecision, setRelatedBugDecision] = useState<any>({
    show: false,
    bugs: [],
    viewingBug: null,
    linkingBugId: null,
    canLink: false,
  })

  // Missing and restored state definitions
  const projectVersion = "v2.8.5-STABLE"

  // SUITES Y SUBSUITES - CONECTADOS AL BACKEND
  const [suitesTree, setSuitesTree] = useState<any[]>([])
  const [suitesLoading, setSuitesLoading] = useState(false)
  const [showSuiteModal, setShowSuiteModal] = useState(false)
  const [editingSuiteId, setEditingSuiteId] = useState<string | null>(null)
  const [suiteForm, setSuiteForm] = useState({ nombre: '', descripcion: '', parentId: '', color: '#F1F5F9', icono: 'folder' })
  const [suiteExplorerWidth, setSuiteExplorerWidth] = useState(320)
  const [showMoveSuiteModal, setShowMoveSuiteModal] = useState(false)
  const [movingSuiteId, setMovingSuiteId] = useState<string | null>(null)
  const [moveSuiteParentId, setMoveSuiteParentId] = useState<string>('')

  // CASOS DE PRUEBA - CONECTADOS AL BACKEND
  const [casosList, setCasosList] = useState<any[]>([])
  const [casosLoading, setCasosLoading] = useState(false)
  const [casosTotal, setCasosTotal] = useState(0)
  const [casosPage, setCasosPage] = useState(0)
  const [casosPageSize] = useState(50)
  const [casosSearchQuery, setCasosSearchQuery] = useState('')
  const [casosFilterSuite, setCasosFilterSuite] = useState<string | null>(null)
  const [casosFilterPrioridad, setCasosFilterPrioridad] = useState<string | null>(null)
  const [casosFilterCriticidad, setCasosFilterCriticidad] = useState<string | null>(null)
  const [casosFilterEstado, setCasosFilterEstado] = useState<string | null>(null)
  const [casosFilterEtiqueta, setCasosFilterEtiqueta] = useState('')
  const [showCasoModal, setShowCasoModal] = useState(false)
  const [editingCasoMasterId, setEditingCasoMasterId] = useState<string | null>(null)
  const [caseEditorOpen, setCaseEditorOpen] = useState(false)
  const [showVersionsModal, setShowVersionsModal] = useState(false)
  const [caseVersions, setCaseVersions] = useState<any[]>([])
  const [versionsCase, setVersionsCase] = useState<any | null>(null)
  const [selectedCompareVersionId, setSelectedCompareVersionId] = useState<string | null>(null)
  const [casosSearchResults, setCasosSearchResults] = useState<any[] | null>(null)
  const [feedbackModal, setFeedbackModal] = useState<{ show: boolean, title: string, message: string, variant: 'success' | 'danger' | 'warning' | 'info' }>({
    show: false,
    title: '',
    message: '',
    variant: 'info'
  })
  const [updateMaintenanceState, setUpdateMaintenanceState] = useState<UpdateMaintenanceState>(() => readUpdateMaintenanceSignal())
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    show: false,
    title: '',
    message: '',
    variant: 'warning',
    confirmLabel: 'Confirmar',
    cancelLabel: 'Cancelar'
  })
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null)

  const [newTestSuite, setNewTestSuite] = useState('s1')
  const [newTestSuiteSub, setNewTestSuiteSub] = useState('sub1')
  const [newTestTitle, setNewTestTitle] = useState('')
  const [newTestType, setNewTestType] = useState('AI Agent')
  const [newTestComponent, setNewTestComponent] = useState('Web')
  const [newTestPre, setNewTestPre] = useState('')
  const [newTestData, setNewTestData] = useState('')
  const [newTestTags, setNewTestTags] = useState<string[]>([])
  const [addTestSuccess, setAddTestSuccess] = useState(false)
  // 2. Actualizamos el esquema de los pasos para soportar datos e imágenes.
  const [newTestDescription, setNewTestDescription] = useState('')
  const [newTestPost, setNewTestPost] = useState('')
  const [newTestPriority, setNewTestPriority] = useState('MEDIA')
  const [newTestCriticality, setNewTestCriticality] = useState('MEDIA')
  const [newTestStatus, setNewTestStatus] = useState('ACTIVO')
  const [newTestSteps, setNewTestSteps] = useState<{ action: string, data: string, expected: string, actionImg: string, expectedImg: string, actionAttachments?: AttachmentMeta[], expectedAttachments?: AttachmentMeta[] }[]>([])
  const [newTestScript, setNewTestScript] = useState('')
  const [newTestFramework, setNewTestFramework] = useState('playwright')
  const [newTestLanguage, setNewTestLanguage] = useState('javascript')
  const [caseEditorBaseline, setCaseEditorBaseline] = useState('')
  const [caseEditorSaving, setCaseEditorSaving] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    location: false,
    metadata: false,
    steps: false,
    script: false
  })
  const [scriptTesting, setScriptTesting] = useState(false)
  const [scriptTestResult, setScriptTestResult] = useState<'success' | 'error' | null>(null)
  const currentCaseEditorSnapshot = useMemo(() => buildCaseEditorSnapshot({
    suiteId: newTestSuiteSub || newTestSuite,
    componentId: newTestComponent,
    title: newTestTitle,
    description: newTestDescription,
    pre: newTestPre,
    post: newTestPost,
    data: newTestData,
    tags: newTestTags,
    priority: newTestPriority,
    criticality: newTestCriticality,
    status: newTestStatus,
    type: newTestType,
    script: newTestScript,
    framework: `${newTestFramework}:${newTestLanguage}`,
    steps: newTestSteps
  }), [
    newTestSuite,
    newTestSuiteSub,
    newTestComponent,
    newTestTitle,
    newTestDescription,
    newTestPre,
    newTestPost,
    newTestData,
    newTestTags,
    newTestPriority,
    newTestCriticality,
    newTestStatus,
    newTestType,
    newTestScript,
    newTestFramework,
    newTestLanguage,
    newTestSteps
  ])
  const hasUnsavedCaseChanges = caseEditorOpen && currentCaseEditorSnapshot !== caseEditorBaseline
  const canSaveCaseEditor = Boolean(newTestTitle.trim()) && !caseEditorSaving && hasUnsavedCaseChanges

  // 3. ESTADOS PARA CREAR CARPETAS AL VUELO
  const [showAddFolderModal, setShowAddFolderModal] = useState(false)
  const [folderConfig, setFolderConfig] = useState<{ parentId: string | null }>({ parentId: null })
  const [expandedSuites, setExpandedSuites] = useState<Record<string, boolean>>({
    s1: true,
    s2: true,
    s3: true
  })
  const [expandedSubSuites, setExpandedSubSuites] = useState<Record<string, boolean>>({
    sub1: true,
    sub2: true,
    sub3: true,
    sub4: true,
    sub5: true,
    sub6: true
  })
  const [selectedSubSuiteId, setSelectedSubSuiteId] = useState<string | null>(null)
  const [zoomImage, setZoomImage] = useState<string | null>(null)

  // Estado para el buscador de pruebas
  const [testSearchQuery, setTestSearchQuery] = useState('')
  const [caseArchiveView, setCaseArchiveView] = useState<'active' | 'archived' | 'all'>('active')

  // Estados para el programador IA
  const [showIaScheduler, setShowIaScheduler] = useState(false)
  const [selectedTestsForIa, setSelectedTestsForIa] = useState<string[]>([])
  const [scheduledTime, setScheduledTime] = useState('')
  const [schedulerSearch, setSchedulerSearch] = useState('')
  const [execName, setExecName] = useState('')
  const [iaSchedulerOpenedFromBuilder, setIaSchedulerOpenedFromBuilder] = useState(false)

  // Estados para la gestión detallada de proyectos
  const [managingProjectId, setManagingProjectId] = useState<string | null>(null)
  const [projectInnerTab, setProjectInnerTab] = useState<'config' | 'components' | 'envs' | 'wiki' | 'tickets'>('config')

  // Estados para el módulo wiki
  const [wikiPages, setWikiPages] = useState<any[]>(ALLOW_LOCAL_FALLBACK ? initialWikiPages : []);
  const [wikiMode, setWikiMode] = useState<'list' | 'view' | 'edit' | 'history'>('list');
  const [selectedWiki, setSelectedWiki] = useState<any>(null);
  const [wikiFormData, setWikiFormData] = useState({ title: '', content: '' });



  // System Configurations & Data (Dynamic hierarchies)
  const [organizations, setOrganizations] = useState(ALLOW_LOCAL_FALLBACK ? initialOrganizations : [])
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('')
  const [organizationMembers, setOrganizationMembers] = useState<any[]>([])
  const [organizationMemberForm, setOrganizationMemberForm] = useState({ userId: '' })
  const [currentOrgId, setCurrentOrgId] = useState(ALLOW_LOCAL_FALLBACK ? 'o1' : '')

  const [projectsList, setProjectsList] = useState(ALLOW_LOCAL_FALLBACK ? initialProjects : [])
  const [currentProjectId, setCurrentProjectId] = useState(ALLOW_LOCAL_FALLBACK ? 'p1' : '')
  const [projectsSource, setProjectsSource] = useState<'local' | 'backend'>(ALLOW_LOCAL_FALLBACK ? 'local' : 'backend')
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectSyncMessage, setProjectSyncMessage] = useState(
    ALLOW_LOCAL_FALLBACK
      ? 'Modo diseño/local habilitado por VITE_ALLOW_LOCAL_FALLBACK.'
      : 'Modo real: esperando sincronización con backend.'
  )

  const [componentsList, setComponentsList] = useState(ALLOW_LOCAL_FALLBACK ? initialComponents : [])
  const [currentCompId, setCurrentCompId] = useState(ALLOW_LOCAL_FALLBACK ? 'c1' : '')
  const currentComponentName = useMemo(() => {
    const component = componentsList.find(item => String(item.id) === String(currentCompId || ''))
    return component?.name || (component as any)?.nombre || ''
  }, [componentsList, currentCompId])

  const [componentSearchQuery, setComponentSearchQuery] = useState('')
  
  const [showComponentModal, setShowComponentModal] = useState(false)
  const [componentForm, setComponentForm] = useState({ id: '', name: '', description: '', techStack: '', variablesText: '' })

  const [buildsList, setBuildsList] = useState(ALLOW_LOCAL_FALLBACK ? initialBuilds : [])
  const [currentBuildId, setCurrentBuildId] = useState(ALLOW_LOCAL_FALLBACK ? 'b1' : '')
  const [buildCaseIds, setBuildCaseIds] = useState<Record<string, string[]>>({})
  const [buildCasesLoadingByBuild, setBuildCasesLoadingByBuild] = useState<Record<string, boolean>>({})
  const [showBuildCasesModal, setShowBuildCasesModal] = useState(false)
  const [editingBuildCasesId, setEditingBuildCasesId] = useState<string | null>(null)
  const [buildCaseDraftIds, setBuildCaseDraftIds] = useState<string[]>([])
  const [lockedBuildCaseIds, setLockedBuildCaseIds] = useState<Record<string, string[]>>({})
  const [buildCaseSearch, setBuildCaseSearch] = useState('')

  // Git integration state (mock preview)
  const [gitConfig, setGitConfig] = useState({
    provider: ALLOW_LOCAL_FALLBACK ? 'github' : '',
    repoUrl: ALLOW_LOCAL_FALLBACK ? 'https://github.com/enterprise-global/proyecto-alfa-core' : '',
    branch: ALLOW_LOCAL_FALLBACK ? 'main' : '',
    webhookUrl: '',
    webhookToken: '',
    autoSync: false,
    lastCommit: ALLOW_LOCAL_FALLBACK
      ? {
          hash: 'fa287c8',
          author: 'dev-lead@enterprise.com',
          message: 'feat(auth): add auth validation schema for MFA bypass prevention',
          date: '2026-06-13 21:04'
        }
      : null
  })

  const authClient = useMemo(() => createAuthClient({
    setLoggedUser,
    setIsAuthenticated,
    setLoginError
  }), [])

  const {
    loginWithPassword,
    loginWithAdPassword,
    authHeaders,
    fetchWithAuth,
    persistSession,
    syncSessionFromBackend
  } = authClient

  const canAccessModule = useCallback((moduleId: ModuleId, level: PermissionLevel = 'read') => {
    return canAccessModuleForUser(loggedUser, moduleId, level)
  }, [loggedUser])

  const canAccessCapability = useCallback((capabilityId: any, level: PermissionLevel = 'read') => {
    return canAccessCapabilityForUser(loggedUser, capabilityId, level)
  }, [loggedUser])

  const [systemFeatureIds, setSystemFeatureIds] = useState<Set<string>>(new Set())
  const [systemFeaturesLoaded, setSystemFeaturesLoaded] = useState(false)
  const [systemEdition, setSystemEdition] = useState<'community' | 'premium'>('community')
  const [firstRunState, setFirstRunState] = useState<any>(null)
  const [firstRunLoaded, setFirstRunLoaded] = useState(false)
  const [branding, setBranding] = useState<BrandingState>(DEFAULT_BRANDING)

  const loadPublicBranding = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/system/branding/public`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.detail || 'No se pudo cargar branding.')
      setBranding(normalizeBrandingState(data))
    } catch {
      setBranding(DEFAULT_BRANDING)
    }
  }, [])

  useEffect(() => {
    void loadPublicBranding()
  }, [loadPublicBranding])

  useEffect(() => {
    if (!isAuthenticated) {
      setSystemFeatureIds(new Set())
      setSystemFeaturesLoaded(false)
      setSystemEdition('community')
      setFirstRunState(null)
      setFirstRunLoaded(false)
      return
    }
    let cancelled = false
    fetchWithAuth(`${API_BASE}/system/features`)
      .then(async response => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data?.detail || 'No se pudieron cargar las features del sistema.')
        return data
      })
      .then(data => {
        if (cancelled) return
        setSystemEdition(data.edition === 'premium' ? 'premium' : 'community')
        setSystemFeatureIds(new Set((data.features || []).filter((feature: any) => feature.enabled).map((feature: any) => feature.id)))
        setSystemFeaturesLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setSystemFeatureIds(new Set())
        setSystemEdition('community')
        setSystemFeaturesLoaded(true)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated) {
      setFirstRunState(null)
      setFirstRunLoaded(false)
      return
    }
    let cancelled = false
    setFirstRunLoaded(false)
    fetchWithAuth(`${API_BASE}/system/first-run`)
      .then(async response => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data?.detail || 'No se pudo cargar el estado inicial.')
        return data
      })
      .then(data => {
        if (cancelled) return
        setFirstRunState(data)
        setFirstRunLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setFirstRunState({ completed: true, requires_onboarding: false, installation_has_data: true })
        setFirstRunLoaded(true)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated])

  const canAccessEntitledModule = useCallback((moduleId: ModuleId) => {
    if (!systemFeaturesLoaded) return true
    if (moduleId === 'motor_ia') return systemFeatureIds.has('ai.basic_execution') || systemFeatureIds.has('ai.engine')
    if (moduleId === 'redmine') return true
    return true
  }, [systemFeatureIds, systemFeaturesLoaded])

  const hasSystemFeature = useCallback((featureId: string) => {
    return systemFeatureIds.has(featureId)
  }, [systemFeatureIds])

  useEffect(() => {
    const theme = loggedUser.personalTheme || 'system'
    const density = loggedUser.profileSettings?.density || 'comfortable'
    document.documentElement.dataset.qaTheme = theme
    document.documentElement.dataset.qaDensity = density
  }, [loggedUser.personalTheme, loggedUser.profileSettings])

  useEffect(() => {
    if (!isAuthenticated || !internalReportToken) return
    let cancelled = false
    setInternalReportLoading(true)
    setInternalReportError('')
    fetchWithAuth(`${API_BASE}/reports/internal/${encodeURIComponent(internalReportToken)}`)
      .then(async response => {
        if (!response.ok) throw new Error(await response.text())
        return response.text()
      })
      .then(html => {
        if (cancelled) return
        const baseTag = `<base href="${window.location.origin}${API_BASE}/reports/internal/${encodeURIComponent(internalReportToken)}">`
        const withBase = html.match(/<head[^>]*>/i)
          ? html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`)
          : html
        setInternalReportHtml(withBase)
      })
      .catch((error: any) => {
        if (!cancelled) setInternalReportError(error?.message || 'No se pudo abrir el informe interno.')
      })
      .finally(() => {
        if (!cancelled) setInternalReportLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, internalReportToken, fetchWithAuth])

  const handleLoggedUserUpdated = (backendUser: any) => {
    const mapped = mapBackendUserToSession(backendUser)
    setLoggedUser(mapped)
    localStorage.setItem('qa_session_user', JSON.stringify(mapped))
  }

  const handleLoggedUserPreferencesUpdated = (preferences: any) => {
    setLoggedUser(prev => {
      const next = {
        ...prev,
        personalTheme: preferences.personal_theme || prev.personalTheme,
        profileSettings: preferences.profile_settings || prev.profileSettings,
        projectThemeOverrides: preferences.project_theme_overrides || prev.projectThemeOverrides,
      }
      localStorage.setItem('qa_session_user', JSON.stringify(next))
      return next
    })
  }

  const {
    loadComponentsForProject,
    loadBuildsForProject,
    loadBuildCaseIdsForBuilds,
    loadBuildCaseIdsForProject
  } = createProjectLoaders({
    projectsSource,
    currentCompId,
    componentsList,
    fetchWithAuth,
    setComponentsList,
    setBuildsList,
    setBuildCaseIds,
    setCurrentCompId,
    setNewTestComponent,
    setCurrentBuildId,
    setProjectSyncMessage
  })

  const startSuiteExplorerResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    suiteExplorerResizeCleanupRef.current?.()
    const startX = event.clientX
    const startWidth = suiteExplorerWidth
    const onMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.min(560, Math.max(260, startWidth + moveEvent.clientX - startX))
      setSuiteExplorerWidth(nextWidth)
    }
    const cleanup = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      document.body.style.userSelect = ''
      suiteExplorerResizeCleanupRef.current = null
    }
    const onMouseUp = () => {
      cleanup()
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    suiteExplorerResizeCleanupRef.current = cleanup
  }

  useEffect(() => () => {
    suiteExplorerResizeCleanupRef.current?.()
  }, [])

  // Funciones compartidas de UI
  const showFeedback = (title: string, message: string, variant: 'success' | 'danger' | 'warning' | 'info' = 'info') => {
    setFeedbackModal({ show: true, title, message: stringifyFeedbackMessage(message), variant })
  }

  useEffect(() => {
    const refreshSignal = () => {
      const next = readUpdateMaintenanceSignal()
      setUpdateMaintenanceState(prev => {
        const unchanged = prev.active === next.active
          && prev.timedOut === next.timedOut
          && prev.until === next.until
          && prev.message === next.message
          && prev.targetVersion === next.targetVersion
          && prev.lastCheckedAt === next.lastCheckedAt
          && prev.backendVersion === next.backendVersion
        return unchanged ? prev : next
      })
    }
    refreshSignal()
    const timer = window.setInterval(refreshSignal, 1000)
    window.addEventListener(UPDATE_MAINTENANCE_EVENT, refreshSignal)
    window.addEventListener('storage', refreshSignal)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener(UPDATE_MAINTENANCE_EVENT, refreshSignal)
      window.removeEventListener('storage', refreshSignal)
    }
  }, [])

  useEffect(() => {
    if (!updateMaintenanceState.active && !updateMaintenanceState.timedOut) return undefined
    let cancelled = false

    const pollRestartState = async () => {
      const activeSignal = readUpdateMaintenanceSignal()
      if (!activeSignal.active && !activeSignal.timedOut) return
      try {
        const statusResponse = await fetchWithAuth(`${API_BASE}/system/updates/status`)
        const data = await statusResponse.json().catch(() => ({}))
        if (data?.status === 'restarting') {
          const refreshed = announceUpdateMaintenance(undefined, data?.pending_version)
          if (!cancelled) setUpdateMaintenanceState(refreshed)
          return
        }
      } catch {
        // Backend can be temporarily unavailable while the update entrypoint restarts services.
      }

      try {
        const response = await fetchWithAuth(`${API_BASE}/system/version`)
        const versionPayload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(versionPayload?.detail || 'Backend no disponible')
        const backendVersion = String(versionPayload?.version || '')
        if (activeSignal.targetVersion && backendVersion !== activeSignal.targetVersion) {
          if (!cancelled) {
            setUpdateMaintenanceState(updateMaintenanceConnectionState({
              backendVersion,
              lastCheckedAt: Date.now(),
              message: `Backend respondio ${backendVersion}; esperando version ${activeSignal.targetVersion}.`,
            }))
          }
          return
        }
        clearUpdateMaintenanceSignal()
        window.location.reload()
      } catch {
        if (!cancelled) {
          setUpdateMaintenanceState(updateMaintenanceConnectionState({
            lastCheckedAt: Date.now(),
            message: 'Treseko esta aplicando una actualizacion. Reintentando conexion con el backend.',
          }))
        }
      }
    }

    void pollRestartState()
    const timer = window.setInterval(pollRestartState, 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [fetchWithAuth, updateMaintenanceState.active, updateMaintenanceState.timedOut, updateMaintenanceState.until, updateMaintenanceState.targetVersion])

  const consumeDeepLinkBug = useCallback(() => {
    setDeepLinkBugId('')
    const url = new URL(window.location.href)
    if (!url.searchParams.has('bug_id')) return
    url.searchParams.delete('bug_id')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

  const openBugTrackerDetail = useCallback((bug: any) => {
    const bugId = bug?.id ? String(bug.id) : ''
    if (!bugId) {
      showFeedback('Bug Tracker', 'No se pudo identificar el bug seleccionado.', 'warning')
      return
    }
    if (!canAccessCapability('bugs.ver', 'read')) {
      showFeedback('Sin permiso', 'No tienes permiso para ver el detalle de bugs.', 'warning')
      return
    }
    setDeepLinkBugId(bugId)
    setActiveTab('bugs')
  }, [canAccessCapability])

  const closeInternalReportViewer = () => {
    setInternalReportToken('')
    setInternalReportHtml('')
    setInternalReportError('')
    const url = new URL(window.location.href)
    url.searchParams.delete('internal_report')
    url.searchParams.set('tab', activeTab || 'reportes')
    if (url.pathname.startsWith('/informes-internos/')) url.pathname = '/'
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }

  const closeConfirmDialog = useCallback((confirmed: boolean) => {
    confirmResolverRef.current?.(confirmed)
    confirmResolverRef.current = null
    setConfirmDialog(prev => ({ ...prev, show: false }))
  }, [])

  const confirmAction = useCallback((options: ConfirmDialogOptions) => {
    confirmResolverRef.current?.(false)
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve
      setConfirmDialog({
        show: true,
        variant: options.variant || 'warning',
        title: options.title,
        message: stringifyFeedbackMessage(options.message),
        confirmLabel: options.confirmLabel || (options.variant === 'info' ? 'Entendido' : 'Confirmar'),
        cancelLabel: options.cancelLabel === undefined ? 'Cancelar' : options.cancelLabel
      })
    })
  }, [])

  const stringifyFeedbackMessage = (value: any, seen = new WeakSet<object>()): string => {
    if (value == null) return ''
    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
      if (seen.has(value)) return '[Referencia circular]'
      seen.add(value)
      return value.map((item) => stringifyFeedbackMessage(item, seen)).filter(Boolean).join('\n')
    }
    if (typeof value === 'object') {
      if (seen.has(value)) return '[Referencia circular]'
      seen.add(value)
      if (typeof value.message === 'string') return value.message
      if (typeof value.msg === 'string') {
        const path = Array.isArray(value.loc) ? value.loc.join('.') : ''
        return path ? `${path}: ${value.msg}` : value.msg
      }
      if (value.detail) return stringifyFeedbackMessage(value.detail, seen)
      try {
        return JSON.stringify(value, null, 2)
      } catch {
        return String(value)
      }
    }
    return String(value)
  }

  const readBackendError = async (response: Response, fallback: string): Promise<string> => {
    const raw = await response.text().catch(() => '')
    if (!raw) return fallback
    try {
      const parsed = JSON.parse(raw)
      return humanizePremiumError(stringifyFeedbackMessage(parsed?.detail || parsed?.message || parsed))
    } catch {
      return humanizePremiumError(raw)
    }
  }

  const {
    loadOrganizationsFromBackend,
    handleCreateOrganization,
    loadAllOrganizationMembers,
    handleUpdateOrganization,
    handleSetOrganizationActive,
    handleAssignOrganizationMember,
    handleRemoveOrganizationMember
  } = createOrganizationActions({
    projectsSource,
    organizations,
    selectedOrganizationId,
    organizationMemberForm,
    fetchWithAuth,
    setOrganizations,
    setCurrentOrgId,
    setSelectedOrganizationId,
    setProjectsList,
    setCurrentProjectId,
    setCurrentCompId,
    setCurrentBuildId,
    setOrganizationMembers,
    setOrganizationMemberForm,
    setProjectSyncMessage,
    showFeedback,
    confirmAction
  })

  // FUNCIONES PARA MANEJAR SUITES
  const {
    loadSuitesFromBackend,
    handleCreateSuite,
    handleUpdateSuite,
    handleDeleteSuite,
    handleCloneSuite,
    handleMoveSuite,
    handleReorderSuite,
    openCreateSuiteModal,
    openEditSuiteModal,
    openMoveSuiteModal
  } = createSuiteActions({
    projectsSource,
    currentCompId,
    managingProjectId,
    currentProjectId,
    componentsList,
    suiteForm,
    editingSuiteId,
    movingSuiteId,
    moveSuiteParentId,
    fetchWithAuth,
    reloadCasosAfterSuiteClone: (projectId, componentsSnapshot) => loadCasosFromBackendRef.current?.(projectId, componentsSnapshot),
    setSuitesLoading,
    setSuitesTree,
    setProjectSyncMessage,
    setShowSuiteModal,
    setSuiteForm,
    setEditingSuiteId,
    setShowMoveSuiteModal,
    setMovingSuiteId,
    setMoveSuiteParentId,
    setSelectedSuiteId,
    setSelectedSubSuiteId,
    setExpandedSuites,
    setNewTestSuite,
    setNewTestSuiteSub,
    showFeedback,
    confirmAction
  })

  const mapBackendCasoToTest = (caso: any, componentsSnapshot = componentsList) =>
    mapBackendCasoToTestBase(caso, componentsSnapshot, currentProjectId)


  const {
    loadCasosFromBackend,
    searchCasos,
    handleCreateCaso,
    handleUpdateCaso,
    handleDeleteCaso,
    handleCloneCaso,
    handleMoveCaso,
    loadCasoVersions,
    loadCasoExecutionHistory
  } = createCaseActions({
    projectsSource,
    managingProjectId,
    currentProjectId,
    currentBuildId,
    componentsList,
    casosPage,
    casosPageSize,
    casosSearchQuery,
    casosFilterSuite,
    casosFilterPrioridad,
    casosFilterCriticidad,
    casosFilterEstado,
    casosFilterEtiqueta,
    selectedTest,
    buildCaseResultHistoryByBuild,
    fetchWithAuth,
    mapBackendCasoToTest,
    setCasosLoading,
    setCasosList,
    setCasosSearchResults,
    setCasosTotal,
    setShowCasoModal,
    setProjectSyncMessage,
    setCaseVersions,
    setVersionsCase,
    setSelectedCompareVersionId,
    setShowVersionsModal,
    showFeedback,
    confirmAction
  })

  const updateCaseArchiveStatus = useCallback(async (test: any, nextStatus: 'ARCHIVADO' | 'ACTIVO') => {
    if (!test?.id || !currentProjectId) return
    const isArchiving = nextStatus === 'ARCHIVADO'
    if (isArchiving) {
      const confirmed = await confirmAction({
        title: 'Archivar prueba',
        message: 'La prueba dejará de aparecer en creación y ejecución, pero su historial seguirá disponible.',
        variant: 'warning',
        confirmLabel: 'Archivar prueba'
      })
      if (!confirmed) return
    }

    try {
      const response = await fetchWithAuth(`${API_BASE}/casos/${test.id}/metadata`, {
        method: 'PATCH',
        body: JSON.stringify({ estado_caso: nextStatus })
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      await loadCasosFromBackend(currentProjectId, componentsList)
      if (selectedTest?.masterId === test.masterId || selectedTest?.id === test.id) {
        setSelectedTest(null)
        setCaseEditorOpen(false)
        setEditingCasoMasterId(null)
      }
      showFeedback(
        isArchiving ? 'Prueba archivada' : 'Prueba restaurada',
        isArchiving
          ? 'La prueba quedó oculta de los flujos diarios y conserva su historial.'
          : 'La prueba vuelve a estar disponible para creación y ejecución.',
        'success'
      )
    } catch (error: any) {
      showFeedback(
        isArchiving ? 'No se pudo archivar' : 'No se pudo restaurar',
        error?.message || 'No se pudo actualizar el estado de la prueba.',
        'danger'
      )
    }
  }, [componentsList, confirmAction, currentProjectId, fetchWithAuth, loadCasosFromBackend, selectedTest, showFeedback])

  const updateSuiteArchiveStatus = useCallback(async (suite: any, archivado: boolean) => {
    if (!suite?.id || !currentProjectId) return
    const confirmed = archivado
      ? await confirmAction({
          title: 'Archivar suite',
          message: 'La suite, sus sub-suites y sus pruebas dejarán de aparecer en creación y ejecución, pero el historial seguirá disponible.',
          variant: 'warning',
          confirmLabel: 'Archivar suite'
        })
      : true
    if (!confirmed) return

    try {
      const response = await fetchWithAuth(`${API_BASE}/suites/${suite.id}/archive`, {
        method: 'PATCH',
        body: JSON.stringify({ archivado })
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const result = await response.json().catch(() => ({}))
      await loadSuitesFromBackend(currentProjectId, currentCompId)
      await loadCasosFromBackend(currentProjectId, componentsList)
      setSelectedTest(null)
      setCaseEditorOpen(false)
      setEditingCasoMasterId(null)
      showFeedback(
        archivado ? 'Suite archivada' : 'Suite restaurada',
        `${result.suites_afectadas || 1} suite(s) y ${result.casos_afectados || 0} prueba(s) actualizadas.`,
        'success'
      )
    } catch (error: any) {
      showFeedback(
        archivado ? 'No se pudo archivar la suite' : 'No se pudo restaurar la suite',
        error?.message || 'No se pudo actualizar la suite.',
        'danger'
      )
    }
  }, [componentsList, confirmAction, currentCompId, currentProjectId, fetchWithAuth, loadCasosFromBackend, loadSuitesFromBackend, showFeedback])

  const getCasoVersionRows = createCaseVersionRows({ suitesTree, componentsList })

  const getRootSuiteId = (suiteId: string) => getRootSuiteIdFromTree(suitesTree, suiteId)
  const getSuiteDepth = (suiteId: string) => getSuiteDepthFromTree(suitesTree, suiteId)
  const selectSuiteTarget = (suiteId: string) => {
    if (!suiteId) return
    setSelectedSuiteId(suiteId)
    setSelectedSubSuiteId(suiteId)
    setNewTestSuite(getRootSuiteId(suiteId))
    setNewTestSuiteSub(suiteId)
  }

  // Función para obtener las subsuites de una suite
  const getSubSuites = (suiteId: string): any[] => {
    const suite = findSuiteById(suitesTree, suiteId)
    return suite?.children || []
  }

  const renderAuthoringSuiteTree = (
    suites: any[],
    openCloneCaseModal?: (test: any) => void,
    openCloneSuiteModal?: (suite: any) => void,
    openMoveCaseModal?: (test: any) => void
  ) => (
    <AuthoringSuiteTreeView
      suites={suites}
      expandedSuites={expandedSuites}
      selectedSuiteId={selectedSuiteId}
      selectedSubSuiteId={selectedSubSuiteId}
      selectedTest={selectedTest}
      casosList={visibleAuthoringCases}
      currentCompId={currentCompId}
      testSearchQuery={testSearchQuery}
      selectSuiteTarget={selectSuiteTarget}
      setExpandedSuites={setExpandedSuites}
      openCreateCaseInSuite={canAccessCapability('crear_pruebas.casos', 'edit') ? openCreateCaseInSuite : (() => undefined)}
      openCreateSuiteModal={canAccessCapability('crear_pruebas.suites', 'edit') ? openCreateSuiteModal : (() => undefined)}
      openEditSuiteModal={canAccessCapability('crear_pruebas.suites', 'edit') ? openEditSuiteModal : (() => undefined)}
      openCloneSuiteModal={openCloneSuiteModal || (() => undefined)}
      openMoveSuiteModal={canAccessCapability('crear_pruebas.suites', 'edit') ? openMoveSuiteModal : (() => undefined)}
      handleArchiveSuite={canAccessCapability('crear_pruebas.suites', 'edit') ? (suite) => updateSuiteArchiveStatus(suite, true) : undefined}
      handleRestoreSuite={canAccessCapability('crear_pruebas.suites', 'edit') ? (suite) => updateSuiteArchiveStatus(suite, false) : undefined}
      handleDeleteSuite={canAccessCapability('crear_pruebas.suites', 'edit') ? handleDeleteSuite : (() => undefined)}
      openEditCase={canAccessCapability('crear_pruebas.casos', 'edit') ? openEditCase : (() => undefined)}
      openCloneCaseModal={openCloneCaseModal || (() => undefined)}
      openMoveCaseModal={openMoveCaseModal || (() => undefined)}
      handleArchiveCaso={canAccessCapability('crear_pruebas.casos', 'edit') ? (test) => updateCaseArchiveStatus(test, 'ARCHIVADO') : undefined}
      handleRestoreCaso={canAccessCapability('crear_pruebas.casos', 'edit') ? (test) => updateCaseArchiveStatus(test, 'ACTIVO') : undefined}
      loadCasoVersions={canAccessCapability('crear_pruebas.versiones', 'read') ? loadCasoVersions : (() => undefined)}
      handleDeleteCaso={canAccessCapability('crear_pruebas.casos', 'edit') ? handleDeleteCaso : (() => undefined)}
    />
  )

  const renderExecutionSuiteTree = (suites: any[]) => (
    <ExecutionSuiteTreeView
      suites={suites}
      expandedSuites={expandedSuites}
      selectedSuiteId={selectedSuiteId}
      selectedSubSuiteId={selectedSubSuiteId}
      selectedTest={selectedTest}
      casosList={currentProjectCases.filter(test => !currentBuildId || (buildCaseIds[currentBuildId] || []).includes(test.id))}
      currentCompId={currentCompId}
      testSearchQuery={testSearchQuery}
      getSuiteExecutionMetrics={getSuiteExecutionMetrics}
      selectSuiteTarget={selectSuiteTarget}
      setExpandedSuites={setExpandedSuites}
      handleSelectTestForExecution={handleSelectTestForExecution}
      showFeedback={showFeedback}
    />
  )

  const {
    loadBuildCaseExecutionStatus
  } = createBuildExecutionStatusActions({
    projectsSource,
    latestResultsRequestRef,
    fetchWithAuth,
    setLatestResultsLoadingByBuild,
    setLockedBuildCaseIds,
    setBuildCaseResultHistoryByBuild,
    setCasosList,
    setSelectedTest,
    setProjectSyncMessage
  })

  const {
    projectMetrics,
    setProjectMetrics,
    metricsLoading,
    expandedMetricSuites,
    setExpandedMetricSuites,
    loadProjectMetrics,
  } = useReportesMetrics({
    activeTab,
    currentProjectId,
    currentBuildId,
    projectsSource,
    fetchWithAuth,
    setProjectSyncMessage
  })

  const {
    loadBuildCases,
    openBuildCasesModal,
    saveBuildCases,
    assignPreviousFailedCases
  } = createBuildScopeActions({
    projectsSource,
    buildCaseIds,
    editingBuildCasesId,
    buildCaseDraftIds,
    fetchWithAuth,
    mapBackendCasoToTest,
    loadBuildCaseExecutionStatus,
    setBuildCasesLoadingByBuild,
    setCasosList,
    setBuildCaseIds,
    setEditingBuildCasesId,
    setBuildCaseDraftIds,
    setBuildCaseSearch,
    setShowBuildCasesModal,
    setProjectSyncMessage,
    showFeedback
  })

  const {
    handleOrgChange,
    handleProjectChange,
    handleComponentChange,
    hydrateProjectContext,
    refreshCurrentTestContext,
    loadProjectTestContext
  } = createContextActions({
    activeTab,
    projectsSource,
    currentProjectId,
    currentCompId,
    projectsList,
    componentsList,
    loadComponentsForProject,
    loadBuildsForProject,
    loadSuitesFromBackend,
    loadCasosFromBackend,
    loadBuildCases,
    loadBuildCaseExecutionStatus,
    setCurrentOrgId,
    setManagingProjectId,
    setSelectedTest,
    setSelectedExecutionTestIds,
    setSelectedTestsForIa,
    setProjectMetrics,
    setCurrentProjectId,
    setCurrentCompId,
    setCurrentBuildId,
    setViewMode,
    setNewTestComponent
  })

  useEffect(() => {
    loadProjectTestContext()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, projectsSource])

  useEffect(() => {
    let cancelled = false
    if (currentBuildId && isValidUUID(currentBuildId)) {
      loadBuildCases(currentBuildId).then(ids => {
        if (cancelled) return
        setSelectedExecutionTestIds(prev => prev.filter(testId => ids.includes(testId)))
        loadBuildCaseExecutionStatus(currentBuildId, ids)
      })
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBuildId, projectsSource])

  useEffect(() => {
    const shouldRefresh =
      activeTab === 'crear_pruebas' ||
      activeTab === 'ejecutar' ||
      (activeTab === 'proyectos' && projectInnerTab === 'components')
    if (!shouldRefresh) return
    refreshCurrentTestContext(currentCompId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, projectInnerTab, currentCompId, currentProjectId, projectsSource])

  useEffect(() => {
    if (activeTab !== 'proyectos' || !managingProjectId || projectsSource !== 'backend') return
    hydrateProjectContext(managingProjectId, currentCompId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, managingProjectId, projectInnerTab, projectsSource])

  // Estados para configuración modular y usuarios
  const [configTab, setConfigTab] = useState<'general' | 'profile' | 'clients' | 'users' | 'roles' | 'integrations' | 'ai'>('general')

  useEffect(() => {
    if (!isAuthenticated || activeTab !== 'configuracion' || configTab !== 'clients' || projectsSource !== 'backend') return
    loadOrganizationsFromBackend({ includeInactive: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, activeTab, configTab, projectsSource])

  useEffect(() => {
    if (!isAuthenticated || activeTab !== 'configuracion' || configTab !== 'clients' || !selectedOrganizationId) return
    const key = `${projectsSource}:${selectedOrganizationId}`
    if (organizationMembersLoadKeyRef.current === key) return
    organizationMembersLoadKeyRef.current = key
    loadAllOrganizationMembers(selectedOrganizationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, activeTab, configTab, selectedOrganizationId, projectsSource])

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    const run = async () => {
      await Promise.allSettled([
        environmentActions.loadEnvironmentsForProject(currentProjectId),
        wikiActions.loadWikiForProject(currentProjectId),
        loadUsersFromBackend(),
        loadRolesFromBackend(),
        projectMemberActions.loadProjectMembers(currentProjectId),
      ])
      if (cancelled) return
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, projectsSource, isAuthenticated])

  useEffect(() => {
    if (selectedTest && selectedTest.projectId !== currentProjectId) {
      setSelectedTest(null)
      setViewMode('list')
    }
  }, [currentProjectId, selectedTest])

  // Estados del inventario avanzado dinámico (carpetas dinámicas)
  const [inventoryCategories, setInventoryCategories] = useState<any[]>(ALLOW_LOCAL_FALLBACK ? initialInventoryCategories : [])

  // Inventory State
  // Estados enriquecidos para el inventario y CRUD
  const [environments, setEnvironments] = useState(ALLOW_LOCAL_FALLBACK ? initialEnvironments : [])
  const [devices, setDevices] = useState(ALLOW_LOCAL_FALLBACK ? initialDevices : [])
  const [agents, setAgents] = useState(ALLOW_LOCAL_FALLBACK ? initialAgents : [])

  // Estado para guardar los items de las carpetas que crees manualmente
  const [customInventoryItems, setCustomInventoryItems] = useState<any[]>(ALLOW_LOCAL_FALLBACK ? initialCustomInventoryItems : [])

  // Estados para controlar los modales de creación/edición
  const [invModalConfig, setInvModalConfig] = useState<{ show: boolean, type: 'env' | 'device' | 'node', mode: 'add' | 'edit', itemData: any }>({
    show: false, type: 'env', mode: 'add', itemData: null
  });

  // Redmine Bugs State
  const [redmineBugs, setRedmineBugs] = useState(ALLOW_LOCAL_FALLBACK ? initialRedmineBugs : [])

  // Run History State
  const {
    runHistory,
    historialInitialFilters,
    pendingHistorialRunDetailId,
    setPendingHistorialRunDetailId,
    loadProjectRunHistory,
    loadTestRunDetail,
    markHistorialAiReviewed,
    openHistorialRuns,
  } = useHistorialController({
    activeTab,
    currentProjectId,
    currentBuildId,
    projectsSource,
    initialRunHistory: ALLOW_LOCAL_FALLBACK ? initialRunHistory : [],
    fetchWithAuth,
    setProjectSyncMessage,
    showFeedback,
    loadProjectMetrics,
    setActiveTab,
  })
  const {
    executionRunDetail,
    executionRunDetailLoading,
    executionRunDetailError,
    openExecutionRunDetail,
    closeExecutionRunDetail,
  } = useExecutionRunDetail({ loadTestRunDetail })

  // AI Engine State
  const [iaStatus, setIaStatus] = useState<'idle' | 'running'>('idle')
  const [iaLogs, setIaLogs] = useState<any[]>(ALLOW_LOCAL_FALLBACK ? initialIaLogs : [])
  const [iaQueue, setIaQueue] = useState<string[]>([])
  const [iaExecutionStreams, setIaExecutionStreams] = useState<any[]>([])

  // Settings State
  const [redmineUrl, setRedmineUrl] = useState(ALLOW_LOCAL_FALLBACK ? initialRedmineSettings.url : '')
  const [redmineToken, setRedmineToken] = useState(ALLOW_LOCAL_FALLBACK ? initialRedmineSettings.token : '')
  const [redmineProjKey, setRedmineProjKey] = useState(ALLOW_LOCAL_FALLBACK ? initialRedmineSettings.projectKey : '')
  const [useShaDedup, setUseShaDedup] = useState(true)
  const [iaProvider, setIaProvider] = useState('gemini')
  const [iaApiKey, setIaApiKey] = useState('')
  const [iaTemp, setIaTemp] = useState(0.2)
  const aiEngineConfiguration = useAiEngineConfig({
    isAuthenticated,
    fetchWithAuth,
    defaultConfig: defaultAiEngineConfig,
    normalizeAiAgentWorkflow,
    setIaProvider,
    setIaTemp,
    setIaLogs,
    showFeedback,
  })
  const { aiEngineConfig, loadAiEngineConfig } = aiEngineConfiguration
  const [iaMaxSteps, setIaMaxSteps] = useState(15)
  const generalConfiguration = useGeneralConfiguration({
    isAuthenticated,
    fetchWithAuth,
    defaultAttachmentConfig,
    showFeedback,
    confirmAction,
  })
  const { attachmentConfig, copyToClipboard, loadAttachmentConfig, loadApiKeys } = generalConfiguration
  const sessionConfiguration = useSessionConfig({
    isAuthenticated,
    fetchWithAuth,
    showFeedback,
    setIsAuthenticated,
    setLoginError,
  })
  const { loadSessionConfig } = sessionConfiguration
  useConfigurationPreload({
    activeTab,
    configTab,
    isAuthenticated,
    canAccessCapability,
    hasSystemFeature,
    loadApiKeys,
    loadSessionConfig,
    loadAiEngineConfig,
    loadAttachmentConfig,
  })
  useEffect(() => {
    loadCasosFromBackendRef.current = loadCasosFromBackend
  }, [loadCasosFromBackend])


  const adminUserRolesConfiguration = useAdminUserRolesConfig({
    allowLocalFallback: ALLOW_LOCAL_FALLBACK,
    initialAdConfig,
    initialAppUsers,
    projectsSource,
    fetchWithAuth,
    setProjectSyncMessage,
    confirmAction,
  })
  const {
    adConfig,
    setAdConfig,
    appUsers,
    assignableUsers,
    customRoles,
    systemRoleItems,
    showRoleModal,
    setShowRoleModal,
    editingRoleId,
    roleForm,
    setRoleForm,
    showUserModal,
    setShowUserModal,
    editingUserId,
    userForm,
    setUserForm,
    loadUsersFromBackend,
    loadRolesFromBackend,
    handleUserRoleChange,
    handleUserCustomRoleChange,
    handleSaveUser,
    setRoleModulePermission,
    setRoleCapabilityPermission,
    handleSaveRole,
  } = adminUserRolesConfiguration

  useEffect(() => {
    if (!isAuthenticated || activeTab !== 'configuracion' || configTab !== 'users') return
    loadUsersFromBackend()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, activeTab, configTab, projectsSource])

  useLiveRefresh({
    enabled: isAuthenticated && activeTab === 'configuracion' && configTab === 'users',
    intervalMs: 15000,
    refreshOnFocus: true,
    onRefresh: loadUsersFromBackend,
  })

  const [projectMembers, setProjectMembers] = useState<any[]>([])
  const [showProjectMemberModal, setShowProjectMemberModal] = useState(false)
  const [projectMemberForm, setProjectMemberForm] = useState({ userId: '' })
  const [projectMemberRemoval, setProjectMemberRemoval] = useState<any | null>(null)

  const historyComparisonData = createHistoryComparisonData(runHistory, currentProjectId)

  const {
    currentProjectCases,
    allAuthoringCases,
    archivedAuthoringCases,
    currentAuthoringCases,
    canEditCurrentProject,
    currentProjectEnvironments,
    currentProjectDevices,
    currentProjectAgents,
    currentProjectInventoryCategories,
    currentProjectCustomInventoryItems,
    currentProjectRedmineBugs,
    currentProjectRunHistory,
    currentProjectIaQueue,
    belongsToCurrentComponent,
    currentComponentCases,
    visibleSuiteTree,
    allVisibleSuiteTree,
    authoringInitialLoading,
    authoringRefreshing,
    getSubSuiteStats,
    getSuiteStats
  } = buildProjectViewModel({
    currentProjectId,
    currentCompId,
    managingProjectId,
    loggedUser,
    projectsSource,
    casosList,
    projectMembers,
    environments,
    devices,
    agents,
    inventoryCategories,
    customInventoryItems,
    redmineBugs,
    runHistory,
    iaQueue,
    suitesTree,
    suitesLoading,
    casosLoading,
    canEditProjects: canAccessModule('proyectos', 'edit')
  })
  const visibleAuthoringCases = caseArchiveView === 'archived'
    ? archivedAuthoringCases
    : caseArchiveView === 'all'
      ? allAuthoringCases
      : currentAuthoringCases
  const visibleAuthoringSuiteTree = useMemo(() => {
    const visibleCaseSuiteIds = new Set(visibleAuthoringCases.map((test: any) => test.suiteId).filter(Boolean))
    const filterByArchiveView = (suites: any[]): any[] => suites
      .map((suite) => {
        const children = filterByArchiveView(suite.children || [])
        const isArchived = Boolean(suite.archivado)
        const hasVisibleCases = visibleCaseSuiteIds.has(suite.id)
        if (caseArchiveView === 'all' || (caseArchiveView === 'active' && !isArchived) || (caseArchiveView === 'archived' && (isArchived || hasVisibleCases || children.length > 0))) {
          return { ...suite, children }
        }
        return null
      })
      .filter(Boolean)
    return filterByArchiveView(allVisibleSuiteTree)
  }, [allVisibleSuiteTree, caseArchiveView, visibleAuthoringCases])

  useEffect(() => {
    if (selectedExecutionEnvironmentId && currentProjectEnvironments.some(env => env.id === selectedExecutionEnvironmentId)) return
    const defaultEnvironment = currentProjectEnvironments.find(env => String(env.name || '').toLowerCase() === 'qa') || currentProjectEnvironments[0]
    setSelectedExecutionEnvironmentId(defaultEnvironment?.id || '')
  }, [currentProjectEnvironments, selectedExecutionEnvironmentId])

  useEffect(() => {
    const selectedEnvironment = currentProjectEnvironments.find(env => env.id === selectedExecutionEnvironmentId)
    if (!selectedEnvironment) {
      if (selectedExecutionDatasetId) setSelectedExecutionDatasetId('')
      return
    }
    const datasets = selectedEnvironment.datasets || []
    if (selectedExecutionDatasetId && datasets.some((dataset: any) => dataset.id === selectedExecutionDatasetId)) return
    const defaultDataset = datasets.find((dataset: any) => dataset.isDefault) || datasets[0]
    setSelectedExecutionDatasetId(defaultDataset?.id || '')
  }, [currentProjectEnvironments, selectedExecutionEnvironmentId, selectedExecutionDatasetId])

  useEffect(() => {
    if (suitesLoading || casosLoading) return
    const visibleSuites = flattenSuites(visibleSuiteTree)
    const selectedSuite = selectedSubSuiteId || selectedSuiteId
    if (visibleSuites.length === 0) {
      if (selectedSuite) {
        setSelectedSuiteId('')
        setSelectedSubSuiteId(null)
      }
      return
    }
    if (!selectedSuite || !visibleSuites.some(suite => suite.id === selectedSuite)) {
      selectSuiteTarget(visibleSuites[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompId, currentProjectId, suitesTree, casosList, suitesLoading, casosLoading])

  const {
    activeBuildCaseIds,
    activeBuildResultsLoaded,
    activeBuildResultsLoading,
    activeBuildCasesLoading,
    currentExecutionCaseSource,
    currentExecutionCases,
    executionSuiteTree,
    executionInitialLoading,
    executionRefreshing,
    filteredTests,
    suiteComponentMismatchCount,
    suiteBuildMissingCount,
    isOutdatedExecutionCase,
    selectedExecutionTests,
    selectedExecutionDiscardedCount,
    executionModalTests,
    executionModalDiscardedCount,
    activeExecutionTests,
    filteredExecutionTestIds,
    allVisibleExecutionTestsSelected,
    getExecutionStatusKey,
    getSuiteExecutionMetrics,
    getExecutionCaseLabel,
    getLatestCaseForExecution,
    getExecutionActionLabel,
    toggleExecutionSelection,
    toggleVisibleExecutionSelection,
    openExecutionSelector,
    openSingleCaseExecutionSelector,
    closeExecutionSelector,
    openIaSchedulerFromExecutionSelector
  } = useExecutionPreparation({
    activeTab,
    currentBuildId,
    currentCompId,
    currentProjectId,
    currentProjectCases,
    suitesTree,
    visibleSuiteTree,
    buildCaseIds,
    buildCaseResultHistoryByBuild,
    latestResultsLoadingByBuild,
    buildCasesLoadingByBuild,
    suitesLoading,
    casosLoading,
    selectedSubSuiteId,
    selectedSuiteId,
    testSearchQuery,
    selectedExecutionTestIds,
    executionModalCaseIds,
    activeExecutionCaseIds,
    selectedTest,
    showExecSelector,
    selectedExecutionEnvironmentId,
    selectedExecutionDatasetId,
    setExecutionDatasetPreview,
    setExecutionDatasetPreviewLoading,
    fetchWithAuth,
    casosList,
    selectSuiteTarget,
    setSelectedSuiteId,
    setSelectedSubSuiteId,
    setSelectedTest,
    setSelectedExecutionTestIds,
    setExecutionModalCaseIds,
    setShowExecSelector,
    setSelectedTestsForIa,
    setSchedulerSearch,
    setExecName,
    setScheduledTime,
    setShowIaScheduler,
    showFeedback
  })

  const {
    loadExecutionDetails,
    handleStartExecution,
    returnToExecutionList,
    handleSelectTestForExecution,
    persistExecutionSnapshots,
    handleSnapshotStatusChange,
    handleSnapshotNoteChange,
    handleSnapshotNoteBlur,
    handleSnapshotAttachmentUpload,
    handleRemoveSnapshotAttachment,
    handleGeneralExecutionAttachmentUpload,
    handleRemoveGeneralExecutionAttachment,
    getSnapshotStatus,
    getSnapshotReferences,
    getExecutionReferenceCount,
    getExecutionCompletionPlan,
    advanceToNextTest,
    deferRedmineReportAndContinue,
    openRedmineReportFromPrompt,
    handleCompleteCase,
    handlePushToRedmine
  } = createEjecucionActionBundle({
    managingProjectId,
    currentProjectId,
    currentBuildId,
    currentCompId,
    selectedExecutionEnvironmentId,
    selectedExecutionDatasetId,
    buildsList,
    buildCaseIds,
    currentProjectCases,
    selectedTest,
    activeExecutionTests,
    currentExecutionRun,
    currentExecutionCase,
    activeBuildCaseIds,
    componentsList,
    executionSnapshots,
    stepResults,
    snapshotNotes,
    snapshotAttachments,
    attachmentConfig,
    generalExecutionStatus,
    generalExecutionNote,
    generalExecutionSnapshot,
    generalExecutionAttachments,
    redmineDecisionByExecution,
    viewMode,
    executionModalTests,
    executionModalDiscardedCount,
    canUseAutomatedExecution: canAccessCapability('ejecutar.automatizada', 'edit') && canAccessCapability('automatizacion.workers', 'read'),
    fetchWithAuth,
    mapBackendCasoToTest,
    isOutdatedExecutionCase,
    getExecutionCaseLabel,
    loadBuildCaseExecutionStatus,
    setCasosList,
    setBuildCaseResultHistoryByBuild,
    setBuildCaseIds,
    setCurrentExecutionCase,
    setExecutionSnapshots,
    setSnapshotAttachments,
    setGeneralExecutionSnapshot,
    setGeneralExecutionAttachments,
    setStepResults,
    setSnapshotNotes,
    setGeneralExecutionStatus,
    setGeneralExecutionNote,
    setExecutionLoading,
    setCurrentExecutionRun,
    setExecutionMode,
    setSelectedTest,
    setActiveExecutionCaseIds,
    setExecutionModalCaseIds,
    setShowExecSelector,
    setViewMode,
    setIaQueue,
    setIaExecutionStreams,
    setIaLogs,
    setActiveTab,
    setAutomationMonitor,
    automationDebugMode,
    aiEngineConfig,
    setProjectSyncMessage,
    loadCasoExecutionHistory,
    loadCasosFromBackend,
    loadBuildCases,
    setRedmineDecisionByExecution,
    setShowRedminePrompt,
    setShowRedmineDrawer,
    setRedmineBugs,
    showFeedback
  })

  const refreshCurrentBuildExecutionStatus = useCallback(async () => {
    if (!currentBuildId || !isValidUUID(currentBuildId)) return
    const ids = buildCaseIds[currentBuildId]?.length ? buildCaseIds[currentBuildId] : activeBuildCaseIds
    await loadBuildCaseExecutionStatus(currentBuildId, ids)
  }, [activeBuildCaseIds, buildCaseIds, currentBuildId, loadBuildCaseExecutionStatus])

  const { handleRunSavedAutomatedCaseFromEditor, handleRunAiDryRunFromEditor } = createExecutionDryRunActions({
    currentProjectId, fetchWithAuth, setAutomationMonitor, setIaLogs, showFeedback, stringifyFeedbackMessage,
  })

  const isFailureStatus = (status?: string) => ['FALLO', 'FALLIDO', 'BLOQUEADO'].includes(String(status || '').toUpperCase())

  const isExecutionHistoryItemFromCurrentBuild = (item: any) => {
    if (!currentBuildId) return false
    const itemBuildId = item?.buildId || item?.build_id || null
    return Boolean(itemBuildId) && String(itemBuildId) === String(currentBuildId)
  }

  const getLatestFailureExecutionContext = (test: any, options: { currentBuildOnly?: boolean } = {}) => {
    const history = normalizeExecutionHistory(test)
    const latest = history[0]
    const latestFailure = latest && isFailureStatus(latest.status) ? latest : null
    const scopedFailure = latestFailure && (!options.currentBuildOnly || isExecutionHistoryItemFromCurrentBuild(latestFailure))
      ? latestFailure
      : null
    return {
      executionId: scopedFailure?.executionId || scopedFailure?.execution_id || scopedFailure?.id || null,
      snapshotId: scopedFailure?.snapshotId || scopedFailure?.snapshot_id || null,
      note: scopedFailure?.observation || null,
      historyItem: scopedFailure || null,
    }
  }

  const buildInternalBugPayload = ({
    test = selectedTest,
    snapshot = null,
    note = null,
  }: {
    test?: any
    snapshot?: any
    note?: string | null
  } = {}) => {
    const historyContext = getLatestFailureExecutionContext(test)
    const historyItem = historyContext.historyItem || {}
    const activeBuild = buildsList.find(build => build.id === currentBuildId)
    const activeProject = projectsList.find(project => project.id === currentProjectId)
    const activeComponent = componentsList.find(component => component.id === currentCompId)
    const activeEnvironment = currentProjectEnvironments.find(env => env.id === selectedExecutionEnvironmentId)
    const buildName = historyItem.buildName || historyItem.buildCode || activeBuild?.name || 'N/A'
    const componentName = historyItem.componentName || activeComponent?.name || test?.suite || test?.component || null
    const environmentName = historyItem.environmentName || activeEnvironment?.name || null
    const environmentUrl = activeEnvironment?.url || activeEnvironment?.baseUrl || null
    const datasetName = historyItem.datasetName || executionDatasetPreview?.name || executionDatasetPreview?.nombre || executionDatasetPreview?.dataset_name || null
    const datasetVariables = executionDatasetPreview?.variables_resueltas || executionDatasetPreview?.variables || executionDatasetPreview?.values || {}
    const hasActiveContext = Boolean(selectedTest?.id && test?.id === selectedTest.id)
    const fullDescription = hasActiveContext ? generateBugDescription() : (note || test?.description || '')
    const snapshotStatus = snapshot ? (hasActiveContext ? stepResults[snapshot.numero_paso] : null) || snapshot.estado_paso || 'FALLO' : (hasActiveContext ? generalExecutionStatus : 'FALLO')
    const snapshotNote = snapshot
      ? ((hasActiveContext ? snapshotNotes[snapshot.numero_paso] : '') || snapshot.comentarios || snapshot.error_log || note || '')
      : (note || (hasActiveContext ? generalExecutionNote : '') || '')
    const failureSummary = snapshot
      ? `Fallo detectado en el paso ${snapshot.numero_paso}: ${snapshot.accion_congelada || 'accion de validacion'}.`
      : `Fallo detectado durante la ejecucion del caso ${test?.code || test?.codigo || test?.title || 'seleccionado'}.`
    const resultObtained = snapshot
      ? [
          `Paso ${snapshot.numero_paso} marcado como ${snapshotStatus}.`,
          snapshotNote ? `Observacion: ${snapshotNote}` : null,
          snapshot.error_log ? `Error/log: ${snapshot.error_log}` : null,
        ].filter(Boolean).join('\n')
      : [
          `Ejecucion marcada como ${generalExecutionStatus || 'FALLO'}.`,
          snapshotNote ? `Observacion: ${snapshotNote}` : null,
        ].filter(Boolean).join('\n')
    const activeSnapshots = hasActiveContext ? executionSnapshots : []
    const executedSteps = activeSnapshots.map((item: any) => {
      const status = stepResults[item.numero_paso] || item.estado_paso || 'SIN_CORRER'
      const itemNote = snapshotNotes[item.numero_paso] || item.comentarios || item.error_log || ''
      return {
        numero_paso: item.numero_paso,
        accion: item.accion_congelada || 'Ejecutar paso congelado',
        datos: item.datos_resueltos || item.datos_congelados || null,
        esperado: item.resultado_esperado_congelado || null,
        veredicto: status,
        observacion: itemNote || null,
      }
    })
    const reproductionSteps = activeSnapshots.length > 0
      ? activeSnapshots.map((item: any) => {
          const status = stepResults[item.numero_paso] || item.estado_paso || 'SIN_CORRER'
          const itemNote = snapshotNotes[item.numero_paso] || item.comentarios || item.error_log || ''
          return [
            `${item.numero_paso}. ${item.accion_congelada || 'Ejecutar paso congelado'} -> ${status}`,
            item.datos_resueltos || item.datos_congelados ? `   Datos: ${item.datos_resueltos || item.datos_congelados}` : null,
            item.resultado_esperado_congelado ? `   Esperado: ${item.resultado_esperado_congelado}` : null,
            itemNote ? `   Observacion: ${itemNote}` : null,
          ].filter(Boolean).join('\n')
        }).join('\n')
      : [
          `1. Ejecutar caso ${test?.code || test?.codigo || test?.title || 'seleccionado'} en build ${buildName}.`,
          historyItem.environmentName ? `2. Usar ambiente ${historyItem.environmentName}${historyItem.datasetName ? ` con dataset ${historyItem.datasetName}` : ''}.` : null,
          `3. Registrar veredicto general ${snapshotStatus || 'FALLO'}.`,
          `4. Validar observacion: ${snapshotNote || 'sin observacion adicional'}.`,
        ].filter(Boolean).join('\n')

    return {
      titulo: `${test?.code || test?.codigo || 'Caso'} - ${test?.title || test?.titulo || 'Fallo QA'}: ${snapshot ? `paso ${snapshot.numero_paso} ` : ''}${String(snapshotStatus || 'FALLO').toLowerCase()}`,
      descripcion: snapshotNote || failureSummary,
      resultado_esperado: snapshot?.resultado_esperado_congelado || test?.expected || test?.post || 'El caso debe cumplir el resultado esperado definido sin fallos ni bloqueos.',
      resultado_obtenido: resultObtained || 'Fallo observado durante la ejecucion guardada.',
      pasos_reproduccion: reproductionSteps,
      precondiciones: test?.pre || test?.preconditions || null,
      datos_prueba: snapshot?.datos_resueltos || snapshot?.datos_congelados || historyItem.testData || test?.data || null,
      logs_relevantes: snapshot?.error_log || null,
      error_tecnico: snapshot?.error_log || null,
      notas_qa: snapshotNote || null,
      version_app: buildName,
      modulo_funcional: componentName,
      ambiente_nombre: environmentName,
      ambiente_url: environmentUrl,
      severidad: snapshotStatus === 'BLOQUEADO' ? 'ALTA' : 'MEDIA',
      prioridad: test?.priority === 'CRITICA' || test?.priority === 'ALTA' ? 'P1' : 'P2',
      criticidad: test?.criticality || (snapshotStatus === 'BLOQUEADO' ? 'ALTA' : 'MEDIA'),
      metadata_json: {
        project_id: currentProjectId || null,
        project_name: (activeProject as any)?.name || (activeProject as any)?.nombre || null,
        build_name: buildName,
        build_code: (activeBuild as any)?.code || (activeBuild as any)?.codigo || historyItem.buildCode || null,
        component_name: componentName,
        component_code: (activeComponent as any)?.code || (activeComponent as any)?.codigo || null,
        environment_name: environmentName,
        environment_url: environmentUrl,
        dataset_name: datasetName,
        dataset_variables: datasetVariables,
        case_version: test?.version || historyItem.caseVersion || null,
        snapshot_action: snapshot?.accion_congelada || null,
        snapshot_status: snapshotStatus,
        executed_steps: executedSteps,
      },
    }
  }

  const createInternalBugForExecution = async ({
    test = selectedTest,
    executionId,
    snapshotId,
    note,
    snapshot,
    openTracker = true,
    payloadOverride,
    evidenceAttachments = [],
  }: {
    test?: any
    executionId?: string | null
    snapshotId?: string | null
    note?: string | null
    snapshot?: any
    openTracker?: boolean
    payloadOverride?: Record<string, any> | null
    evidenceAttachments?: AttachmentMeta[]
  } = {}) => {
    if (!currentProjectId || !test) {
      showFeedback('Bug interno', 'No hay caso o proyecto seleccionado para crear el bug.', 'warning')
      return null
    }
    const historyContext = getLatestFailureExecutionContext(test)
    const shouldUseActiveExecution = Boolean(selectedTest?.id && test?.id === selectedTest.id)
    const targetExecutionId = executionId || (shouldUseActiveExecution ? currentExecutionCase?.id : null) || historyContext.executionId
    const targetSnapshotId = snapshotId || historyContext.snapshotId
    if (!targetExecutionId && !targetSnapshotId) {
      showFeedback('Bug interno', 'No encuentro una ejecucion fallida guardada para registrar el bug.', 'warning')
      return null
    }
    const contextId = targetSnapshotId || targetExecutionId || test.id
    setCreatingInternalBugContextId(contextId)
    try {
      const lookupParams = new URLSearchParams({ limit: '20' })
      if (targetSnapshotId) lookupParams.set('snapshot_id', targetSnapshotId)
      else if (targetExecutionId) lookupParams.set('ejecucion_id', targetExecutionId)
      const existingResponse = await fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/bugs/?${lookupParams.toString()}`)
      if (existingResponse.ok) {
        const existingPayload = await existingResponse.json()
        const existingBug = Array.isArray(existingPayload?.items)
          ? existingPayload.items.find((item: any) => isOpenBugState(item?.estado))
          : null
        if (existingBug) {
          if (test?.id && selectedTest?.id && String(test.id) === String(selectedTest.id)) {
            setRelatedCaseBugs((prev) => enrichBugsDisplayContext([
              existingBug,
              ...prev.filter((item: any) => item?.id !== existingBug.id),
            ]))
          }
          setShowRedminePrompt(false)
          setShowRedmineDrawer(false)
          setInternalBugDraft(null)
          setInternalBugEvidence([])
          if (targetExecutionId) setRedmineDecisionByExecution(prev => ({ ...prev, [targetExecutionId]: 'reported' }))
          if (openTracker) setActiveTab('bugs')
          showFeedback('Bug interno existente', `${existingBug.codigo} ya tiene seguimiento para esta ejecucion.`, 'info')
          return existingBug
        }
      }
      const endpoint = targetSnapshotId
        ? `${API_BASE}/snapshots/${targetSnapshotId}/bugs/`
        : `${API_BASE}/ejecuciones/${targetExecutionId}/bugs/`
      const bugNote = note || historyContext.note || generateBugDescription()
      const bugPayload = buildInternalBugPayload({ test, snapshot, note: bugNote })
      const mergedMetadata = {
        ...(bugPayload.metadata_json || {}),
        ...((payloadOverride?.metadata_json || {}) as Record<string, any>),
      }
      const response = await fetchWithAuth(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...bugPayload,
          ...(payloadOverride || {}),
          metadata_json: mergedMetadata,
          resultado_obtenido: payloadOverride?.resultado_obtenido || bugPayload.resultado_obtenido || bugNote || 'Fallo observado durante la ejecucion guardada.',
          notas_qa: payloadOverride && Object.prototype.hasOwnProperty.call(payloadOverride, 'notas_qa')
            ? (payloadOverride.notas_qa || null)
            : (bugPayload.notas_qa || bugNote || null),
        })
      })
      if (!response.ok) throw new Error(await readBackendError(response, `Backend respondio ${response.status}`))
      const bug = await response.json()
      for (const attachment of uniqueAttachmentList(evidenceAttachments)) {
        if (!attachment?.id) continue
        await fetchWithAuth(`${API_BASE}/bugs/${bug.id}/attachments/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attachment_id: attachment.id, tipo: 'BUG_EVIDENCE' }),
        })
      }
      setShowRedminePrompt(false)
      setShowRedmineDrawer(false)
      setInternalBugDraft(null)
      setInternalBugEvidence([])
      if (targetExecutionId) setRedmineDecisionByExecution(prev => ({ ...prev, [targetExecutionId]: 'reported' }))
      if (test?.id && selectedTest?.id && String(test.id) === String(selectedTest.id)) {
        setRelatedCaseBugs((prev) => enrichBugsDisplayContext([
          bug,
          ...prev.filter((item: any) => item?.id !== bug.id),
        ]))
      }
      setBugTrackerRefreshToken((value) => value + 1)
      if (openTracker) setActiveTab('bugs')
      showFeedback('Bug interno creado', `${bug.codigo} quedo asociado a la ejecucion fallida.`, 'success')
      return bug
    } catch (error: any) {
      showFeedback('Bug interno', error?.message || 'No se pudo crear el bug.', 'danger')
      return null
    } finally {
      setCreatingInternalBugContextId(null)
    }
  }

  const findOpenBugForExecutionContext = async ({
    executionId,
    snapshotId,
  }: {
    executionId?: string | null
    snapshotId?: string | null
  }) => {
    if (!currentProjectId || (!executionId && !snapshotId)) return null
    const lookupParams = new URLSearchParams({ limit: '20' })
    if (snapshotId) lookupParams.set('snapshot_id', snapshotId)
    else if (executionId) lookupParams.set('ejecucion_id', executionId)
    const response = await fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/bugs/?${lookupParams.toString()}`)
    if (!response.ok) return null
    const payload = await response.json()
    return Array.isArray(payload?.items)
      ? payload.items.find((item: any) => isOpenBugState(item?.estado)) || null
      : null
  }

  const loadOpenBugsForCase = async (caseId?: string | null) => {
    if (!currentProjectId || !caseId) return []
    const response = await fetchWithAuth(`${API_BASE}/casos/${caseId}/bugs/relacionados/?include_closed=false`)
    if (!response.ok) return []
    const payload = await response.json()
    return Array.isArray(payload)
      ? payload.filter((item: any) => isOpenBugState(item?.estado))
      : []
  }

  const uniqueAttachmentList = (attachments: AttachmentMeta[] = []) => {
    const seen = new Set<string>()
    return attachments.filter((attachment) => {
      const id = String(attachment?.id || '')
      if (!id || seen.has(id)) return false
      seen.add(id)
      return true
    })
  }

  const attachmentIds = (attachments: AttachmentMeta[] = []) =>
    uniqueAttachmentList(attachments).map(item => String(item.id))

  const getActiveExecutionBugEvidence = (snapshotId?: string | null) => {
    const snapshotEvidence = snapshotId ? uniqueAttachmentList(snapshotAttachments[snapshotId] || []) : []
    if (snapshotEvidence.length > 0) {
      return {
        attachments: snapshotEvidence,
        backendLinkedAttachmentIds: attachmentIds(snapshotEvidence),
      }
    }
    const generalEvidence = uniqueAttachmentList(generalExecutionAttachments)
    return {
      attachments: generalEvidence,
      backendLinkedAttachmentIds: [],
    }
  }

  const loadSnapshotBugEvidence = async (snapshotId?: string | null) => {
    if (!snapshotId) return { attachments: [] as AttachmentMeta[], backendLinkedAttachmentIds: [] as string[] }
    const response = await fetchWithAuth(`${API_BASE}/snapshots/${snapshotId}/attachments/`)
    if (!response.ok) return { attachments: [] as AttachmentMeta[], backendLinkedAttachmentIds: [] as string[] }
    const payload = await response.json().catch(() => [])
    const attachments = uniqueAttachmentList(
      (Array.isArray(payload) ? payload : [])
        .map((item: any) => item?.attachment || item)
        .filter(Boolean)
    )
    return {
      attachments,
      backendLinkedAttachmentIds: attachmentIds(attachments),
    }
  }

  const linkExecutionToExistingBug = async (bug: any, comentario?: string) => {
    if (!bug?.id || !currentExecutionCase?.id) {
      showFeedback('Actualizar seguimiento', 'No hay bug o ejecución activa para actualizar.', 'warning')
      return null
    }
    const completionPlan = getExecutionCompletionPlan()
    const conclusiveSnapshot = completionPlan?.firstConclusive?.snapshot || generalExecutionSnapshot || null
    const snapshotId = conclusiveSnapshot?.id || null
    const evidenceAttachments = snapshotId
      ? (snapshotAttachments[snapshotId] || [])
      : generalExecutionAttachments
    const attachmentIds = evidenceAttachments.map(item => item?.id).filter(Boolean)
    setCreatingInternalBugContextId(snapshotId || currentExecutionCase.id)
    try {
      const response = await fetchWithAuth(`${API_BASE}/bugs/${bug.id}/link-execution/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ejecucion_id: currentExecutionCase.id,
          snapshot_id: snapshotId,
          attachment_ids: attachmentIds,
          comentario: comentario?.trim() || null,
        }),
      })
      if (!response.ok) throw new Error(await readBackendError(response, `Backend respondio ${response.status}`))
      const updatedBug = await response.json()
      setShowRedminePrompt(false)
      setShowRedmineDrawer(false)
      setInternalBugDraft(null)
      setInternalBugEvidence([])
      setInternalBugAdditionalContext([])
      setRedmineDecisionByExecution(prev => ({ ...prev, [currentExecutionCase.id]: 'reported' }))
      setBugTrackerRefreshToken((value) => value + 1)
      const enrichedBug = enrichBugDisplayContext(updatedBug)
      setRelatedCaseBugs(prev => prev.map(item => item.id === updatedBug.id ? enrichedBug : item))
      showFeedback('Bug actualizado', `${updatedBug.codigo || bug.codigo} actualizado con esta build.`, 'success')
      try {
        await advanceToNextTest()
      } catch (advanceError: any) {
        showFeedback(
          'Bug actualizado',
          advanceError?.message || 'El bug se actualizó, pero no se pudo cerrar automáticamente esta ejecución.',
          'warning'
        )
      }
      return enrichedBug
    } catch (error: any) {
      showFeedback('Actualizar seguimiento', error?.message || 'No se pudo registrar el seguimiento del bug.', 'danger')
      return null
    } finally {
      setCreatingInternalBugContextId(null)
    }
  }

  const enrichBugDisplayContext = useCallback((bug: any) => {
    const build = buildsList.find(item => String(item.id) === String(bug?.build_id || ''))
    const component = componentsList.find(item => String(item.id) === String(bug?.componente_id || ''))
    const metadata = bug?.metadata_json || {}
    return {
      ...bug,
      _display_build_name: bug?.version_app || metadata.build_name || build?.name || (build as any)?.nombre || bug?.build_code || metadata.build_code || 'Build origen no registrada',
      _display_component_name: bug?.modulo_funcional || metadata.component_name || component?.name || (component as any)?.nombre || 'Componente no registrado',
    }
  }, [buildsList, componentsList])

  const enrichBugsDisplayContext = useCallback((bugs: any[]) => bugs.map(enrichBugDisplayContext), [enrichBugDisplayContext])

  const closeRelatedBugDecision = useCallback((result: 'create' | 'cancel' = 'cancel') => {
    relatedBugDecisionResolverRef.current?.(result)
    relatedBugDecisionResolverRef.current = null
    setRelatedBugDecision((prev: any) => ({ ...prev, show: false, viewingBug: null, linkingBugId: null }))
  }, [])

  const requestRelatedBugDecision = useCallback((bugs: any[], canLink: boolean) => new Promise<'create' | 'cancel'>((resolve) => {
    relatedBugDecisionResolverRef.current = resolve
    setRelatedBugDecision({
      show: true,
      bugs,
      viewingBug: null,
      linkingBugId: null,
      canLink,
    })
  }), [])

  const viewRelatedBugFromDecision = useCallback((bug: any) => {
    setRelatedBugDecision((prev: any) => ({ ...prev, viewingBug: bug }))
  }, [])

  const backToRelatedBugDecisionList = useCallback(() => {
    setRelatedBugDecision((prev: any) => ({ ...prev, viewingBug: null }))
  }, [])

  const linkBugFromDecision = useCallback(async (bug: any) => {
    setRelatedBugDecision((prev: any) => ({ ...prev, linkingBugId: bug?.id || null }))
    const updated = await linkExecutionToExistingBug(
      bug,
      'El defecto sigue ocurriendo en esta build. Se registra como seguimiento del mismo bug.'
    )
    if (updated) {
      closeRelatedBugDecision('cancel')
      return
    }
    setRelatedBugDecision((prev: any) => ({ ...prev, linkingBugId: null }))
  }, [closeRelatedBugDecision, linkExecutionToExistingBug])

  const confirmNewBugWhenCaseHasOpenBugs = async (test: any, currentContextBug?: any) => {
    const openCaseBugs = enrichBugsDisplayContext(
      (await loadOpenBugsForCase(test?.id)).filter((bug: any) => bug?.id !== currentContextBug?.id)
    )
    if (openCaseBugs.length === 0) return true
    const completionPlan = getExecutionCompletionPlan()
    const status = completionPlan?.finalStatus || currentExecutionCase?.estado_resultado || generalExecutionStatus
    const canLink = Boolean(currentExecutionCase?.id && (status === 'FALLO' || status === 'BLOQUEADO'))
    const decision = await requestRelatedBugDecision(openCaseBugs, canLink)
    return decision === 'create'
  }

  const handleCreateInternalBugFromExecution = async () => {
    const completionPlan = getExecutionCompletionPlan()
    const conclusiveSnapshot = completionPlan?.firstConclusive?.snapshot
    const conclusiveNote = conclusiveSnapshot
      ? snapshotNotes[conclusiveSnapshot.numero_paso] || conclusiveSnapshot.comentarios || conclusiveSnapshot.error_log || null
      : generalExecutionNote || currentExecutionCase?.observaciones || null
    const existingBug = await findOpenBugForExecutionContext({
      executionId: currentExecutionCase?.id || null,
      snapshotId: conclusiveSnapshot?.id || generalExecutionSnapshot?.id || null,
    })
    if (existingBug) {
      setShowRedminePrompt(false)
      setShowRedmineDrawer(false)
      showFeedback('Bug interno existente', `${existingBug.codigo} ya reporta esta ejecucion.`, 'info')
      return
    }
    const confirmed = await confirmNewBugWhenCaseHasOpenBugs(selectedTest, existingBug)
    if (!confirmed) return
    await createInternalBugForExecution({
      test: selectedTest,
      executionId: currentExecutionCase?.id || null,
      snapshotId: conclusiveSnapshot?.id || generalExecutionSnapshot?.id || null,
      snapshot: conclusiveSnapshot || generalExecutionSnapshot || null,
      note: conclusiveNote,
      openTracker: false,
    })
  }

  const openInternalBugReportFromPrompt = async () => {
    if (!selectedTest) {
      showFeedback('Bug interno', 'No hay caso seleccionado para preparar el bug.', 'warning')
      return
    }
    const completionPlan = getExecutionCompletionPlan()
    const conclusiveSnapshot = completionPlan?.firstConclusive?.snapshot || generalExecutionSnapshot || null
    const conclusiveNote = conclusiveSnapshot
      ? snapshotNotes[conclusiveSnapshot.numero_paso] || conclusiveSnapshot.comentarios || conclusiveSnapshot.error_log || null
      : generalExecutionNote || currentExecutionCase?.observaciones || null
    const existingBug = await findOpenBugForExecutionContext({
      executionId: currentExecutionCase?.id || null,
      snapshotId: conclusiveSnapshot?.id || generalExecutionSnapshot?.id || null,
    })
    if (existingBug) {
      setShowRedminePrompt(false)
      setShowRedmineDrawer(false)
      showFeedback('Bug interno existente', `${existingBug.codigo} ya reporta esta ejecucion.`, 'info')
      return
    }
    const confirmed = await confirmNewBugWhenCaseHasOpenBugs(selectedTest, existingBug)
    if (!confirmed) return
    const draft = buildInternalBugPayload({ test: selectedTest, snapshot: conclusiveSnapshot, note: conclusiveNote })
    const preloadedEvidence = getActiveExecutionBugEvidence(conclusiveSnapshot?.id || null)
    setInternalBugDraft({
      ...draft,
      caso_id: selectedTest.id || null,
      case_code: selectedTest.code || selectedTest.codigo || null,
      ejecucion_id: currentExecutionCase?.id || null,
      snapshot_id: conclusiveSnapshot?.id || null,
      notas_qa: '',
      _context: {
        executionId: currentExecutionCase?.id || null,
        snapshotId: conclusiveSnapshot?.id || null,
        snapshot: conclusiveSnapshot,
        note: conclusiveNote,
        preloadedAttachmentIds: attachmentIds(preloadedEvidence.attachments),
        backendLinkedAttachmentIds: preloadedEvidence.backendLinkedAttachmentIds,
      },
    })
    setInternalBugAdditionalContext([])
    setInternalBugEvidence(preloadedEvidence.attachments)
    setShowRedminePrompt(false)
    setShowRedmineDrawer(true)
  }

  const openInternalBugReportFromCase = async (test: any) => {
    if (!test) {
      showFeedback('Bug interno', 'No hay caso seleccionado para preparar el bug.', 'warning')
      return null
    }
    let context = getLatestFailureExecutionContext(test, { currentBuildOnly: true })
    let hydratedTest = test
    if (!context.executionId && test.id) {
      const history = await loadCasoExecutionHistory(test.id, currentBuildId)
      const latest = history[0]
      const latestFailure = latest && isFailureStatus(latest.status) && isExecutionHistoryItemFromCurrentBuild(latest) ? latest : null
      context = {
        executionId: latestFailure?.executionId || latestFailure?.execution_id || latestFailure?.id || null,
        snapshotId: latestFailure?.snapshotId || latestFailure?.snapshot_id || null,
        note: latestFailure?.observation || null,
        historyItem: latestFailure || null,
      }
      hydratedTest = { ...test, history }
    }
    if (!context.executionId && !context.snapshotId) {
      showFeedback('Bug interno', 'Primero ejecuta esta prueba en la build actual y guarda un resultado fallido o bloqueado.', 'warning')
      return null
    }
    const existingBug = await findOpenBugForExecutionContext({
      executionId: context.executionId,
      snapshotId: context.snapshotId,
    })
    if (existingBug) {
      showFeedback('Bug interno existente', `${existingBug.codigo} ya reporta esta ejecucion.`, 'info')
      return existingBug
    }
    const confirmed = await confirmNewBugWhenCaseHasOpenBugs(hydratedTest, existingBug)
    if (!confirmed) return null
    const draft = buildInternalBugPayload({ test: hydratedTest, note: context.note })
    const preloadedEvidence = await loadSnapshotBugEvidence(context.snapshotId || null)
    setInternalBugDraft({
      ...draft,
      caso_id: hydratedTest.id || null,
      case_code: hydratedTest.code || hydratedTest.codigo || null,
      ejecucion_id: context.executionId || null,
      snapshot_id: context.snapshotId || null,
      notas_qa: '',
      _context: {
        fromCaseHistory: true,
        test: hydratedTest,
        executionId: context.executionId || null,
        snapshotId: context.snapshotId || null,
        snapshot: null,
        note: context.note || null,
        preloadedAttachmentIds: attachmentIds(preloadedEvidence.attachments),
        backendLinkedAttachmentIds: preloadedEvidence.backendLinkedAttachmentIds,
      },
    })
    setInternalBugAdditionalContext([])
    setInternalBugEvidence(preloadedEvidence.attachments)
    setShowRedminePrompt(false)
    setShowRedmineDrawer(true)
    return null
  }

  const handleInternalBugDraftChange = (field: string, value: any) => {
    setInternalBugDraft(prev => prev ? { ...prev, [field]: value } : prev)
  }

  const openManualInternalBugDrawer = () => {
    if (!currentProjectId) {
      showFeedback('Bug interno', 'Selecciona un proyecto para crear un bug.', 'warning')
      return
    }
    const activeProject = projectsList.find(project => project.id === currentProjectId)
    const activeBuild = buildsList.find(build => build.id === currentBuildId)
    const activeComponent = componentsList.find(component => component.id === currentCompId)
    const activeEnvironment = currentProjectEnvironments.find(env => env.id === selectedExecutionEnvironmentId)
    setInternalBugDraft({
      titulo: '',
      descripcion: '',
      resultado_esperado: '',
      resultado_obtenido: '',
      pasos_reproduccion: '',
      notas_qa: '',
      severidad: 'MEDIA',
      prioridad: 'P2',
      criticidad: 'MEDIA',
      reproducibilidad: 'no_reproducido',
      asignado_a: null,
      componente_id: currentCompId || null,
      build_id: currentBuildId || null,
      version_app: (activeBuild as any)?.name || (activeBuild as any)?.nombre || null,
      modulo_funcional: (activeComponent as any)?.name || (activeComponent as any)?.nombre || null,
      ambiente_nombre: (activeEnvironment as any)?.name || null,
      ambiente_url: (activeEnvironment as any)?.url || (activeEnvironment as any)?.baseUrl || null,
      metadata_json: {
        project_id: currentProjectId,
        project_name: (activeProject as any)?.name || (activeProject as any)?.nombre || null,
        build_name: (activeBuild as any)?.name || (activeBuild as any)?.nombre || null,
        build_code: (activeBuild as any)?.code || (activeBuild as any)?.codigo || null,
        component_name: (activeComponent as any)?.name || (activeComponent as any)?.nombre || null,
        component_code: (activeComponent as any)?.code || (activeComponent as any)?.codigo || null,
        environment_name: (activeEnvironment as any)?.name || null,
        environment_url: (activeEnvironment as any)?.url || (activeEnvironment as any)?.baseUrl || null,
        manual_bug: true,
        executed_steps: [],
      },
      _context: {
        manual: true,
      },
    })
    setInternalBugAdditionalContext([])
    setInternalBugEvidence([])
    setShowRedminePrompt(false)
    setShowRedmineDrawer(true)
  }

  const createManualInternalBug = async (editablePayload: Record<string, any>, additionalContext: { key: string; value: string }[]) => {
    if (!currentProjectId) {
      showFeedback('Bug interno', 'No hay proyecto seleccionado para crear el bug.', 'warning')
      return null
    }
    setCreatingInternalBugContextId('manual-bug')
    try {
      const response = await fetchWithAuth(`${API_BASE}/bugs/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editablePayload,
          proyecto_id: currentProjectId,
          componente_id: editablePayload.componente_id || currentCompId || null,
          build_id: editablePayload.build_id || currentBuildId || null,
          caso_id: editablePayload.caso_id || null,
          asignado_a: editablePayload.asignado_a || null,
          origen: 'manual',
          metadata_json: {
            ...(editablePayload.metadata_json || {}),
            additional_context: additionalContext,
          },
        }),
      })
      if (!response.ok) throw new Error(await readBackendError(response, `Backend respondio ${response.status}`))
      const bug = await response.json()
      for (const attachment of uniqueAttachmentList(internalBugEvidence)) {
        if (!attachment?.id) continue
        await fetchWithAuth(`${API_BASE}/bugs/${bug.id}/attachments/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attachment_id: attachment.id, tipo: 'BUG_EVIDENCE' }),
        })
      }
      setShowRedmineDrawer(false)
      setInternalBugDraft(null)
      setInternalBugEvidence([])
      setInternalBugAdditionalContext([])
      setBugTrackerRefreshToken((value) => value + 1)
      setActiveTab('bugs')
      showFeedback('Bug interno creado', `${bug.codigo} quedo registrado en el Bug Tracker.`, 'success')
      return bug
    } catch (error: any) {
      showFeedback('Bug interno', error?.message || 'No se pudo crear el bug.', 'danger')
      return null
    } finally {
      setCreatingInternalBugContextId(null)
    }
  }

  const handleSubmitInternalBugReport = async (event: FormEvent) => {
    event.preventDefault()
    if (!internalBugDraft) {
      showFeedback('Bug interno', 'No hay datos preparados para crear el bug.', 'warning')
      return
    }
    const context = internalBugDraft._context || {}
    const { _context, ...editablePayload } = internalBugDraft
    const additionalContext = internalBugAdditionalContext
      .map(row => ({ key: row.key.trim(), value: row.value.trim() }))
      .filter(row => row.key || row.value)
    if (context.manual) {
      await createManualInternalBug(editablePayload, additionalContext)
      return
    }
    const backendLinkedAttachmentIds = new Set<string>((context.backendLinkedAttachmentIds || []).map((id: any) => String(id)))
    const selectedAttachmentIds = new Set<string>(internalBugEvidence.map(item => String(item?.id || '')).filter(Boolean))
    const removedBackendLinkedAttachmentIds = Array.from(backendLinkedAttachmentIds).filter(id => !selectedAttachmentIds.has(id))
    const extraEvidenceAttachments = uniqueAttachmentList(internalBugEvidence)
      .filter(attachment => !backendLinkedAttachmentIds.has(String(attachment.id)))
    const createdBug = await createInternalBugForExecution({
      test: context.test || selectedTest,
      executionId: context.executionId || currentExecutionCase?.id || null,
      snapshotId: context.snapshotId || null,
      snapshot: context.snapshot || null,
      note: context.note || editablePayload.notas_qa || null,
      payloadOverride: {
        ...editablePayload,
        asignado_a: editablePayload.asignado_a || null,
        metadata_json: {
          ...(editablePayload.metadata_json || {}),
          additional_context: additionalContext,
        },
      },
      evidenceAttachments: extraEvidenceAttachments,
      openTracker: false,
    })
    if (createdBug?.id && removedBackendLinkedAttachmentIds.length > 0) {
      try {
        await Promise.all(removedBackendLinkedAttachmentIds.map(async (attachmentId) => {
          const response = await fetchWithAuth(`${API_BASE}/bugs/${createdBug.id}/attachments/${attachmentId}/`, { method: 'DELETE' })
          if (!response.ok && response.status !== 404) {
            throw new Error(await readBackendError(response, `No se pudo quitar la evidencia ${attachmentId}`))
          }
        }))
      } catch (error: any) {
        showFeedback('Evidencias del bug', error?.message || 'El bug fue creado, pero no se pudo quitar una evidencia removida del formulario.', 'warning')
      }
    }
    if (createdBug && !context.fromCaseHistory && !context.manual && currentExecutionCase?.id) {
      await advanceToNextTest()
    }
  }

  const handleCreateInternalBugFromCaseHistory = async (test: any) => {
    return openInternalBugReportFromCase(test)
  }

  const renderCaseReferences = (title: string, references: AttachmentMeta[] = []) => (
    <CaseReferenceList title={title} references={references} onZoomImage={setZoomImage} />
  )

  const generateBugDescription = () => buildBugDescription({
    selectedTest,
    buildName: buildsList.find(build => build.id === currentBuildId)?.name || 'N/A',
    executionSnapshots,
    stepResults,
    snapshotNotes,
    generalExecutionStatus,
    generalExecutionNote
  })

  const {
    addStepInput,
    removeStepInput,
    duplicateStepInput,
    moveStepInput,
    handleStepInputChange,
    updateStepAttachments,
    openCreateCaseInSuite,
    openEditCase,
    handleSaveTest
  } = createCaseEditorActions({
    newTestSteps,
    newTestTitle,
    newTestSuite,
    newTestSuiteSub,
    newTestComponent,
    newTestDescription,
    newTestPre,
    newTestPost,
    newTestData,
    newTestTags,
    newTestPriority,
    newTestCriticality,
    newTestStatus,
    newTestType,
    newTestScript,
    newTestFramework,
    newTestLanguage,
    caseEditorSaving,
    editingCasoMasterId,
    selectedTest,
    projectsSource,
    currentProjectId,
    currentCompId,
    componentsList,
    casosList,
    currentCaseEditorSnapshot,
    fetchWithAuth,
    handleCreateCaso,
    handleUpdateCaso,
    selectSuiteTarget,
    setExpandedSuites,
    setNewTestSteps,
    setNewTestTitle,
    setNewTestDescription,
    setNewTestPre,
    setNewTestPost,
    setNewTestData,
    setNewTestTags,
    setNewTestPriority,
    setNewTestCriticality,
    setNewTestStatus,
    setNewTestType,
    setNewTestComponent,
    setNewTestScript,
    setNewTestFramework,
    setNewTestLanguage,
    setCaseEditorOpen,
    setEditingCasoMasterId,
    setSelectedTest,
    setCaseEditorBaseline,
    setAddTestSuccess,
    setProjectSyncMessage,
    setCurrentCompId,
    setActiveTab,
    setCaseEditorSaving,
    setCasosList,
    showFeedback
  })

  const {
    projectActions,
    componentActions,
    buildActions,
    environmentActions,
    projectMemberActions,
    wikiActions
  } = createProyectosActions({
    canEditCurrentProject,
    projectsSource,
    currentOrgId,
    currentProjectId,
    managingProjectId,
    organizations,
    projectsList,
    fetchWithAuth,
    setProjectsLoading,
    setProjectsList,
    setCurrentProjectId,
    setCurrentOrgId,
    setSelectedOrganizationId,
    setCurrentCompId,
    setCurrentBuildId,
    setProjectsSource,
    setProjectSyncMessage,
    showFeedback,
    componentForm,
    componentsList,
    setComponentsList,
    setNewTestComponent,
    setShowComponentModal,
    setComponentForm,
    currentCompId,
    currentBuildId,
    buildsList,
    setBuildsList,
    setBuildCaseIds,
    environments,
    setEnvironments,
    projectMemberForm,
    projectMemberRemoval,
    assignableUsers,
    projectMembers,
    setProjectMemberForm,
    setShowProjectMemberModal,
    setProjectMembers,
    setProjectMemberRemoval,
    selectedWiki,
    wikiFormData,
    wikiPages,
    setWikiPages,
    setSelectedWiki,
    setWikiMode,
    confirmAction
  })
  const {
    handleLaunchIaMission
  } = createIaMissionActions({
    projectsSource,
    currentProjectId,
    currentBuildId,
    buildsList,
    currentProjectCases,
    selectedTestsForIa,
    execName,
    scheduledTime,
    aiMaxParallelRuns: Number(aiEngineConfig.max_parallel_ai_runs || 1),
    fetchWithAuth,
    setProjectSyncMessage,
    setIaQueue,
    setIaExecutionStreams,
    setIaLogs,
    setShowIaScheduler,
    setActiveTab,
    showFeedback,
    navigateToMotorIaOnLaunch: !iaSchedulerOpenedFromBuilder,
    onAfterLaunch: () => setIaSchedulerOpenedFromBuilder(false)
  })

  const loadOpenBugsByCase = useCallback(async (options?: { silent?: boolean }) => {
    if (!isAuthenticated || !currentProjectId || !isValidUUID(currentProjectId) || !canAccessCapability('bugs.ver', 'read')) {
      setOpenBugsByCase({})
      setOpenBugsLoading(false)
      return
    }
    const silent = Boolean(options?.silent)
    if (!silent) setOpenBugsLoading(true)
    try {
      let skip = 0
      const limit = 200
      let total = 0
      const bugs: any[] = []
      do {
        const params = new URLSearchParams({ skip: String(skip), limit: String(limit) })
        const response = await fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/bugs/?${params.toString()}`)
        if (!response.ok) throw new Error(`Backend respondio ${response.status}`)
        const payload = await response.json()
        const items = Array.isArray(payload?.items) ? payload.items : []
        total = Number(payload?.total ?? items.length)
        bugs.push(...items)
        skip += items.length
        if (items.length === 0) break
      } while (skip < total)
      const grouped = bugs
        .filter((bug: any) => bug?.caso_id && isOpenBugState(bug.estado))
        .reduce((acc: Record<string, any[]>, bug: any) => {
          const caseId = String(bug.caso_id)
          acc[caseId] = [...(acc[caseId] || []), enrichBugDisplayContext(bug)]
          return acc
        }, {})
      const executionCases = activeTab === 'ejecutar'
        ? filteredTests.filter((test: any) => test?.id && isValidUUID(test.id))
        : []
      if (executionCases.length > 0) {
        const relatedEntries = await Promise.all(executionCases.map(async (test: any) => {
          const response = await fetchWithAuth(`${API_BASE}/casos/${test.id}/bugs/relacionados/?include_closed=false`)
          if (!response.ok) return [test.id, grouped[test.id] || []] as const
          const payload = await response.json()
          const related = Array.isArray(payload)
            ? payload.filter((bug: any) => isOpenBugState(bug?.estado)).map(enrichBugDisplayContext)
            : []
          return [test.id, related] as const
        }))
        for (const [caseId, related] of relatedEntries) {
          grouped[caseId] = related
        }
      }
      setOpenBugsByCase(grouped)
    } catch {
      setOpenBugsByCase({})
    } finally {
      if (!silent) setOpenBugsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, currentProjectId, bugTrackerRefreshToken, loggedUser, hasSystemFeature])

  useEffect(() => {
    void loadOpenBugsByCase()
  }, [activeTab, loadOpenBugsByCase])

  const loadRelatedBugsForSelectedCase = useCallback(async (caseId = selectedTest?.id, options?: { silent?: boolean }) => {
    if (!isAuthenticated || !currentProjectId || !caseId || !isValidUUID(caseId) || !canAccessCapability('bugs.ver', 'read')) {
      setRelatedCaseBugs([])
      setRelatedCaseBugsLoading(false)
      return []
    }
    const silent = Boolean(options?.silent)
    if (!silent) setRelatedCaseBugsLoading(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/casos/${caseId}/bugs/relacionados/?include_closed=true`)
      if (!response.ok) throw new Error(`Backend respondio ${response.status}`)
      const bugs = await response.json()
      const items = Array.isArray(bugs) ? enrichBugsDisplayContext(bugs) : []
      setRelatedCaseBugs(items)
      return items
    } catch {
      setRelatedCaseBugs([])
      return []
    } finally {
      if (!silent) setRelatedCaseBugsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, currentProjectId, selectedTest?.id, bugTrackerRefreshToken, loggedUser, hasSystemFeature])

  useEffect(() => {
    if (activeTab === 'ejecutar' && viewMode === 'manual_exec' && selectedTest?.id) {
      const caseId = String(selectedTest.id)
      const isSameCase = lastRelatedCaseIdRef.current === caseId
      lastRelatedCaseIdRef.current = caseId
      void loadRelatedBugsForSelectedCase(selectedTest.id, { silent: isSameCase })
      return
    }
    lastRelatedCaseIdRef.current = null
    setRelatedCaseBugs([])
  }, [activeTab, viewMode, selectedTest?.id, loadRelatedBugsForSelectedCase])

  const refreshExecutionLiveData = useCallback(async () => {
    if (currentBuildId && isValidUUID(currentBuildId)) {
      const ids = await loadBuildCases(currentBuildId, { silent: true })
      await loadBuildCaseExecutionStatus(currentBuildId, ids.length ? ids : (buildCaseIds[currentBuildId] || activeBuildCaseIds), { silent: true })
    }
    await loadOpenBugsByCase({ silent: true })
    if (selectedTest?.id) await loadRelatedBugsForSelectedCase(selectedTest.id, { silent: true })
  }, [activeBuildCaseIds, buildCaseIds, currentBuildId, loadBuildCaseExecutionStatus, loadBuildCases, loadOpenBugsByCase, loadRelatedBugsForSelectedCase, selectedTest?.id])

  const refreshProjectBuildLiveData = useCallback(async () => {
    await refreshCurrentTestContext(currentCompId, { silent: true })
    if (currentBuildId && isValidUUID(currentBuildId)) {
      const ids = await loadBuildCases(currentBuildId, { silent: true })
      await loadBuildCaseExecutionStatus(currentBuildId, ids.length ? ids : (buildCaseIds[currentBuildId] || []), { silent: true })
    }
    await loadOpenBugsByCase({ silent: true })
  }, [buildCaseIds, currentBuildId, currentCompId, loadBuildCaseExecutionStatus, loadBuildCases, loadOpenBugsByCase, refreshCurrentTestContext])

  const refreshReportesLiveData = useCallback(async () => {
    await loadProjectMetrics(undefined, { silent: true })
  }, [loadProjectMetrics])

  const handleRealtimeEvent = useCallback((event: RealtimeEvent) => {
    const eventType = event.event_type || ''
    const affectsCurrentBuild = !event.build_id || !currentBuildId || event.build_id === currentBuildId
    const refreshAuthoringData = () => {
      if (hasUnsavedCaseChanges) {
        setProjectSyncMessage('Hay cambios nuevos disponibles. Actualiza la vista cuando termines de editar.')
        return
      }
      void refreshCurrentTestContext(currentCompId)
    }

    if (eventType.startsWith('execution.') || eventType.startsWith('ia.') || eventType.startsWith('automation.') || eventType.startsWith('worker.')) {
      if (activeTab === 'ejecutar' && affectsCurrentBuild) void refreshExecutionLiveData()
      if (activeTab === 'historial' || activeTab === 'motor_ia') void loadProjectRunHistory(historialInitialFilters)
      if (activeTab === 'reportes') void refreshReportesLiveData()
      return
    }

    if (eventType.startsWith('bug.')) {
      setBugTrackerRefreshToken((value) => value + 1)
      if (activeTab === 'ejecutar' && affectsCurrentBuild) void loadOpenBugsByCase({ silent: true })
      if (activeTab === 'reportes') void refreshReportesLiveData()
      if (activeTab === 'proyectos') void refreshProjectBuildLiveData()
      return
    }

    if (eventType.startsWith('build.') || eventType.startsWith('component.') || eventType.startsWith('project.')) {
      if (activeTab === 'ejecutar' && affectsCurrentBuild) void refreshExecutionLiveData()
      if (activeTab === 'proyectos') void refreshProjectBuildLiveData()
      if (activeTab === 'reportes') void refreshReportesLiveData()
      if (activeTab === 'crear_pruebas') refreshAuthoringData()
      return
    }

    if (eventType.startsWith('case.') || eventType.startsWith('suite.')) {
      if (activeTab === 'crear_pruebas') refreshAuthoringData()
      if (activeTab === 'ejecutar' && affectsCurrentBuild) void refreshExecutionLiveData()
      if (activeTab === 'proyectos') void refreshProjectBuildLiveData()
      if (activeTab === 'reportes') void refreshReportesLiveData()
      return
    }

    if (eventType.startsWith('environment.') || eventType.startsWith('dataset.')) {
      if (currentProjectId && isValidUUID(currentProjectId)) void environmentActions.loadEnvironmentsForProject(currentProjectId)
      if (activeTab === 'ejecutar' && affectsCurrentBuild) void refreshExecutionLiveData()
      if (activeTab === 'historial') void loadProjectRunHistory(historialInitialFilters)
      if (activeTab === 'reportes') void refreshReportesLiveData()
      return
    }

    if (eventType.startsWith('report.')) {
      if (activeTab === 'reportes') void refreshReportesLiveData()
    }
  }, [
    activeTab,
    currentBuildId,
    currentCompId,
    currentProjectId,
    environmentActions,
    hasUnsavedCaseChanges,
    historialInitialFilters,
    loadOpenBugsByCase,
    loadProjectRunHistory,
    refreshCurrentTestContext,
    refreshExecutionLiveData,
    refreshProjectBuildLiveData,
    refreshReportesLiveData,
    setProjectSyncMessage,
  ])

  const realtimeEnabled = isAuthenticated && projectsSource === 'backend' && !!currentProjectId && isValidUUID(currentProjectId)
  const { status: realtimeStatus } = useProjectRealtime({
    enabled: realtimeEnabled,
    projectId: currentProjectId,
    onEvent: handleRealtimeEvent,
  })
  const livePollingFallbackActive = !realtimeEnabled || realtimeStatus !== 'connected'

  const hasActiveRunHistory = useMemo(() => runHistory.some((run: any) => {
    const status = String(run.status || run.estado_run || '').toUpperCase()
    return ['PENDING', 'EN_CURSO', 'RUNNING', 'EN_EJECUCION', 'IN_PROGRESS'].includes(status)
  }), [runHistory])

  useLiveRefresh({
    enabled: isAuthenticated && livePollingFallbackActive && activeTab === 'ejecutar',
    intervalMs: 12000,
    refreshOnFocus: true,
    onRefresh: refreshExecutionLiveData,
  })

  useLiveRefresh({
    enabled: isAuthenticated && livePollingFallbackActive && activeTab === 'bugs',
    intervalMs: 30000,
    refreshOnFocus: true,
    onRefresh: () => setBugTrackerRefreshToken((value) => value + 1),
  })

  useLiveRefresh({
    enabled: isAuthenticated && livePollingFallbackActive && activeTab === 'reportes',
    intervalMs: 0,
    refreshOnFocus: false,
    onRefresh: refreshReportesLiveData,
  })

  useLiveRefresh({
    enabled: isAuthenticated && livePollingFallbackActive && activeTab === 'historial',
    intervalMs: hasActiveRunHistory ? 15000 : 0,
    refreshOnFocus: true,
    onRefresh: () => loadProjectRunHistory(historialInitialFilters),
  })

  useLiveRefresh({
    enabled: isAuthenticated && livePollingFallbackActive && activeTab === 'proyectos' && projectInnerTab === 'components',
    intervalMs: 30000,
    refreshOnFocus: true,
    onRefresh: refreshProjectBuildLiveData,
  })

  const {
    handleModuleNavigation
  } = createNavigationActions({
    canAccessModule,
    loadProjectMetrics,
    loadProjectRunHistory,
    setActiveTab,
    setViewMode,
    setCaseEditorOpen,
    setEditingCasoMasterId,
    setSelectedTest
  })


  const openIaSchedulerFromWorkflowBuilder = useWorkflowSchedulerLauncher({
    currentProjectCases,
    belongsToCurrentComponent,
    showFeedback,
    setIaSchedulerOpenedFromBuilder,
    setSelectedTestsForIa,
    setSchedulerSearch,
    setExecName,
    setScheduledTime,
    setShowIaScheduler,
  })

  const {
    handleLogin,
    handleLogout
  } = createAuthActions({
    authMode,
    loginForm,
    adConfig,
    loginWithPassword,
    loginWithAdPassword,
    fetchWithAuth,
    authHeaders,
    persistSession,
    setLoginError,
    setLoginLoading,
    setOrganizations,
    setProjectsList,
    setCurrentOrgId,
    setCurrentProjectId,
    setCurrentCompId,
    setCurrentBuildId,
    setActiveTab,
    setIsAuthenticated
  })

  useEffect(() => {
    if (isAuthenticated) return
    let cancelled = false
    fetch(`${API_BASE}/auth/ad/config/public/`)
      .then(response => response.ok ? response.json() : null)
      .then(payload => {
        if (!cancelled && payload) {
          setAdConfig((current: any) => ({ ...current, ...payload }))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, setAdConfig])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const exchangeCode = params.get('ad_exchange_code')
    if (!exchangeCode || isAuthenticated) return
    setLoginLoading(true)
    fetch(`${API_BASE}/auth/ad/exchange/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: exchangeCode }),
    })
      .then(async response => {
        if (!response.ok) throw new Error(await response.text())
        return response.json()
      })
      .then(async tokenPayload => {
        localStorage.setItem('qa_access_token', tokenPayload.access_token)
        try {
          const payload = JSON.parse(atob(String(tokenPayload.access_token || '').split('.')[1] || ''))
          const exp = Number(payload.exp || 0)
          if (exp > 0) localStorage.setItem('qa_session_expires_at', new Date(exp * 1000).toISOString())
        } catch {
          localStorage.removeItem('qa_session_expires_at')
        }
        const userResponse = await fetch(`${API_BASE}/users/me/`, {
          headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
        })
        if (!userResponse.ok) throw new Error('No se pudo sincronizar el usuario AD.')
        persistSession(mapBackendUserToSession(await userResponse.json()))
        window.history.replaceState({}, document.title, window.location.pathname)
        setActiveTab('dashboard')
      })
      .catch(() => {
        setLoginError('No se pudo completar el login con Active Directory.')
      })
      .finally(() => setLoginLoading(false))
  }, [isAuthenticated, persistSession])

  useEffect(() => {
    if (!isAuthenticated) {
      workspacePreferencesHydratedRef.current = ''
      setWorkspacePreferencesHydrated(false)
      return
    }

    const userKey = loggedUser.id || loggedUser.email
    if (workspacePreferencesHydratedRef.current === userKey) {
      if (!workspacePreferencesHydrated) setWorkspacePreferencesHydrated(true)
      return
    }

    const preferences = readWorkspacePreferences(loggedUser)
    const urlTab = tabFromCurrentUri()
    const preferredTab = urlTab || preferences.activeTab
    const preferredAllowed = preferredTab && canAccessModule(preferredTab as ModuleId)
    const fallbackAllowed = allSidebarItems.find(item => canAccessModule(item.id))?.id || ''

    if (preferredAllowed) {
      setActiveTab(preferredTab)
    } else if (fallbackAllowed) {
      setActiveTab(fallbackAllowed)
    }
    if (preferences.currentOrgId) {
      setCurrentOrgId(preferences.currentOrgId)
      setSelectedOrganizationId(preferences.currentOrgId)
    }
    if (preferences.currentProjectId) setCurrentProjectId(preferences.currentProjectId)
    if (preferences.currentCompId) {
      setCurrentCompId(preferences.currentCompId)
      setNewTestComponent(preferences.currentCompId)
    }
    if (preferences.currentBuildId) setCurrentBuildId(preferences.currentBuildId)

    workspacePreferencesHydratedRef.current = userKey
    setWorkspacePreferencesHydrated(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, loggedUser.id, loggedUser.email])

  useEffect(() => {
    const urlBugId = new URLSearchParams(window.location.search).get('bug_id') || ''
    const targetBugId = urlBugId || deepLinkBugId
    if (!targetBugId) return
    if (targetBugId !== deepLinkBugId) setDeepLinkBugId(targetBugId)
    if (!isAuthenticated || !workspacePreferencesHydrated) return
    if (!canAccessCapability('bugs.ver', 'read')) {
      if (deepLinkPermissionNoticeRef.current !== targetBugId) {
        deepLinkPermissionNoticeRef.current = targetBugId
        showFeedback('Sin permiso', 'No tienes permiso para ver el detalle de bugs.', 'warning')
      }
      consumeDeepLinkBug()
      return
    }
    setActiveTab('bugs')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, workspacePreferencesHydrated, deepLinkBugId, loggedUser.id, loggedUser.email])

  useEffect(() => {
    if (!isAuthenticated || !workspacePreferencesHydrated) return
    if (internalReportToken) return
    if (!canAccessModule(activeTab as ModuleId)) return

    const uri = uriForTab(activeTab)
    saveWorkspacePreferences(loggedUser, {
      activeTab,
      uri,
      currentOrgId,
      currentProjectId,
      currentCompId,
      currentBuildId
    })

    if (window.location.pathname + window.location.search + window.location.hash !== uri) {
      window.history.replaceState(null, '', uri)
    }
  }, [isAuthenticated, workspacePreferencesHydrated, loggedUser, activeTab, currentOrgId, currentProjectId, currentCompId, currentBuildId])

  const {
    loadInitialBackendData
  } = createInitialLoadActions({
    organizations,
    loadOrganizationsFromBackend,
    loadProjectsFromBackend: projectActions.loadProjectsFromBackend
  })

  useEffect(() => {
    if (!isAuthenticated) return
    syncSessionFromBackend()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated])

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'qa_session_active' && e.newValue !== 'true') {
        setIsAuthenticated(false)
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [setIsAuthenticated])

  useLiveRefresh({
    enabled: isAuthenticated && projectsSource === 'backend',
    intervalMs: 30000,
    refreshOnFocus: true,
    onRefresh: syncSessionFromBackend,
  })

  useEffect(() => {
    if (!isAuthenticated || !workspacePreferencesHydrated) {
      initialBackendLoadKeyRef.current = ''
      organizationMembersLoadKeyRef.current = ''
      return
    }
    const key = `${loggedUser.id || loggedUser.email}`
    if (initialBackendLoadKeyRef.current === key) return
    initialBackendLoadKeyRef.current = key
    loadInitialBackendData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, workspacePreferencesHydrated, loggedUser.id, loggedUser.email])

  useEffect(() => {
    if (!isAuthenticated || projectsSource !== 'backend' || projectsLoading || projectsList.length === 0) return
    const currentProject = projectsList.find(project => project.id === currentProjectId)
    if (currentProject) return
    const orgProject = projectsList.find(project => project.orgId === currentOrgId)
    const fallbackProject = orgProject || projectsList[0]
    if (!fallbackProject) return
    setCurrentProjectId(fallbackProject.id)
    setCurrentOrgId(fallbackProject.orgId)
    setSelectedOrganizationId(fallbackProject.orgId)
    setCurrentCompId('')
    setCurrentBuildId('')
    void hydrateProjectContext(fallbackProject.id, '', { silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, projectsSource, projectsLoading, projectsList, currentProjectId, currentOrgId])

  const isAdminSession = loggedUser.role === 'ADMIN'
  const hasOrganizationAccess = organizations.length > 0
  const sidebarItems = allSidebarItems.filter(item => canAccessModule(item.id) && canAccessEntitledModule(item.id))
  const firstAllowedModuleId = sidebarItems[0]?.id || ''
  const canRenderActiveModule = Boolean(activeTab && canAccessModule(activeTab as ModuleId) && canAccessEntitledModule(activeTab as ModuleId))
  const showWorkspaceAccessGate = isAuthenticated && projectsSource === 'backend' && workspacePreferencesHydrated && !projectsLoading && sidebarItems.length === 0

  useEffect(() => {
    if (!isAuthenticated || !workspacePreferencesHydrated) return
    if (!firstAllowedModuleId) return
    if (activeTab && canAccessModule(activeTab as ModuleId) && canAccessEntitledModule(activeTab as ModuleId)) return
    setActiveTab(firstAllowedModuleId)
    setViewMode('list')
    if (activeTab === 'crear_pruebas') {
      setCaseEditorOpen(false)
      setEditingCasoMasterId(null)
      setSelectedTest(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, workspacePreferencesHydrated, activeTab, firstAllowedModuleId, loggedUser, canAccessEntitledModule])

  if (!isAuthenticated) {
    return (
      <LoginPage
        authMode={authMode}
        setAuthMode={setAuthMode}
        showAdLogin={Boolean(adConfig?.enabled)}
        adMode={adConfig?.mode || 'oidc'}
        loginForm={loginForm}
        setLoginForm={setLoginForm}
        loginError={loginError}
        loginLoading={loginLoading}
        handleLogin={handleLogin}
        branding={branding}
      />
    )
  }

  if (internalReportToken) {
    return (
      <div className="vh-100 d-flex flex-column bg-light">
        <div className="d-flex align-items-center justify-content-between gap-3 border-bottom bg-white px-3 py-2">
          <div className="min-w-0">
            <div className="fw-bold text-dark">Informe interno</div>
            <div className="small text-muted font-monospace text-truncate">{internalReportToken}</div>
          </div>
          <div className="d-flex align-items-center gap-2">
            {internalReportHtml && (
              <button type="button" className="btn btn-outline-primary btn-sm fw-bold" onClick={() => window.print()}>
                Imprimir
              </button>
            )}
            <button type="button" className="btn btn-outline-secondary btn-sm fw-bold" onClick={closeInternalReportViewer}>
              Volver a la app
            </button>
          </div>
        </div>
        {internalReportLoading && (
          <div className="flex-grow-1 d-flex align-items-center justify-content-center text-muted">
            Cargando informe interno...
          </div>
        )}
        {!internalReportLoading && internalReportError && (
          <div className="flex-grow-1 d-flex align-items-center justify-content-center p-4">
            <div className="alert alert-danger shadow-sm mb-0" role="alert">
              <div className="fw-bold mb-1">No se pudo abrir el informe interno</div>
              <div className="small">{internalReportError}</div>
            </div>
          </div>
        )}
        {!internalReportLoading && !internalReportError && internalReportHtml && (
          <iframe
            title="Informe interno"
            srcDoc={internalReportHtml}
            className="border-0 flex-grow-1 w-100 bg-white"
            sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
          />
        )}
      </div>
    )
  }

  return (
    <>
    <AppShell
      sidebarCollapsed={sidebarCollapsed}
      setSidebarCollapsed={setSidebarCollapsed}
      sidebarItems={sidebarItems}
      activeTab={activeTab}
      onModuleNavigation={handleModuleNavigation}
      organizations={organizations}
      currentOrgId={currentOrgId}
      onOrgChange={handleOrgChange}
      loggedUser={loggedUser}
      onLogout={handleLogout}
      projectsList={projectsList}
      currentProjectId={currentProjectId}
      onProjectChange={handleProjectChange}
      componentsList={componentsList}
      currentCompId={currentCompId}
      onComponentChange={handleComponentChange}
      buildsList={buildsList}
      currentBuildId={currentBuildId}
      sortBuildsNewestFirst={sortBuildsNewestFirst}
      onBuildChange={(build) => {
        if (!build.active) {
          showFeedback('Build inactiva', 'Activa esta build desde Componentes y Builds antes de usarla en ejecuciones.', 'warning')
          return
        }
        setCurrentBuildId(build.id)
      }}
      canAccessConfig={canAccessModule('configuracion')}
      systemEdition={systemEdition}
      branding={branding}
    >
      {showWorkspaceAccessGate && <WorkspaceAccessEmptyState userName={loggedUser.name} hasOrganizationAccess={hasOrganizationAccess} />}

      {!showWorkspaceAccessGate && canRenderActiveModule && (
      <>
      {/* DASHBOARD */}
      <DashboardRoute
        {...{
          activeTab, currentProjectId, currentBuildId, currentCompId, projectVersion,
          loggedUser, fetchWithAuth, showFeedback, handleLoggedUserPreferencesUpdated, canAccessCapability,
        }}
      />

      {/* LISTADO EJECUCIÓN */}
      {activeTab === 'ejecutar' && viewMode === 'list' && (
        <EjecutarPruebasRoute
          {...{
            activeTab, viewMode, selectedTest, setZoomImage, openHistorialRuns, canAccessCapability,
            openExecutionRunDetail, closeExecutionRunDetail, executionRunDetail,
            executionRunDetailLoading, executionRunDetailError, suiteExplorerWidth,
            startSuiteExplorerResize, executionInitialLoading, executionRefreshing,
            executionSuiteTree, renderExecutionSuiteTree, currentBuildId, suitesTree,
            selectedSuiteId, testSearchQuery, setTestSearchQuery, setSelectedSubSuiteId,
            setSelectedExecutionTestIds, setSelectedTest, filteredTests, getExecutionStatusKey,
            selectedExecutionTests, openExecutionSelector, allVisibleExecutionTestsSelected,
            toggleVisibleExecutionSelection, handleSelectTestForExecution, selectedExecutionTestIds,
            toggleExecutionSelection, activeBuildResultsLoading, activeBuildResultsLoaded,
            isOutdatedExecutionCase, openSingleCaseExecutionSelector, getExecutionActionLabel,
            buildsList, showFeedback, onCreateInternalBugFromCase: handleCreateInternalBugFromCaseHistory,
            creatingInternalBugContextId, openBugsByCase, openBugsLoading, onOpenBugTracker: () => setActiveTab('bugs'),
          }}
        />
      )}


      {/* EJECUCIÓN MANUAL (Hito 11.2) */}
      {activeTab === 'ejecutar' && viewMode === 'manual_exec' && selectedTest && (
        <EjecutarPruebasRoute
          {...{
            activeTab, viewMode, selectedTest, setZoomImage, activeExecutionTests,
            currentExecutionRun, currentExecutionCase, executionSnapshots, snapshotNotes,
            snapshotAttachments, generalExecutionSnapshot, generalExecutionAttachments,
            generalExecutionStatus, setGeneralExecutionStatus, generalExecutionNote,
            setGeneralExecutionNote, attachmentConfig, returnToExecutionList,
            handleSelectTestForExecution, getExecutionReferenceCount,
            getSnapshotStatus, getSnapshotReferences, renderCaseReferences,
            handleSnapshotStatusChange, handleSnapshotNoteChange, handleSnapshotNoteBlur,
            handleSnapshotAttachmentUpload, handleRemoveSnapshotAttachment,
            handleGeneralExecutionAttachmentUpload, handleRemoveGeneralExecutionAttachment,
            getExecutionCompletionPlan, handleCompleteCase,
            fetchWithAuth, showFeedback, canAccessCapability, setActiveTab,
            relatedCaseBugs, relatedCaseBugsLoading, currentComponentName,
            onRefreshRelatedBugs: () => loadRelatedBugsForSelectedCase(selectedTest.id, { silent: true }),
            onLinkExecutionToBug: linkExecutionToExistingBug,
            onViewRelatedBug: openBugTrackerDetail,
            onCreateInternalBugFromExecution: openInternalBugReportFromPrompt,
            creatingInternalBugContextId,
          }}
        />
      )}

      {/* AÑADIR PRUEBAS */}
      {activeTab === 'crear_pruebas' && (
        <AnadirPruebasPage
          suiteExplorerWidth={suiteExplorerWidth}
          setSelectedSubSuiteId={setSelectedSubSuiteId}
          setTestSearchQuery={setTestSearchQuery}
          setCaseEditorOpen={setCaseEditorOpen}
          setEditingCasoMasterId={setEditingCasoMasterId}
          setSelectedTest={setSelectedTest}
          testSearchQuery={testSearchQuery}
          openCreateSuiteModal={openCreateSuiteModal}
          authoringInitialLoading={authoringInitialLoading}
          visibleSuiteTree={visibleAuthoringSuiteTree}
          authoringRefreshing={authoringRefreshing}
          renderAuthoringSuiteTree={renderAuthoringSuiteTree}
          startSuiteExplorerResize={startSuiteExplorerResize}
          loadCasosFromBackend={loadCasosFromBackend}
          handleCloneCaso={handleCloneCaso}
          handleMoveCaso={handleMoveCaso}
          handleCloneSuite={handleCloneSuite}
          setExpandedSuites={setExpandedSuites}
          authoringCases={visibleAuthoringCases}
          caseArchiveView={caseArchiveView}
          setCaseArchiveView={setCaseArchiveView}
          caseArchiveCounts={{
            active: currentAuthoringCases.length,
            archived: archivedAuthoringCases.length,
            all: allAuthoringCases.length
          }}
          caseEditorOpen={caseEditorOpen}
          editingCasoMasterId={editingCasoMasterId}
          handleSaveTest={handleSaveTest}
          collapsedSections={collapsedSections}
          setCollapsedSections={setCollapsedSections}
          newTestSuiteSub={newTestSuiteSub}
          newTestSuite={newTestSuite}
          selectSuiteTarget={selectSuiteTarget}
          suitesTree={suitesTree}
          getSuiteDepth={getSuiteDepth}
          newTestTitle={newTestTitle}
          setNewTestTitle={setNewTestTitle}
          newTestComponent={newTestComponent}
          setNewTestComponent={setNewTestComponent}
          componentsList={componentsList}
          currentProjectId={currentProjectId}
          newTestDescription={newTestDescription}
          setNewTestDescription={setNewTestDescription}
          newTestPriority={newTestPriority}
          setNewTestPriority={setNewTestPriority}
          newTestCriticality={newTestCriticality}
          setNewTestCriticality={setNewTestCriticality}
          newTestStatus={newTestStatus}
          setNewTestStatus={setNewTestStatus}
          newTestType={newTestType}
          setNewTestType={setNewTestType}
          newTestPre={newTestPre}
          setNewTestPre={setNewTestPre}
          newTestPost={newTestPost}
          setNewTestPost={setNewTestPost}
          newTestData={newTestData}
          setNewTestData={setNewTestData}
          newTestTags={newTestTags}
          setNewTestTags={setNewTestTags}
          showFeedback={showFeedback}
          newTestSteps={newTestSteps}
          addStepInput={addStepInput}
          handleStepInputChange={handleStepInputChange}
          attachmentConfig={attachmentConfig}
          updateStepAttachments={updateStepAttachments}
          removeStepInput={removeStepInput}
          duplicateStepInput={duplicateStepInput}
          moveStepInput={moveStepInput}
          newTestFramework={newTestFramework}
          setNewTestFramework={setNewTestFramework}
          newTestLanguage={newTestLanguage}
          setNewTestLanguage={setNewTestLanguage}
          confirmAction={confirmAction}
          newTestScript={newTestScript}
          setNewTestScript={setNewTestScript}
          scriptTestResult={scriptTestResult}
          setScriptTesting={setScriptTesting}
          setScriptTestResult={setScriptTestResult}
          fetchWithAuth={fetchWithAuth}
          scriptTesting={scriptTesting}
          onRunSavedAutomatedCase={handleRunSavedAutomatedCaseFromEditor}
          onRunAiDryRunFromEditor={handleRunAiDryRunFromEditor}
          canSaveCaseEditor={canSaveCaseEditor}
          caseEditorSaving={caseEditorSaving}
          hasUnsavedCaseChanges={hasUnsavedCaseChanges}
          environments={environments}
          setEnvironments={setEnvironments}
          setComponentsList={setComponentsList}
          canAccessCapability={canAccessCapability}
        />
      )}

      {/* PROYECTOS */}
      {activeTab === 'proyectos' && (
        <ProyectosRoute
          {...{
            managingProjectId, setManagingProjectId, projectInnerTab, setProjectInnerTab,
            canAccessModule, canAccessCapability, hasSystemFeature, setActiveTab, componentActions, buildActions, environmentActions,
            projectMemberActions, wikiActions, organizations, projectsList, currentOrgId,
            currentProjectId, componentsList, buildsList, canEditCurrentProject,
            fetchWithAuth, showFeedback,
          }}
          projectsState={{ projectsLoading, projectsSource, projectSyncMessage }}
          projectActions={{ ...projectActions, handleProjectChange }}
          handleProjectChange={handleProjectChange}
          componentState={{ setComponentForm, setShowComponentModal, componentSearchQuery, setComponentSearchQuery, currentCompId }}
          buildState={{ buildCaseIds }}
          sortBuildsNewestFirst={sortBuildsNewestFirst}
          openBuildCasesModal={openBuildCasesModal}
          environmentState={{ environments }}
          projectMemberState={{ projectMembers }}
          wikiState={{ wikiMode, setWikiMode, selectedWiki, setSelectedWiki, wikiFormData, setWikiFormData, wikiPages }}
        />
      )}

      {/* INVENTARIO */}
      {activeTab === 'inventario' && (
        <InventarioPage
          currentProjectId={currentProjectId}
          inventoryCategories={inventoryCategories}
          setInventoryCategories={setInventoryCategories}
          environments={environments}
          setEnvironments={setEnvironments}
          devices={devices}
          setDevices={setDevices}
          agents={agents}
          setAgents={setAgents}
          customInventoryItems={customInventoryItems}
          setCustomInventoryItems={setCustomInventoryItems}
          confirmAction={confirmAction}
          currentProjectInventoryCategories={currentProjectInventoryCategories}
          currentProjectEnvironments={currentProjectEnvironments}
          currentProjectDevices={currentProjectDevices}
          currentProjectCustomInventoryItems={currentProjectCustomInventoryItems}
          currentProjectAgents={currentProjectAgents}
          setInvModalConfig={setInvModalConfig}
          canAccessCapability={canAccessCapability}
          fetchWithAuth={fetchWithAuth}
        />
      )}

      {/* REPORTES Y METRICAS */}
      <ReportesRoute
        {...{
          activeTab, metricsLoading, projectMetrics, expandedMetricSuites,
          setExpandedMetricSuites, loadProjectMetrics, showFeedback, fetchWithAuth,
          currentProjectId, currentBuildId, openHistorialRuns, setZoomImage, canAccessCapability, hasSystemFeature,
          loggedUser, onPreferencesUpdated: handleLoggedUserPreferencesUpdated,
          onOpenBugTracker: () => setActiveTab('bugs'),
        }}
      />

      {/* BUG TRACKER */}
      {activeTab === 'bugs' && (
        <BugTrackerPage
          currentProjectId={currentProjectId}
          currentBuildId={currentBuildId}
          currentCompId={currentCompId}
          buildsList={buildsList}
          componentsList={componentsList}
          appUsers={appUsers}
          fetchWithAuth={fetchWithAuth}
          showFeedback={showFeedback}
          canAccessCapability={canAccessCapability}
          onOpenManualBugDrawer={openManualInternalBugDrawer}
          refreshToken={bugTrackerRefreshToken}
          onBugsChanged={() => setBugTrackerRefreshToken((value) => value + 1)}
          deepLinkBugId={deepLinkBugId}
          onDeepLinkConsumed={consumeDeepLinkBug}
        />
      )}

      {/* MOTOR IA */}
      {activeTab === 'motor_ia' && (
        <MotorIaPage
          iaStatus={iaStatus}
          iaLogs={iaLogs}
          setIaLogs={setIaLogs}
          currentProjectIaQueue={currentProjectIaQueue}
          iaExecutionStreams={iaExecutionStreams}
          setIaExecutionStreams={setIaExecutionStreams}
          setIaQueue={setIaQueue}
          currentProjectCases={currentProjectCases}
          fetchWithAuth={fetchWithAuth}
          showFeedback={showFeedback}
          setActiveTab={setActiveTab}
          setConfigTab={setConfigTab}
          canAccessCapability={canAccessCapability}
          hasSystemFeature={hasSystemFeature}
        />
      )}

      {/* INTEGRACION REDMINE */}
      {activeTab === 'redmine' && (
        <RedminePage
          currentProjectRedmineBugs={currentProjectRedmineBugs}
          currentProjectCases={currentProjectCases}
          redmineUrl={redmineUrl}
          fetchWithAuth={fetchWithAuth}
          showFeedback={showFeedback}
          canAccessCapability={canAccessCapability}
          hasSystemFeature={hasSystemFeature}
          setActiveTab={setActiveTab}
          setConfigTab={setConfigTab}
        />
      )}

      {/* HISTORIAL RUNS */}
      <HistorialRoute
        {...{
          activeTab, currentProjectRunHistory, getStatusColor, buildsList,
          componentsList, currentProjectEnvironments, appUsers, historialInitialFilters,
          pendingHistorialRunDetailId, setPendingHistorialRunDetailId, loadProjectRunHistory,
          loadTestRunDetail, markHistorialAiReviewed, setZoomImage,
          canAccessCapability, fetchWithAuth, showFeedback, setActiveTab,
        }}
      />

      {/* AUTOMATIZACION */}
      {activeTab === 'automatizacion' && (
        <AutomatizacionPage
          currentProjectId={currentProjectId}
          currentOrgId={currentOrgId}
          currentCompId={currentCompId}
          currentBuildId={currentBuildId}
          organizations={organizations}
          projectsList={projectsList}
          componentsList={componentsList}
          buildsList={buildsList}
          buildCaseIds={buildCaseIds}
          currentProjectCases={currentProjectCases}
          currentComponentCases={currentComponentCases}
          projectsSource={projectsSource}
          fetchWithAuth={fetchWithAuth}
          showFeedback={showFeedback}
          copyToClipboard={copyToClipboard}
          confirmAction={confirmAction}
          canAccessModule={canAccessModule}
          canAccessCapability={canAccessCapability}
          hasSystemFeature={hasSystemFeature}
        />
      )}

      {/* CONFIGURACION */}
      {activeTab === 'configuracion' && (
        <ConfiguracionRoute
          configTab={configTab}
          setConfigTab={setConfigTab}
          canAccessModule={canAccessModule}
          canAccessCapability={canAccessCapability}
          hasSystemFeature={hasSystemFeature}
          showFeedback={showFeedback}
          generalConfiguration={generalConfiguration}
          sessionConfiguration={sessionConfiguration}
          aiEngineConfiguration={aiEngineConfiguration}
          adminUserRolesConfiguration={adminUserRolesConfiguration}
          organizations={organizations}
          projectsList={projectsList}
          selectedOrganizationId={selectedOrganizationId}
          setSelectedOrganizationId={setSelectedOrganizationId}
          handleCreateOrganization={handleCreateOrganization}
          handleUpdateOrganization={handleUpdateOrganization}
          handleSetOrganizationActive={handleSetOrganizationActive}
          loadOrganizationsFromBackend={loadOrganizationsFromBackend}
          organizationMembers={organizationMembers}
          organizationMemberForm={organizationMemberForm}
          setOrganizationMemberForm={setOrganizationMemberForm}
          handleAssignOrganizationMember={handleAssignOrganizationMember}
          handleRemoveOrganizationMember={handleRemoveOrganizationMember}
          loggedUser={loggedUser}
          fetchWithAuth={fetchWithAuth}
          onLoggedUserUpdated={handleLoggedUserUpdated}
          onBrandingUpdated={(nextBranding) => setBranding(normalizeBrandingState(nextBranding))}
          setActiveTab={setActiveTab}
          onOpenIaScheduler={openIaSchedulerFromWorkflowBuilder}
        />
      )}
      </>
      )}
    </AppShell>

  <UpdateMaintenanceOverlay
    state={updateMaintenanceState}
    onRetry={() => window.location.reload()}
  />

  <CaseVersionsModal
    show={showVersionsModal}
    onHide={() => setShowVersionsModal(false)}
    versionsCase={versionsCase}
    caseVersions={caseVersions}
    selectedCompareVersionId={selectedCompareVersionId}
    setSelectedCompareVersionId={setSelectedCompareVersionId}
    getCasoVersionRows={getCasoVersionRows}
  />

  <AppModals
    {...{
      showBuildCasesModal, setShowBuildCasesModal, buildsList, editingBuildCasesId, currentAuthoringCases,
      lockedBuildCaseIds, buildCaseDraftIds, setBuildCaseDraftIds, suitesTree, buildCaseSearch,
      setBuildCaseSearch, saveBuildCases, assignPreviousFailedCases, feedbackModal, setFeedbackModal, confirmDialog, closeConfirmDialog,
      relatedBugDecision, closeRelatedBugDecision, viewRelatedBugFromDecision, backToRelatedBugDecisionList, linkBugFromDecision,
      showRoleModal, setShowRoleModal, editingRoleId, roleForm, setRoleForm,
      setRoleModulePermission, setRoleCapabilityPermission, handleSaveRole, showUserModal, setShowUserModal, editingUserId, userForm,
      setUserForm, customRoles, handleUserCustomRoleChange, handleUserRoleChange,
      handleSaveUser, showProjectMemberModal, setShowProjectMemberModal, projectMemberForm, setProjectMemberForm,
      projectMemberActions, projectsList,
      managingProjectId, assignableUsers, projectMemberRemoval, setProjectMemberRemoval, showExecSelector,
      closeExecutionSelector, executionModalTests, executionModalDiscardedCount, executionLoading,
      currentProjectEnvironments, selectedExecutionEnvironmentId, setSelectedExecutionEnvironmentId,
      selectedExecutionDatasetId, setSelectedExecutionDatasetId, executionDatasetPreview, executionDatasetPreviewLoading,
      getExecutionCaseLabel, isOutdatedExecutionCase,
      showFeedback, handleStartExecution, automationDebugMode, setAutomationDebugMode, openIaSchedulerFromExecutionSelector,
      automationMonitor, setAutomationMonitor, fetchWithAuth, setActiveTab, openHistorialRuns, currentBuildId, currentCompId, componentsList, showIaScheduler,
      refreshCurrentBuildExecutionStatus,
      setShowIaScheduler, setIaSchedulerOpenedFromBuilder, visibleSuiteTree,
      currentProjectCases, belongsToCurrentComponent, schedulerSearch, setSchedulerSearch,
      selectedTestsForIa, setSelectedTestsForIa, execName, setExecName, scheduledTime,
      setScheduledTime, iaProvider, handleLaunchIaMission, showRedminePrompt,
      setShowRedminePrompt, showRedmineDrawer, setShowRedmineDrawer,
      currentExecutionCase, selectedTest, currentProjectRedmineBugs,
      deferRedmineReportAndContinue, handlePushToRedmine,
      openRedmineReportFromPrompt: openInternalBugReportFromPrompt, handleSubmitInternalBugReport,
      internalBugDraft, setInternalBugDraft, handleInternalBugDraftChange, internalBugAdditionalContext, setInternalBugAdditionalContext,
      internalBugEvidence, setInternalBugEvidence, appUsers,
      openManualInternalBugDrawer,
      handleCreateInternalBugFromExecution, creatingInternalBugContextId, generateBugDescription, zoomImage,
      setZoomImage, invModalConfig, setInvModalConfig, currentProjectId, environments,
      setEnvironments, devices, setDevices, agents, setAgents, customInventoryItems,
      setCustomInventoryItems, showAddFolderModal, setShowAddFolderModal, folderConfig,
      setSuiteForm, handleCreateSuite, showSuiteModal, setShowSuiteModal,
      editingSuiteId, setEditingSuiteId, suiteForm, handleUpdateSuite, showMoveSuiteModal,
      setShowMoveSuiteModal, movingSuiteId, setMovingSuiteId, moveSuiteParentId,
      setMoveSuiteParentId, handleMoveSuite, showComponentModal, setShowComponentModal,
      componentForm, setComponentForm, componentActions,
    }}
    canStartManualExecution={canAccessCapability('ejecutar.manual', 'edit')}
    canUseAutomatedExecution={canAccessCapability('ejecutar.automatizada', 'edit') && canAccessCapability('automatizacion.workers', 'read')}
    canUseIaExecution={canAccessCapability('ejecutar.ia', 'edit') && hasSystemFeature('ai.basic_execution')}
    iaEnginePremiumLocked={!hasSystemFeature('ai.basic_execution')}
    canViewHistory={canAccessModule('historial', 'read')}
  />

  <FirstRunOnboarding
    loggedUser={loggedUser}
    fetchWithAuth={fetchWithAuth}
    onPreferencesUpdated={handleLoggedUserPreferencesUpdated}
    firstRunState={firstRunState}
    onFirstRunCompleted={setFirstRunState}
    systemEdition={systemEdition}
    disabled={!firstRunLoaded || needsForcedPasswordChange(loggedUser.profileSettings)}
  />

  <ForcePasswordChangeModal
    loggedUser={loggedUser}
    fetchWithAuth={fetchWithAuth}
    onPreferencesUpdated={handleLoggedUserPreferencesUpdated}
  />
    </>
  )
}
