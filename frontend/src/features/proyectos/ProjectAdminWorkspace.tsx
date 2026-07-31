import { Badge, Button, Nav } from 'react-bootstrap'
import { ArrowLeft } from 'lucide-react'
import { CasePortabilityPanel } from '../configuracion/components/tabs/CasePortabilityPanel'
import { TraceabilityTab } from './TraceabilityTab'
import { ProjectConfigTab } from './ProjectConfigTab'
import { ProjectComponentsTab } from './ProjectComponentsTab'
import { ProjectEnvironmentsTab } from './ProjectEnvironmentsTab'
import { ProjectWikiTab } from './ProjectWikiTab'
import { ProjectTicketsTab } from './ProjectTicketsTab'

export function ProjectAdminWorkspace({ context }: { context: any }) {
  const { t,
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
    updateBugIssue } = context
  return (
<div className="project-admin-shell d-flex flex-column h-100 overflow-hidden">

              {/* Header del Admin de Proyecto */}
              <div className="project-admin-header p-3 border-bottom d-flex align-items-center gap-3 flex-shrink-0">
                <Button variant="white" size="sm" className="border shadow-sm rounded-circle p-2" onClick={() => setManagingProjectId(null)}>
                  <ArrowLeft size={18} className="text-dark" />
                </Button>
                <div className="project-avatar project-avatar-sm flex-shrink-0">
                  {projectsList.find(p => p.id === managingProjectId)?.imageUrl ? (
                    <img src={projectsList.find(p => p.id === managingProjectId)?.imageUrl} alt={projectsList.find(p => p.id === managingProjectId)?.name || t('proyectos.projectFallback')} onError={(event) => { event.currentTarget.style.display = 'none' }} />
                  ) : (
                    <span>{projectInitials(projectsList.find(p => p.id === managingProjectId)?.name || t('proyectos.projectFallback'))}</span>
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
                      {projectsList.find(p => p.id === managingProjectId)?.status || t('proyectos.activeStatus')}
                    </Badge>
                  </h5>
                  <span className="text-muted small">{t('proyectos.projectAdminPanel')}</span>
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
                <div className="project-admin-content flex-grow-1 p-4 overflow-auto">

                  {/* SUB-TAB: CONFIGURACIÓN Y EQUIPO */}
                  {projectInnerTab === 'config' && (canEditProjectPortfolio || canReadProjectTeam) && (
                    <ProjectConfigTab
                      t={t} canEditProjectPortfolio={canEditProjectPortfolio} canReadProjectTeam={canReadProjectTeam}
                      canEditProject={canEditProject} projectsList={projectsList} managingProjectId={managingProjectId}
                      setShowProjectStatusHelp={setShowProjectStatusHelp} handleUpdateProject={handleUpdateProject}
                      canEditProjectTeamEffective={canEditProjectTeamEffective} handleAddProjectMember={handleAddProjectMember}
                      projectMembers={projectMembers} handleRemoveProjectMember={handleRemoveProjectMember}
                    />
                  )}

                  {projectInnerTab === 'portability' && (
                    <div className="animate__animated animate__fadeIn">
                      <h5 className="fw-bold text-dark mb-1">{t('proyectos.importExportCases')}</h5>
                      <p className="small text-muted mb-4">{t('proyectos.importExportHint')}</p>
                      <CasePortabilityPanel fetchWithAuth={fetchWithAuth} showFeedback={showFeedback} canEdit={canUseCapability('plugins.provider.case_portability.importar_casos', 'edit')} initialProjectId={managingProjectId} embedded />
                    </div>
                  )}

                  {/* SUB-TAB: COMPONENTES Y BUILDS (NUEVO DISEÑO MASTER-DETAIL) */}
                      {projectInnerTab === 'components' && (canReadProjectComponents || canReadProjectBuilds || canReadProjectBuildScope) && (
                        <ProjectComponentsTab context={{
                        t,
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
                        managingProjectId,
                        currentCompId,
                        buildsList,
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
                        }} />
                      )}

                  {/* SUB-TAB: AMBIENTES */}
                  {projectInnerTab === 'envs' && (canReadProjectEnvironments || canReadProjectDatasets) && (
                    <ProjectEnvironmentsTab context={{
                        t,
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
                    }} />
                  )}

                  {canReadTraceability && managingProjectId && (
                    <div className={projectInnerTab === 'traceability' ? 'h-100' : 'd-none'} aria-hidden={projectInnerTab !== 'traceability'}>
                      <TraceabilityTab
                      projectId={managingProjectId}
                      components={componentsList}
                      fetchWithAuth={fetchWithAuth}
                      canEdit={canEditTraceability && buildWriteEnabled}
                      active={projectInnerTab === 'traceability'}
                      refreshToken={traceabilityRefreshToken}
                      confirmAction={confirmAction}
                      onCreateCaseFromStory={onCreateCaseFromStory}
                      onOpenLinkedCase={onOpenLinkedCase}
                      showFeedback={showFeedback}
                      />
                    </div>
                  )}

                  {/* SUB-TAB: WIKI Y DOCUMENTACIÓN (AVANZADO) */}
                  {projectInnerTab === 'wiki' && canReadProjectWiki && (
                    <ProjectWikiTab context={{
                        t,
                        canEditProjectWikiEffective,
                        setSelectedWiki,
                        setWikiFormData,
                        setWikiMode,
                        wikiPages,
                        managingProjectId,
                        handleDeleteWikiPage,
                        wikiMode,
                        wikiFormData,
                        selectedWiki,
                        handleSaveWikiPage,
                    }} />
                  )}

                  {/* SUB-TAB: TICKETS E INCIDENCIAS */}
                  {projectInnerTab === 'tickets' && canReadProjectTickets && (
                    <ProjectTicketsTab context={{
                        t,
                        canEditProjectTicketsEffective,
                        loadProjectBugs,
                        bugsLoading,
                        createBugIssue,
                        bugForm,
                        setBugForm,
                        componentsList,
                        managingProjectId,
                        buildsList,
                        bugIssues,
                        updateBugIssue,
                    }} />
                  )}

                </div>
              </div>
            </div>
  )
}
