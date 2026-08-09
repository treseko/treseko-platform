import { useEffect, useRef, useState } from 'react'
import { Badge } from 'react-bootstrap'
import {
  FileText,
  Info,
  History,
  Layers,
  Link,
  Server,
  Sliders,
  Ticket,
  Users
} from 'lucide-react'
import { firstUrlFromText } from '../../app/mappers'
import { API_BASE } from '../../app/constants'
import { featureEnabled } from '../premium/featureAccess'
import { formatDateTime, toDateTimeLocalInput } from '../../shared/utils/dateTime'
import { useI18n } from '../../i18n'
import { useProjectReportPresentation } from './useProjectReportPresentation'
import { useProjectBugIssues } from './useProjectBugIssues'
import { ProjectModals } from './ProjectModals'
import { ProjectConfigTab } from './ProjectConfigTab'
import { ProjectComponentsTab } from './ProjectComponentsTab'
import { ProjectEnvironmentsTab } from './ProjectEnvironmentsTab'
import { ProjectWikiTab } from './ProjectWikiTab'
import { ProjectTicketsTab } from './ProjectTicketsTab'
import { ProjectPortfolioGrid } from './ProjectPortfolioGrid'
import { ProjectAdminWorkspace } from './ProjectAdminWorkspace'
import { createProjectPageHelpers } from './projectPageHelpers'

type ProyectosPageProps = any

