import { FeedbackModal } from '../shared/components/FeedbackModal'
import { ConfirmDialog } from '../shared/components/ConfirmDialog'
import { ZoomImageModal } from '../shared/components/ZoomImageModal'
import { Badge, Button, Modal, Spinner } from 'react-bootstrap'
import { AlertTriangle, ArrowLeft, Eye, Plus, RefreshCw } from 'lucide-react'
import { AdminModals } from '../features/configuracion/AdminModals'
import { ExecutionSelectorModal } from '../features/ejecutar-pruebas/ExecutionSelectorModal'
import { AutomationRunMonitorModal } from '../features/ejecutar-pruebas/AutomationRunMonitorModal'
import { IaSchedulerModal } from '../features/motor-ia/IaSchedulerModal'
import { ExecutionRedmineReporter } from '../features/redmine/ExecutionRedmineReporter'
import { BuildCasesModal } from '../features/proyectos/BuildCasesModal'
import { InventoryItemModal } from '../features/inventario/InventoryItemModal'
import { SuiteAndComponentModals } from '../features/casos/SuiteAndComponentModals'

type AppModalsProps = any

const closedBugStates = new Set(['RESUELTO', 'CERRADO', 'DUPLICADO', 'NO_REPRODUCIBLE', 'NO_CORRESPONDE'])

function getBugOriginBuild(bug: any) {
  return bug?._display_build_name || bug?.version_app || bug?.metadata_json?.build_name || bug?.build_name || bug?.build_code || bug?.metadata_json?.build_code || 'Build origen no registrada'
}

function getBugComponentName(bug: any) {
  return bug?._display_component_name || bug?.modulo_funcional || bug?.metadata_json?.component_name || 'Componente no registrado'
}

function getBugOccurrenceBuilds(bug: any) {
  const occurrences = bug?.metadata_json?.linked_execution_occurrences || []
  if (!Array.isArray(occurrences)) return []
  return occurrences
    .map((item: any) => item?.build_name || item?.build_code || item?.build || '')
    .filter(Boolean)
}

function renderBugTraceText(bug: any) {
  const origin = getBugOriginBuild(bug)
  const occurrences = Array.from(new Set(getBugOccurrenceBuilds(bug)))
  if (occurrences.length === 0) return `Detectado en ${origin}.`
  return `Detectado en ${origin}. Se continua observando en ${occurrences.join(', ')}.`
}