export function ProyectosPage(props: ProyectosPageProps) {
  const { t } = useI18n()
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
    traceabilityRefreshToken,
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
    setActiveTab,
    confirmAction,
    onCreateCaseFromStory,
    onOpenLinkedCase
  } = props
  const readOnlyBuild = Boolean(props.readOnlyBuild)
  const buildWriteEnabled = !readOnlyBuild
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
  const canReadTraceability = canUseCapability('proyectos.requisitos', 'read') || canUseCapability('proyectos.historias', 'read')
  const canEditTraceability = canUseCapability('proyectos.requisitos', 'edit') && canUseCapability('proyectos.historias', 'edit')
  const canReadProjectTickets = canUseCapability('redmine.vinculos', 'read') || canUseCapability('redmine.ver', 'read')
  const canEditProjectTickets = canUseCapability('redmine.reportar', 'edit') || canUseCapability('redmine.vinculos', 'edit')
  const reportSnapshotsEnabled = featureEnabled(hasSystemFeature, 'reports.snapshots', false)
  const canViewSharedReports = canUseCapability('reportes.compartir', 'read')
  const {
    reportCacheKey, calculateQaHealth, latestReportStatus, openProjectReportLink,
    goToReports, reportButtonLabel,
  } = useProjectReportPresentation({ t, fetchWithAuth, showFeedback, handleProjectChange, setActiveTab })
  const { bugIssues, bugsLoading, bugForm, setBugForm, loadProjectBugs, createBugIssue, updateBugIssue } = useProjectBugIssues({ managingProjectId, projectInnerTab, fetchWithAuth, showFeedback, t })
  const canEditProject = canEditCurrentProject && canEditProjectPortfolio && buildWriteEnabled
  const canEditProjectComponentsEffective = canEditProjectComponents && buildWriteEnabled
  const canEditProjectBuildsEffective = canEditProjectBuilds && buildWriteEnabled
  const canEditProjectTeamEffective = canEditProjectTeam && buildWriteEnabled
  const canEditProjectEnvironmentsEffective = canEditProjectEnvironments && buildWriteEnabled
  const canEditProjectDatasetsEffective = canEditProjectDatasets && buildWriteEnabled
  const canEditProjectWikiEffective = canEditProjectWiki && buildWriteEnabled
  const canEditProjectTicketsEffective = canEditProjectTickets && buildWriteEnabled
  const projectAdminTabs = [
    { id: 'config', label: canReadProjectTeam ? t('proyectos.tabConfigTeam') : t('proyectos.tabConfig'), icon: Sliders, visible: canEditProjectPortfolio || canReadProjectTeam },
    { id: 'components', label: t('proyectos.tabComponentsBuilds'), icon: Layers, visible: canReadProjectComponents || canReadProjectBuilds || canReadProjectBuildScope },
    { id: 'envs', label: t('proyectos.tabEnvironments'), icon: Server, visible: canReadProjectEnvironments || canReadProjectDatasets },
    { id: 'traceability', label: t('proyectos.tabRequirements'), icon: Link, visible: canReadTraceability },
    { id: 'wiki', label: t('proyectos.tabWiki'), icon: FileText, visible: canReadProjectWiki },
    { id: 'tickets', label: t('proyectos.tabTickets'), icon: Ticket, visible: canReadProjectTickets },
    { id: 'portability', label: t('proyectos.tabImportExport'), icon: History, visible: canUseCapability('plugins.provider.case_portability.importar_casos', 'read') },
  ].filter(tab => tab.visible)
  const projectEnvironments = environments.filter((env: any) => env.projectId === managingProjectId)
  const [showEnvironmentModal, setShowEnvironmentModal] = useState(false)
  const [editingEnvironment, setEditingEnvironment] = useState<any | null>(null)
  const [datasetFormEnvId, setDatasetFormEnvId] = useState<string | null>(null)
  const [datasetDrafts, setDatasetDrafts] = useState<Record<string, any>>({})
  const [savingDatasetId, setSavingDatasetId] = useState<string | null>(null)
  const [savedDatasetId, setSavedDatasetId] = useState<string | null>(null)
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
    if (!managingProjectId) return
    if (projectsLoading) return
    if (!projectsList.some((project: any) => project.id === managingProjectId)) {
      setManagingProjectId(null)
      setProjectInnerTab('config')
      return
    }
    if (projectAdminTabs.length === 0) {
      setManagingProjectId(null)
      return
    }
    if (!projectAdminTabs.some(tab => tab.id === projectInnerTab)) {
      setProjectInnerTab(projectAdminTabs[0].id)
    }
  }, [managingProjectId, projectInnerTab, projectsLoading, projectsList, setManagingProjectId, setProjectInnerTab, projectAdminTabs.map(tab => tab.id).join('|')])

  const {
    environmentVariablesText,
    buildWindowState,
    projectInitials,
    projectStatusVariant,
    projectStatusHelpItems,
    getDatasetDraft,
    isDatasetDraftDirty,
    updateDatasetDraft,
    handleDatasetSubmit,
    openEnvironmentModal,
    closeEnvironmentModal,
    submitEnvironmentModal,
  } = createProjectPageHelpers({
    t,
    datasetDrafts,
    savedDatasetId,
    setDatasetDrafts,
    setSavedDatasetId,
    savingDatasetId,
    setSavingDatasetId,
    handleUpdateEnvironmentDataset,
    editingEnvironment,
    setEditingEnvironment,
    setShowEnvironmentModal,
    handleEditProjectEnvironment,
    handleSaveProjectEnvironment,
  })
  return (
    <div className="projects-page p-4 animate__animated animate__fadeIn text-dark text-start bg-light h-100 overflow-hidden d-flex flex-column">

          {managingProjectId && readOnlyBuild && (
            <div className="alert alert-warning d-flex align-items-center gap-2 py-2 mb-3 flex-shrink-0" role="status">
              <Info size={18} />
              <span><strong>{t('common.readOnly')}:</strong> {t('proyectos.buildHistoricalReadOnly')}</span>
            </div>
          )}

          {/* VISTA 1: GRID DE PROYECTOS */}
          {!managingProjectId ? (
            <ProjectPortfolioGrid context={{
              t,
              activeOrganizations,
              canEditProjectPortfolio,
              canReadProjectComponents,
              canReadProjectBuilds,
              canReadProjectBuildScope,
              handleCreateProject,
              projectsLoading,
              projectsList,
              currentOrgId,
              organizations,
              currentProjectId,
              componentsList,
              sortBuildsNewestFirst,
              buildsList,
              buildWindowState,
              reportCacheKey,
              latestBuildReports,
              latestReportStatus,
              projectBuildMetrics,
              calculateQaHealth,
              environments,
              projectMembers,
              handleProjectChange,
              setManagingProjectId,
              setProjectInnerTab,
              reportSnapshotsEnabled,
              canViewSharedReports,
              formatDateTime,
              openProjectReportLink,
              goToReports,
              hasSystemFeature,
              projectAdminTabs,
              projectStatusVariant,
              projectInitials,
            }} />
          ) : (
            /* VISTA 2: ADMINISTRACIÓN DETALLADA DEL PROYECTO */
            <ProjectAdminWorkspace context={{
              t,
              setManagingProjectId,
              projectsList,
              managingProjectId,
              projectInitials,
              projectStatusVariant,
              projectAdminTabs,
              projectInnerTab,
              setProjectInnerTab,
              canEditProjectPortfolio,
              canReadProjectTeam,
              canEditProject,
              handleUpdateProject,
              setShowProjectStatusHelp,
              canEditProjectTeamEffective,
              handleAddProjectMember,
              projectMembers,
              handleRemoveProjectMember,
              fetchWithAuth,
              showFeedback,
              canUseCapability,
              canReadProjectComponents,
              canReadProjectBuilds,
              canReadProjectBuildScope,
              canEditProjectComponentsEffective,
              setComponentForm,
              handleDeleteComponent,
              setShowComponentModal,
              componentSearchQuery,
              setComponentSearchQuery,
              handleComponentChange,
              componentsList,
              currentCompId,
              buildsList,
              canEditProjectBuilds,
              canEditProjectBuildsEffective,
              handleCreateBuild,
              showBuildCreateOptions,
              setShowBuildCreateOptions,
              defaultBuildStartDate,
              sortBuildsNewestFirst,
              buildWindowState,
              expandedBuildDetails,
              setExpandedBuildDetails,
              latestBuildReports,
              reportCacheKey,
              latestReportStatus,
              firstUrlFromText,
              formatDateTime,
              reportSnapshotsEnabled,
              canViewSharedReports,
              openBuildCasesModal,
              buildCaseIds,
              openProjectReportLink,
              reportButtonLabel,
              goToReports,
              hasSystemFeature,
              handleToggleBuildHidden,
              handleSetInactiveBuild,
              handleSetActiveBuild,
              handleDeleteBuild,
              handleUpdateBuildContext,
              toDateTimeLocalInput,
              canReadProjectEnvironments,
              canReadProjectDatasets,
              canEditProjectEnvironmentsEffective,
              canEditProjectDatasetsEffective,
              openEnvironmentModal,
              handleSaveProjectEnvironment,
              projectEnvironments,
              datasetFormEnvId,
              setDatasetFormEnvId,
              handleDeleteProjectEnvironment,
              handleSaveEnvironmentDataset,
              getDatasetDraft,
              isDatasetDraftDirty,
              savingDatasetId,
              savedDatasetId,
              handleDatasetSubmit,
              handleSetDefaultEnvironmentDataset,
              setDatasetDrafts,
              handleDeleteEnvironmentDataset,
              updateDatasetDraft,
              canReadTraceability,
              canEditTraceability,
              buildWriteEnabled,
              traceabilityRefreshToken,
              confirmAction,
              onCreateCaseFromStory,
              onOpenLinkedCase,
              canReadProjectWiki,
              canEditProjectWikiEffective,
              setSelectedWiki,
              setWikiFormData,
              setWikiMode,
              wikiPages,
              handleDeleteWikiPage,
              wikiMode,
              wikiFormData,
              selectedWiki,
              handleSaveWikiPage,
              canReadProjectTickets,
              canEditProjectTicketsEffective,
              loadProjectBugs,
              bugsLoading,
              createBugIssue,
              bugForm,
              setBugForm,
              bugIssues,
              updateBugIssue,
            }} />
          )}
          <ProjectModals
            t={t} showProjectStatusHelp={showProjectStatusHelp} setShowProjectStatusHelp={setShowProjectStatusHelp}
            projectStatusHelpItems={projectStatusHelpItems} projectStatusVariant={projectStatusVariant}
            showEnvironmentModal={showEnvironmentModal} closeEnvironmentModal={closeEnvironmentModal}
            editingEnvironment={editingEnvironment} submitEnvironmentModal={submitEnvironmentModal}
            environmentVariablesText={environmentVariablesText}
          />
        </div>
  )
}