function RelatedBugDecisionModal(props: any) {
  const dialog = props.relatedBugDecision || {}
  const bugs = Array.isArray(dialog.bugs) ? dialog.bugs : []
  const viewingBug = dialog.viewingBug
  const linkingBugId = dialog.linkingBugId
  const canLink = dialog.canLink !== false
  const currentBuild = (props.buildsList || []).find((item: any) => String(item.id) === String(props.currentBuildId || ''))
  const currentComponent = (props.componentsList || []).find((item: any) => String(item.id) === String(props.currentCompId || ''))
  const currentBuildLabel = currentBuild?.name || currentBuild?.nombre || ''
  const currentComponentLabel = currentComponent?.name || currentComponent?.nombre || ''

  return (
    <Modal show={Boolean(dialog.show)} onHide={() => props.closeRelatedBugDecision('cancel')} centered size="lg">
      <Modal.Header closeButton className="bg-warning bg-opacity-25 border-warning">
        <Modal.Title className="fs-5 fw-bold d-flex align-items-center gap-2 text-dark">
          <AlertTriangle size={22} className="text-warning" /> Bug abierto relacionado
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {!viewingBug ? (
          <>
            <p className="mb-3 text-dark">
              Este caso ya tiene bugs abiertos. Si es el mismo defecto, actualiza el seguimiento para registrar que sigue ocurriendo en esta build.
            </p>
            {(currentBuildLabel || currentComponentLabel) && (
              <div className="border rounded-3 bg-light p-2 mb-3 small">
                {currentBuildLabel && <div><strong>Build actual:</strong> {currentBuildLabel}</div>}
                {currentComponentLabel && <div><strong>Componente actual:</strong> {currentComponentLabel}</div>}
              </div>
            )}
            <div className="d-flex flex-column gap-2">
              {bugs.map((bug: any) => {
                const closed = closedBugStates.has(String(bug?.estado || '').toUpperCase())
                const isLinking = linkingBugId === bug?.id
                return (
                  <div key={bug?.id || bug?.codigo} className="border rounded-3 bg-light p-3">
                    <div className="d-flex align-items-start justify-content-between gap-3">
                      <div className="min-w-0">
                        <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
                          <Badge bg={closed ? 'secondary' : 'danger'}>{bug?.codigo || 'BUG'}</Badge>
                          <span className="fw-bold text-dark text-truncate">{bug?.titulo || 'Bug sin titulo'}</span>
                        </div>
                        <div className="small text-muted">{renderBugTraceText(bug)}</div>
                        <div className="x-small text-muted mt-1">Componente: {getBugComponentName(bug)}</div>
                      </div>
                      <div className="d-flex align-items-center gap-2 flex-shrink-0">
                        <Button variant="outline-secondary" size="sm" className="fw-bold" onClick={() => props.viewRelatedBugFromDecision(bug)}>
                          <Eye size={14} /> Ver
                        </Button>
                        <Button
                          variant="outline-danger"
                          size="sm"
                          className="fw-bold"
                          disabled={!canLink || Boolean(linkingBugId)}
                          title={canLink ? 'Registrar que este bug sigue ocurriendo en esta build' : 'Guarda una ejecucion fallida o bloqueada antes de actualizar seguimiento'}
                          onClick={() => props.linkBugFromDecision(bug)}
                        >
                          {isLinking ? <Spinner animation="border" size="sm" /> : <RefreshCw size={14} />} Actualizar seguimiento
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <div>
            <Button variant="link" className="px-0 fw-bold text-decoration-none mb-3" onClick={props.backToRelatedBugDecisionList}>
              <ArrowLeft size={16} /> Volver a bugs abiertos
            </Button>
            <div className="border rounded-3 p-3 bg-light">
              <div className="d-flex align-items-center gap-2 flex-wrap mb-2">
                <Badge bg="danger">{viewingBug?.codigo || 'BUG'}</Badge>
                <Badge bg="light" text="dark" className="border">{viewingBug?.estado || 'Sin estado'}</Badge>
                <Badge bg="light" text="dark" className="border">{viewingBug?.severidad || 'Severidad N/D'}</Badge>
              </div>
              <h6 className="fw-bold text-dark mb-2">{viewingBug?.titulo || 'Bug sin titulo'}</h6>
              <p className="small text-muted mb-3">{renderBugTraceText(viewingBug)}</p>
              <div className="row g-3 small">
                <div className="col-md-6">
                  <div className="fw-bold text-uppercase x-small text-muted">Build actual seleccionada</div>
                  <div className="text-dark">{currentBuildLabel || 'N/D'}</div>
                </div>
                <div className="col-md-6">
                  <div className="fw-bold text-uppercase x-small text-muted">Build origen</div>
                  <div className="text-dark">{getBugOriginBuild(viewingBug)}</div>
                </div>
                <div className="col-md-6">
                  <div className="fw-bold text-uppercase x-small text-muted">Componente actual</div>
                  <div className="text-dark">{currentComponentLabel || 'N/D'}</div>
                </div>
                <div className="col-md-6">
                  <div className="fw-bold text-uppercase x-small text-muted">Componente origen</div>
                  <div className="text-dark">{getBugComponentName(viewingBug)}</div>
                </div>
                <div className="col-md-6">
                  <div className="fw-bold text-uppercase x-small text-muted">Seguimientos</div>
                  <div className="text-dark">{getBugOccurrenceBuilds(viewingBug).join(', ') || 'Sin ocurrencias adicionales registradas'}</div>
                </div>
                <div className="col-12">
                  <div className="fw-bold text-uppercase x-small text-muted">Descripcion</div>
                  <div className="text-dark text-pre-wrap">{viewingBug?.descripcion || viewingBug?.resultado_obtenido || 'Sin descripcion cargada.'}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer className="d-flex justify-content-between">
        <Button variant="outline-secondary" onClick={() => props.closeRelatedBugDecision('cancel')} disabled={Boolean(linkingBugId)}>
          Cancelar
        </Button>
        <Button variant="warning" className="fw-bold" onClick={() => props.closeRelatedBugDecision('create')} disabled={Boolean(linkingBugId)}>
          <Plus size={16} /> Crear bug distinto
        </Button>
      </Modal.Footer>
    </Modal>
  )
}

export function AppModals(props: AppModalsProps) {
  return (
    <>
      <BuildCasesModal
        show={props.showBuildCasesModal}
        onHide={() => props.setShowBuildCasesModal(false)}
        buildsList={props.buildsList}
        editingBuildCasesId={props.editingBuildCasesId}
        currentAuthoringCases={props.currentAuthoringCases}
        lockedBuildCaseIds={props.lockedBuildCaseIds}
        buildCaseDraftIds={props.buildCaseDraftIds}
        setBuildCaseDraftIds={props.setBuildCaseDraftIds}
        suitesTree={props.suitesTree}
        buildCaseSearch={props.buildCaseSearch}
        setBuildCaseSearch={props.setBuildCaseSearch}
        saveBuildCases={props.saveBuildCases}
        assignPreviousFailedCases={props.assignPreviousFailedCases}
      />

      <FeedbackModal feedback={props.feedbackModal} onHide={() => props.setFeedbackModal((prev: any) => ({ ...prev, show: false }))} />

      <ConfirmDialog dialog={props.confirmDialog} onCancel={() => props.closeConfirmDialog(false)} onConfirm={() => props.closeConfirmDialog(true)} />

      <RelatedBugDecisionModal
        relatedBugDecision={props.relatedBugDecision}
        closeRelatedBugDecision={props.closeRelatedBugDecision}
        viewRelatedBugFromDecision={props.viewRelatedBugFromDecision}
        backToRelatedBugDecisionList={props.backToRelatedBugDecisionList}
        linkBugFromDecision={props.linkBugFromDecision}
        currentBuildId={props.currentBuildId}
        currentCompId={props.currentCompId}
        buildsList={props.buildsList}
        componentsList={props.componentsList}
      />

      <AdminModals
        showRoleModal={props.showRoleModal}
        setShowRoleModal={props.setShowRoleModal}
        editingRoleId={props.editingRoleId}
        roleForm={props.roleForm}
        setRoleForm={props.setRoleForm}
        setRoleModulePermission={props.setRoleModulePermission}
        setRoleCapabilityPermission={props.setRoleCapabilityPermission}
        handleSaveRole={props.handleSaveRole}
        showUserModal={props.showUserModal}
        setShowUserModal={props.setShowUserModal}
        editingUserId={props.editingUserId}
        userForm={props.userForm}
        setUserForm={props.setUserForm}
        customRoles={props.customRoles}
        fetchWithAuth={props.fetchWithAuth}
        handleUserCustomRoleChange={props.handleUserCustomRoleChange}
        handleUserRoleChange={props.handleUserRoleChange}
        handleSaveUser={props.handleSaveUser}
        showProjectMemberModal={props.showProjectMemberModal}
        setShowProjectMemberModal={props.setShowProjectMemberModal}
        projectMemberForm={props.projectMemberForm}
        setProjectMemberForm={props.setProjectMemberForm}
        handleSubmitProjectMember={props.projectMemberActions.handleSubmitProjectMember}
        projectsList={props.projectsList}
        managingProjectId={props.managingProjectId}
        assignableUsers={props.assignableUsers}
        projectMemberRemoval={props.projectMemberRemoval}
        setProjectMemberRemoval={props.setProjectMemberRemoval}
        confirmRemoveProjectMember={props.projectMemberActions.confirmRemoveProjectMember}
      />

      <ExecutionSelectorModal
        show={props.showExecSelector}
        onHide={props.closeExecutionSelector}
        executionModalTests={props.executionModalTests}
        executionModalDiscardedCount={props.executionModalDiscardedCount}
        executionLoading={props.executionLoading}
        environments={props.currentProjectEnvironments}
        selectedEnvironmentId={props.selectedExecutionEnvironmentId}
        setSelectedEnvironmentId={props.setSelectedExecutionEnvironmentId}
        selectedDatasetId={props.selectedExecutionDatasetId}
        setSelectedDatasetId={props.setSelectedExecutionDatasetId}
        datasetPreview={props.executionDatasetPreview}
        datasetPreviewLoading={props.executionDatasetPreviewLoading}
        getExecutionCaseLabel={props.getExecutionCaseLabel}
        isOutdatedExecutionCase={props.isOutdatedExecutionCase}
        onShowDatasetHelp={() => props.showFeedback('Dataset por ambiente', 'El ambiente resuelve placeholders antes de ejecutar. Ejemplos: base_url={{ENV.BASE_URL}}, usuario={{ENV.USER}}, password={{ENV.PASSWORD}}, tenant={{ENV.TENANT}}. Inventario es solo catálogo operativo; el ambiente es el contexto de ejecución.', 'info')}
        onStart={props.handleStartExecution}
        automationDebugMode={props.automationDebugMode}
        setAutomationDebugMode={props.setAutomationDebugMode}
        canStartManualExecution={props.canStartManualExecution}
        canUseAutomatedExecution={props.canUseAutomatedExecution}
        canUseIaExecution={props.canUseIaExecution}
        iaEnginePremiumLocked={props.iaEnginePremiumLocked}
        onScheduleIa={props.openIaSchedulerFromExecutionSelector}
      />

      <AutomationRunMonitorModal
        show={props.automationMonitor.show}
        onHide={() => props.setAutomationMonitor((prev: any) => ({ ...prev, show: false }))}
        mode={props.automationMonitor.mode || 'execution'}
        run={props.automationMonitor.run}
        jobs={props.automationMonitor.jobs}
        fetchWithAuth={props.fetchWithAuth}
        canViewHistory={props.canViewHistory}
        onExecutionResultsSettled={props.refreshCurrentBuildExecutionStatus}
        onOpenWorkers={() => {
          props.setAutomationMonitor((prev: any) => ({ ...prev, show: false }))
          props.setActiveTab('automatizacion')
        }}
        onOpenHistory={() => {
          props.setAutomationMonitor((prev: any) => ({ ...prev, show: false }))
          props.openHistorialRuns({ build_id: props.currentBuildId }, props.automationMonitor.run?.id || '')
        }}
      />

      <IaSchedulerModal
        show={props.showIaScheduler}
        onHide={() => {
          props.setShowIaScheduler(false)
          props.setIaSchedulerOpenedFromBuilder(false)
        }}
        visibleSuiteTree={props.visibleSuiteTree}
        currentProjectCases={props.currentProjectCases}
        belongsToCurrentComponent={props.belongsToCurrentComponent}
        schedulerSearch={props.schedulerSearch}
        setSchedulerSearch={props.setSchedulerSearch}
        selectedTestsForIa={props.selectedTestsForIa}
        setSelectedTestsForIa={props.setSelectedTestsForIa}
        execName={props.execName}
        setExecName={props.setExecName}
        scheduledTime={props.scheduledTime}
        setScheduledTime={props.setScheduledTime}
        buildsList={props.buildsList}
        currentBuildId={props.currentBuildId}
        iaProvider={props.iaProvider}
        onLaunch={props.handleLaunchIaMission}
      />

      <ExecutionRedmineReporter
        showPrompt={props.showRedminePrompt}
        onHidePrompt={() => props.setShowRedminePrompt(false)}
        showDrawer={props.showRedmineDrawer}
        onHideDrawer={() => {
          props.setShowRedmineDrawer(false)
          props.setInternalBugDraft(null)
          props.setInternalBugEvidence([])
          props.setInternalBugAdditionalContext([])
        }}
        currentExecutionCase={props.currentExecutionCase}
        selectedTest={props.selectedTest}
        onDefer={() => {
          props.setInternalBugDraft(null)
          props.setInternalBugEvidence([])
          props.setInternalBugAdditionalContext([])
          if (props.internalBugDraft?._context?.manual || props.internalBugDraft?._context?.fromCaseHistory) {
            props.setShowRedmineDrawer(false)
            return
          }
          void props.deferRedmineReportAndContinue()
        }}
        onOpenReport={props.openRedmineReportFromPrompt}
        onSubmitInternalBug={props.handleSubmitInternalBugReport}
        internalBugDraft={props.internalBugDraft}
        onInternalBugDraftChange={props.handleInternalBugDraftChange}
        additionalContextRows={props.internalBugAdditionalContext}
        onAdditionalContextRowsChange={props.setInternalBugAdditionalContext}
        internalBugEvidence={props.internalBugEvidence}
        onInternalBugEvidenceUploaded={(attachment: any) => props.setInternalBugEvidence((prev: any[]) => (
          prev.some(item => item?.id === attachment?.id) ? prev : [...prev, attachment]
        ))}
        onInternalBugEvidenceRemoved={(attachment: any) => props.setInternalBugEvidence((prev: any[]) => prev.filter(item => item.id !== attachment.id))}
        internalBugCreating={Boolean(props.creatingInternalBugContextId)}
        appUsers={props.appUsers}
      />

      <ZoomImageModal imageUrl={props.zoomImage} onHide={() => props.setZoomImage(null)} />

      <InventoryItemModal
        invModalConfig={props.invModalConfig}
        setInvModalConfig={props.setInvModalConfig}
        currentProjectId={props.currentProjectId}
        environments={props.environments}
        setEnvironments={props.setEnvironments}
        devices={props.devices}
        setDevices={props.setDevices}
        agents={props.agents}
        setAgents={props.setAgents}
        customInventoryItems={props.customInventoryItems}
        setCustomInventoryItems={props.setCustomInventoryItems}
      />

      <SuiteAndComponentModals
        showAddFolderModal={props.showAddFolderModal}
        setShowAddFolderModal={props.setShowAddFolderModal}
        folderConfig={props.folderConfig}
        suitesTree={props.suitesTree}
        setSuiteForm={props.setSuiteForm}
        handleCreateSuite={props.handleCreateSuite}
        showSuiteModal={props.showSuiteModal}
        setShowSuiteModal={props.setShowSuiteModal}
        editingSuiteId={props.editingSuiteId}
        setEditingSuiteId={props.setEditingSuiteId}
        suiteForm={props.suiteForm}
        handleUpdateSuite={props.handleUpdateSuite}
        showMoveSuiteModal={props.showMoveSuiteModal}
        setShowMoveSuiteModal={props.setShowMoveSuiteModal}
        movingSuiteId={props.movingSuiteId}
        setMovingSuiteId={props.setMovingSuiteId}
        moveSuiteParentId={props.moveSuiteParentId}
        setMoveSuiteParentId={props.setMoveSuiteParentId}
        handleMoveSuite={props.handleMoveSuite}
        showComponentModal={props.showComponentModal}
        setShowComponentModal={props.setShowComponentModal}
        componentForm={props.componentForm}
        setComponentForm={props.setComponentForm}
        handleSaveComponentForm={props.componentActions.handleSaveComponentForm}
      />
    </>
  )
}
