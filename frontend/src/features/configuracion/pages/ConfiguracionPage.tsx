import { Fragment, useEffect, useMemo, useState } from 'react'
import { Nav, Card, Badge, Form, Button, Table, Dropdown } from 'react-bootstrap'
import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Settings, Building2, Users, ShieldCheck, Link, Sliders, Save, Plus, RotateCcw, Copy, Upload, Download, Archive, Flag, Activity, User, Cpu, MoreHorizontal, BadgeCheck, Mail, Crown, DownloadCloud, ClipboardCheck } from 'lucide-react'
import { AuditSettingsTab } from '../components/tabs/AuditSettingsTab'
import { GeneralSettingsTab } from '../components/tabs/GeneralSettingsTab'
import { AiAgentPromptModal } from '../components/tabs/AiAgentPromptModal'
import { AiEngineSettingsCards } from '../components/tabs/AiEngineSettingsCards'
import { IntegrationsSettingsTab } from '../components/tabs/IntegrationsSettingsTab'
import { OrganizationsSettingsTab } from '../components/tabs/OrganizationsSettingsTab'
import { LicenseSettingsTab } from '../components/tabs/LicenseSettingsTab'
import { NotificationsSettingsTab } from '../components/tabs/NotificationsSettingsTab'
import { ProfileSettingsTab } from '../components/tabs/ProfileSettingsTab'
import { RolesSettingsTab, UsersSettingsTab } from '../components/tabs/UsersRolesSettingsTab'
import { SystemMonitorTab } from '../components/tabs/SystemMonitorTab'
import { UpdatesSettingsTab } from '../components/tabs/UpdatesSettingsTab'
import { WorkflowBuilderModal } from '../components/workflow/WorkflowBuilderModal'
import { WorkflowSummaryCard } from '../components/workflow/WorkflowSummaryCard'
import {
  fetchAiWorkflows,
} from '../api/aiWorkflowApi'
import { useAgentWorkflowConfig } from '../hooks/useAgentWorkflowConfig'
import { useAiModelConfig } from '../hooks/useAiModelConfig'
import { useAttachmentMimeOptions } from '../hooks/useAttachmentMimeOptions'
import { useProfileSettings } from '../hooks/useProfileSettings'
import { useWorkflowActions } from '../hooks/useWorkflowActions'
import { useWorkflowFlow } from '../hooks/useWorkflowFlow'
import { useWorkflowLocalEdits } from '../hooks/useWorkflowLocalEdits'
import { useWorkflowPresets } from '../hooks/useWorkflowPresets'
import { useWorkflowRuntimeTraces } from '../hooks/useWorkflowRuntimeTraces'
import { useWorkflowVersions } from '../hooks/useWorkflowVersions'
import type { AiWorkflow, ConfiguracionPageProps } from '../types/configuracion'
import {
  agentActionOptions,
  capabilityVariant,
  formatWorkflowDate,
  workflowStatusColor,
} from '../mappers/configuracionMappers'

export function ConfiguracionPage(props: ConfiguracionPageProps) {
  return (
    <ReactFlowProvider>
      <ConfiguracionPageInner {...props} />
    </ReactFlowProvider>
  )
}

function PremiumLockedSettingsPanel({
  title,
  description,
  bullets,
  onOpenLicense,
}: {
  title: string
  description: string
  bullets: string[]
  onOpenLicense: () => void
}) {
  return (
    <div className="animate__animated animate__fadeIn">
      <Card className="border-0 shadow-sm rounded-4 bg-white p-4">
        <div className="d-flex flex-column flex-md-row justify-content-between align-items-start gap-3">
          <div>
            <Badge bg="warning" text="dark" className="border mb-3 d-inline-flex align-items-center gap-1">
              <Crown size={14} /> Premium
            </Badge>
            <h5 className="fw-bold text-dark mb-2">{title}</h5>
            <p className="text-muted mb-3">{description}</p>
            <div className="d-flex flex-column gap-2">
              {bullets.map(item => (
                <div key={item} className="small text-secondary d-flex align-items-start gap-2">
                  <span className="text-primary fw-bold">•</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
          <Button variant="outline-primary" className="fw-bold rounded-pill px-4" onClick={onOpenLicense}>
            Ver licencia
          </Button>
        </div>
      </Card>
    </div>
  )
}

function ConfiguracionPageInner({
  configTab,
  setConfigTab,
  canAccessModule,
  canAccessCapability,
  hasSystemFeature,
  showFeedback,
  apiKeys,
  apiKeysLoading,
  apiKeyName,
  newApiKeyValue,
  setApiKeyName,
  createUserApiKey,
  revokeUserApiKey,
  handleApiKeyEnabledChange,
  copyToClipboard,
  attachmentConfig,
  setAttachmentConfig,
  attachmentConfigLoading,
  saveAttachmentConfig,
  sessionConfig,
  setSessionConfig,
  sessionConfigLoading,
  saveSessionConfig,
  aiEngineConfig,
  setAiEngineConfig,
  aiEngineConfigLoading,
  aiEngineHealth,
  saveAiEngineConfig,
  checkAiEngineHealth,
  organizations,
  projectsList,
  selectedOrganizationId,
  setSelectedOrganizationId,
  handleCreateOrganization,
  handleUpdateOrganization,
  handleSetOrganizationActive,
  loadOrganizationsFromBackend,
  organizationMembers,
  organizationMemberForm,
  setOrganizationMemberForm,
  assignableUsers,
  handleAssignOrganizationMember,
  handleRemoveOrganizationMember,
  adConfig,
  setAdConfig,
  appUsers,
  openUserModal,
  handleDeactivateUser,
  loadUsersFromBackend,
  loggedUser,
  fetchWithAuth,
  onLoggedUserUpdated,
  onBrandingUpdated,
  systemRoleItems,
  customRoles,
  openRoleModal,
  handleDeactivateRole,
  setActiveTab,
  onOpenIaScheduler,
}: ConfiguracionPageProps) {
  const visibleConfigTabs = useMemo(() => {
    const canAccessNotifications = [
      'notificaciones.ver',
      'notificaciones.inbox',
      'notificaciones.configuracion',
      'notificaciones.reglas',
      'notificaciones.plantillas',
      'notificaciones.auditoria',
      'notificaciones.admin',
    ].some(capability => canAccessCapability(capability, 'read'))
    return [
      { id: 'general', visible: canAccessCapability('configuracion.preferencias', 'read'), label: 'Preferencias', icon: Settings },
      { id: 'profile', visible: canAccessCapability('configuracion.perfil', 'read'), label: 'Mi Perfil', icon: User },
      { id: 'clients', visible: canAccessCapability('configuracion.clientes', 'read'), label: 'Clientes / Soluciones', icon: Building2 },
      { id: 'users', visible: canAccessCapability('configuracion.usuarios', 'read'), label: 'Gestión Usuarios', icon: Users },
      { id: 'roles', visible: canAccessCapability('configuracion.roles', 'read'), label: 'Roles', icon: ShieldCheck },
      { id: 'notifications', visible: canAccessNotifications, label: 'Correo', icon: Mail },
      { id: 'integrations', visible: canAccessCapability('configuracion.integraciones', 'read'), label: 'Complementos', icon: Link },
      { id: 'ai', visible: canAccessCapability('configuracion.pruebas_ia', 'read'), label: 'Pruebas con IA', icon: Cpu },
      { id: 'monitor', visible: canAccessCapability('configuracion.monitor', 'read'), label: 'Monitor', icon: Activity },
      { id: 'audit', visible: canAccessCapability('configuracion.monitor', 'read'), label: 'Auditoria', icon: ClipboardCheck },
      { id: 'license', visible: canAccessCapability('configuracion.licencia', 'read'), label: 'Licencia', icon: BadgeCheck },
      { id: 'updates', visible: canAccessCapability('configuracion.actualizaciones', 'read'), label: 'Actualizaciones', icon: DownloadCloud },
    ].filter(tab => tab.visible)
  }, [canAccessCapability, hasSystemFeature])

  useEffect(() => {
    if (visibleConfigTabs.length > 0 && !visibleConfigTabs.some(tab => tab.id === configTab)) {
      setConfigTab(visibleConfigTabs[0].id)
    }
  }, [configTab, setConfigTab, visibleConfigTabs])

  const { profileDraft, setProfileDraft, saveMyProfile } = useProfileSettings({
    loggedUser,
    fetchWithAuth,
    onLoggedUserUpdated,
    showFeedback,
  })
  const { attachmentMimeGroups, toggleAttachmentMime } = useAttachmentMimeOptions({
    attachmentConfig,
    setAttachmentConfig,
  })
  const [promptAgentIndex, setPromptAgentIndex] = useState<number | null>(null)
  const [aiWorkflows, setAiWorkflows] = useState<AiWorkflow[]>([])
  const [workflowDraft, setWorkflowDraft] = useState<AiWorkflow | null>(null)
  const [workflowLoading, setWorkflowLoading] = useState(false)
  const [workflowLoadError, setWorkflowLoadError] = useState('')
  const [workflowJsonError, setWorkflowJsonError] = useState('')
  const {
    setFlowNodes,
    setFlowEdges,
    selectedWorkflowElement,
    setSelectedWorkflowElement,
    workflowPropertiesTab,
    setWorkflowPropertiesTab,
    autoLayoutEnabled,
    workflowBuilderOpen,
    setWorkflowBuilderOpen,
    workflowNodeTypes,
    workflowEdgeDebugEnabled,
    renderFlowNodes,
    renderFlowEdges,
    selectedWorkflowNode,
    selectedWorkflowEdge,
    refitWorkflow,
    openWorkflowBuilder,
    closeWorkflowProperties,
    selectWorkflowElement,
    switchToManualMode,
    switchToAutoLayoutMode,
    syncFlowFromWorkflow,
  } = useWorkflowFlow({
    workflowDraft,
    setWorkflowDraft,
    setAiWorkflows,
  })
  const activeWorkflows = useMemo(() => aiWorkflows.filter(workflow => workflow.status === 'ACTIVE'), [aiWorkflows])
  const loadAiWorkflows = async () => {
    if (!canAccessModule('motor_ia', 'read') && !canAccessModule('configuracion', 'read')) return
    setWorkflowLoading(true)
    try {
      setWorkflowLoadError('')
      const workflows = await fetchAiWorkflows(fetchWithAuth)
      setAiWorkflows(workflows)
      const activeId = aiEngineConfig.active_workflow_id || workflows.find((item: AiWorkflow) => item.status === 'ACTIVE')?.id || workflows[0]?.id
      const selected = workflows.find((item: AiWorkflow) => item.id === activeId) || workflows[0] || null
      setWorkflowDraft(selected)
      syncFlowFromWorkflow(selected)
      if (selected?.id) loadWorkflowVersions(selected.id)
    } catch (error: any) {
      setAiWorkflows([])
      setWorkflowDraft(null)
      syncFlowFromWorkflow(null)
      setWorkflowLoadError(error?.message || 'No se pudieron cargar los workflows.')
    } finally {
      setWorkflowLoading(false)
    }
  }

  const {
    workflowChangelog,
    setWorkflowChangelog,
    workflowVersions,
    selectedWorkflowVersion,
    loadWorkflowVersions,
    publishWorkflowVersion,
    activateWorkflowVersion,
    rollbackWorkflow,
  } = useWorkflowVersions({
    fetchWithAuth,
    workflowDraft,
    setWorkflowDraft,
    setAiWorkflows,
    setWorkflowLoading,
    setWorkflowJsonError,
    syncFlowFromWorkflow,
    loadAiWorkflows,
    showFeedback,
  })

  const { agentPresets, agentPresetsError, loadAgentPresets } = useWorkflowPresets({ fetchWithAuth })

  useEffect(() => {
    if (configTab === 'ai' && hasSystemFeature('ai.engine')) {
      loadAiWorkflows()
      loadAgentPresets()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configTab, hasSystemFeature])

  const selectWorkflow = (workflow: AiWorkflow) => {
    setWorkflowDraft(workflow)
    setSelectedWorkflowElement(null)
    syncFlowFromWorkflow(workflow)
    loadWorkflowVersions(workflow.id)
    setAiEngineConfig({ ...aiEngineConfig, active_workflow_id: workflow.id })
  }

  const canEditAi = canAccessCapability('configuracion.pruebas_ia', 'edit') || canAccessCapability('motor_ia.configuracion', 'edit')
  const {
    updateWorkflowDraft,
    updateWorkflowNode,
    updateWorkflowNodeConfig,
    updateWorkflowEdge,
    onWorkflowNodeContextMenu,
    onWorkflowEdgeContextMenu,
    onWorkflowNodesChange,
    onWorkflowEdgesChange,
    onWorkflowNodeDragStop,
    onWorkflowConnect,
  } = useWorkflowLocalEdits({
    workflowDraft,
    canEditAi,
    autoLayoutEnabled,
    setWorkflowDraft,
    setAiWorkflows,
    setFlowNodes,
    setFlowEdges,
    setSelectedWorkflowElement,
    syncFlowFromWorkflow,
    showFeedback,
  })


  const {
    saveWorkflowDraft,
    executeCurrentWorkflow,
    addPresetToWorkflow,
    createWorkflow,
    postWorkflowAction,
    exportWorkflow,
    importWorkflow,
  } = useWorkflowActions({
    fetchWithAuth,
    workflowDraft,
    aiWorkflows,
    selectedWorkflowNode,
    canEditAi,
    onOpenIaScheduler,
    setWorkflowDraft,
    setAiWorkflows,
    setWorkflowLoading,
    syncFlowFromWorkflow,
    loadWorkflowVersions,
    loadAiWorkflows,
    selectWorkflow,
    refitWorkflow,
    showFeedback,
  })
  const {
    traceExecutionId,
    setTraceExecutionId,
    runtimeTraces,
    workflowRuntimeExpanded,
    setWorkflowRuntimeExpanded,
    loadRuntimeTraces,
  } = useWorkflowRuntimeTraces({
    fetchWithAuth,
    showFeedback,
  })

  const {
    aiProviderOptions,
    modelScanLoading,
    modelScanError,
    selectedRuntimeProvider,
    selectedProviderMeta,
    modelCatalog,
    activeModelCapabilities,
    updateAiRuntimeProvider,
    updateActiveModelCapability,
    scanAiModels,
  } = useAiModelConfig({
    aiEngineConfig,
    setAiEngineConfig,
    fetchWithAuth,
    showFeedback,
  })
  const {
    updateAgentWorkflowItem,
    restoreAgentPrompt,
    promptAgent,
  } = useAgentWorkflowConfig({
    aiEngineConfig,
    setAiEngineConfig,
    promptAgentIndex,
  })
  return (
    <>
    <div className="config-page d-flex flex-column h-100 overflow-hidden bg-light text-dark">

      {/* Header Configuracion */}
      <div className="p-4 border-bottom bg-white d-flex align-items-center gap-3 flex-shrink-0 shadow-sm z-1">
        <Sliders size={28} className="text-primary flex-shrink-0" aria-hidden="true" />
        <div>
          <h4 className="fw-bold m-0 text-dark">Configuración del Sistema</h4>
          <span className="text-muted small">Administración de plataforma, integraciones y usuarios</span>
        </div>
      </div>

      <div className="config-layout d-flex flex-grow-1 overflow-hidden">
        {/* Men Lateral Interno de Configuracion */}
        <div className="config-nav border-end bg-white p-3 shadow-sm z-0" style={{ width: '240px', minWidth: '240px' }}>
          <Nav className="flex-column gap-2">
            {visibleConfigTabs.map(tab => {
              const Icon = tab.icon
              return (
                <Button key={tab.id} variant={configTab === tab.id ? 'primary' : 'transparent'} onClick={() => setConfigTab(tab.id)} className={`text-start fw-bold small border-0 shadow-none px-3 py-2 rounded-3 ${configTab !== tab.id ? 'text-secondary hover-bg-light' : ''}`}>
                  <Icon size={16} className="me-2" /> {tab.label}
                </Button>
              )
            })}
          </Nav>
        </div>

        {/* Área Dinámica de Contenido */}
        <div className="flex-grow-1 p-4 overflow-auto bg-light">

          {/* TAB 1: GENERAL */}
          {configTab === 'profile' && (
            <ProfileSettingsTab
              loggedUser={loggedUser}
              profileDraft={profileDraft}
              setProfileDraft={setProfileDraft}
              saveMyProfile={saveMyProfile}
              canEditProfile={canAccessCapability('configuracion.perfil', 'edit')}
            />
          )}



          {/* TAB 1: GENERAL */}
          {configTab === 'general' && (
            <GeneralSettingsTab
              showFeedback={showFeedback}
              sessionConfig={sessionConfig}
              setSessionConfig={setSessionConfig}
              sessionConfigLoading={sessionConfigLoading}
              saveSessionConfig={saveSessionConfig}
              canAccessCapability={canAccessCapability}
              hasSystemFeature={hasSystemFeature}
              apiKeys={apiKeys}
              apiKeysLoading={apiKeysLoading}
              apiKeyName={apiKeyName}
              newApiKeyValue={newApiKeyValue}
              setApiKeyName={setApiKeyName}
              createUserApiKey={createUserApiKey}
              revokeUserApiKey={revokeUserApiKey}
              handleApiKeyEnabledChange={handleApiKeyEnabledChange}
              copyToClipboard={copyToClipboard}
              attachmentConfig={attachmentConfig}
              setAttachmentConfig={setAttachmentConfig}
              attachmentConfigLoading={attachmentConfigLoading}
              saveAttachmentConfig={saveAttachmentConfig}
              attachmentMimeGroups={attachmentMimeGroups}
              toggleAttachmentMime={toggleAttachmentMime}
              fetchWithAuth={fetchWithAuth}
              onBrandingUpdated={onBrandingUpdated}
            />
          )}



          {configTab === 'clients' && (
            <OrganizationsSettingsTab
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
              assignableUsers={assignableUsers}
              handleAssignOrganizationMember={handleAssignOrganizationMember}
              handleRemoveOrganizationMember={handleRemoveOrganizationMember}
              canAccessModule={canAccessModule}
              isAdmin={loggedUser?.role === 'ADMIN'}
            />
          )}



          {/* TAB 2: GESTIÓN DE USUARIOS */}
          {configTab === 'users' && (
            <UsersSettingsTab
              adConfig={adConfig}
              setAdConfig={setAdConfig}
              appUsers={appUsers}
              loggedUser={loggedUser}
              canEditUsers={canAccessCapability('configuracion.usuarios', 'edit')}
              fetchWithAuth={fetchWithAuth}
              loadUsersFromBackend={loadUsersFromBackend}
              openUserModal={openUserModal}
              handleDeactivateUser={handleDeactivateUser}
            />
          )}



          {/* TAB 3: ROLES PERSONALIZADOS */}
          {configTab === 'roles' && (
            <RolesSettingsTab
              systemRoleItems={systemRoleItems}
              customRoles={customRoles}
              canEditRoles={canAccessCapability('configuracion.roles', 'edit')}
              openRoleModal={openRoleModal}
              handleDeactivateRole={handleDeactivateRole}
            />
          )}

          {configTab === 'notifications' && hasSystemFeature('notifications.email') && (
            <NotificationsSettingsTab
              fetchWithAuth={fetchWithAuth}
              showFeedback={showFeedback}
              canAccessCapability={canAccessCapability}
            />
          )}

          {configTab === 'notifications' && !hasSystemFeature('notifications.email') && (
            <PremiumLockedSettingsPanel
              title="Correo SMTP y notificaciones"
              description="Activa envíos por email, plantillas, reglas de entrega y auditoría de notificaciones para mantener informado al equipo."
              bullets={[
                'Notificaciones por email para bugs, ejecuciones, evidencias y eventos críticos.',
                'Reglas configurables por tipo de evento y destinatario.',
                'Historial de entregas para auditar qué se envió y cuándo.',
              ]}
              onOpenLicense={() => setConfigTab('license')}
            />
          )}


          {configTab === 'ai' && !hasSystemFeature('ai.engine') && (
            <PremiumLockedSettingsPanel
              title="Motor IA avanzado"
              description="Configura proveedores, modelos, workflows, presets y trazas para automatizar revisiones QA asistidas por IA."
              bullets={[
                'Workflows visuales con nodos, versiones y rollback.',
                'Catálogo de modelos y presets por agente.',
                'Trazabilidad de ejecuciones IA y diagnósticos de runtime.',
              ]}
              onOpenLicense={() => setConfigTab('license')}
            />
          )}

          {configTab === 'ai' && hasSystemFeature('ai.engine') && (
            <div className="animate__animated animate__fadeIn">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div>
                  <h5 className="fw-bold text-secondary text-uppercase small m-0">Pruebas con IA</h5>
                  <span className="small text-muted">Configuración funcional del LLM y del comportamiento del Motor IA interno.</span>
                </div>
              </div>

              <Card className="border-0 shadow-sm rounded-4 bg-white p-4">
                <Form onSubmit={(e) => { e.preventDefault(); saveAiEngineConfig(aiEngineConfig) }}>
                  <AiEngineSettingsCards
                    aiEngineConfig={aiEngineConfig}
                    setAiEngineConfig={setAiEngineConfig}
                    canEditAi={canEditAi}
                    modelScanLoading={modelScanLoading}
                    scanAiModels={scanAiModels}
                    selectedRuntimeProvider={selectedRuntimeProvider}
                    updateAiRuntimeProvider={updateAiRuntimeProvider}
                    aiProviderOptions={aiProviderOptions}
                    selectedProviderMeta={selectedProviderMeta}
                    modelCatalog={modelCatalog}
                    modelScanError={modelScanError}
                    activeModelCapabilities={activeModelCapabilities}
                    capabilityVariant={capabilityVariant}
                    updateActiveModelCapability={updateActiveModelCapability}
                    aiEngineHealth={aiEngineHealth}
                    checkAiEngineHealth={checkAiEngineHealth}
                  />
                  <WorkflowSummaryCard
                    workflowDraft={workflowDraft}
                    workflowLoadError={workflowLoadError}
                    agentPresetsError={agentPresetsError}
                    workflowStatusColor={workflowStatusColor}
                    formatWorkflowDate={formatWorkflowDate}
                    canEditAi={canEditAi}
                    onOpenWorkflowBuilder={openWorkflowBuilder}
                  />

                  <WorkflowBuilderModal
                    show={workflowBuilderOpen}
                    workflowDraft={workflowDraft}
                    workflowLoading={workflowLoading}
                    canEditAi={canEditAi}
                    onOpenIaScheduler={onOpenIaScheduler}
                    autoLayoutEnabled={autoLayoutEnabled}
                    workflowStatusColor={workflowStatusColor}
                    saveWorkflowDraft={saveWorkflowDraft}
                    publishWorkflowVersion={publishWorkflowVersion}
                    executeCurrentWorkflow={executeCurrentWorkflow}
                    switchToAutoLayoutMode={switchToAutoLayoutMode}
                    switchToManualMode={switchToManualMode}
                    reorderWorkflow={() => {
                      if (!workflowDraft) return
                      syncFlowFromWorkflow(workflowDraft, { forceLayout: true, persistPositions: true, reason: 'manual reorder' })
                    }}
                    postWorkflowAction={postWorkflowAction}
                    exportWorkflow={exportWorkflow}
                    importWorkflow={importWorkflow}
                    closeWorkflowBuilder={() => {
                      setSelectedWorkflowElement(null)
                      setWorkflowBuilderOpen(false)
                    }}
                    refitWorkflow={refitWorkflow}
                    workflowLoadError={workflowLoadError}
                    agentPresetsError={agentPresetsError}
                    activeWorkflows={activeWorkflows}
                    agentPresets={agentPresets}
                    selectWorkflow={selectWorkflow}
                    addPresetToWorkflow={addPresetToWorkflow}
                    workflowChangelog={workflowChangelog}
                    setWorkflowChangelog={setWorkflowChangelog}
                    updateWorkflowDraft={updateWorkflowDraft}
                    renderFlowNodes={renderFlowNodes}
                    renderFlowEdges={renderFlowEdges}
                    workflowNodeTypes={workflowNodeTypes}
                    workflowEdgeDebugEnabled={workflowEdgeDebugEnabled}
                    onWorkflowNodesChange={onWorkflowNodesChange}
                    onWorkflowEdgesChange={onWorkflowEdgesChange}
                    onWorkflowNodeDragStop={onWorkflowNodeDragStop}
                    onWorkflowConnect={onWorkflowConnect}
                    onWorkflowNodeContextMenu={onWorkflowNodeContextMenu}
                    onWorkflowEdgeContextMenu={onWorkflowEdgeContextMenu}
                    selectedWorkflowElement={selectedWorkflowElement}
                    selectedWorkflowNode={selectedWorkflowNode}
                    selectedWorkflowEdge={selectedWorkflowEdge}
                    selectWorkflowElement={selectWorkflowElement}
                    workflowPropertiesTab={workflowPropertiesTab}
                    setWorkflowPropertiesTab={setWorkflowPropertiesTab}
                    updateWorkflowNode={updateWorkflowNode}
                    updateWorkflowNodeConfig={updateWorkflowNodeConfig}
                    updateWorkflowEdge={updateWorkflowEdge}
                    workflowJsonError={workflowJsonError}
                    setWorkflowJsonError={setWorkflowJsonError}
                    closeWorkflowProperties={closeWorkflowProperties}
                    traceExecutionId={traceExecutionId}
                    setTraceExecutionId={setTraceExecutionId}
                    runtimeTraces={runtimeTraces}
                    workflowRuntimeExpanded={workflowRuntimeExpanded}
                    setWorkflowRuntimeExpanded={setWorkflowRuntimeExpanded}
                    loadRuntimeTraces={loadRuntimeTraces}
                  />
                  {canEditAi && (
                    <div className="d-flex justify-content-end gap-2 border-top pt-3 mt-3">
                      <Button
                        variant="primary"
                        type="submit"
                        className="fw-bold rounded-pill"
                        disabled={aiEngineConfigLoading}
                      >
                        <Save size={16} className="me-2" /> Guardar IA
                      </Button>
                    </div>
                  )}
                </Form>
              </Card>
            </div>
          )}

          {/* TAB 3: INTEGRACIONES */}
          {configTab === 'integrations' && (
            <IntegrationsSettingsTab
              setActiveTab={setActiveTab}
              setConfigTab={setConfigTab}
              hasSystemFeature={hasSystemFeature}
              fetchWithAuth={fetchWithAuth}
              showFeedback={showFeedback}
              canAccessCapability={canAccessCapability}
            />
          )}

          {configTab === 'monitor' && (
            <SystemMonitorTab
              fetchWithAuth={fetchWithAuth}
              showFeedback={showFeedback as any}
              copyToClipboard={copyToClipboard}
            />
          )}

          {configTab === 'audit' && !hasSystemFeature('audit.advanced') && (
            <PremiumLockedSettingsPanel
              title="Auditoria avanzada y seguridad"
              description="Consulta eventos globales de acciones sensibles, cambios de configuracion, accesos y operaciones auditadas desde un panel central."
              bullets={[
                'Tabla de eventos recientes con filtros por accion, recurso, actor e IP.',
                'Detalle JSON sanitizado para soporte, seguridad y compliance.',
                'Exportacion de eventos filtrados para revision externa o evidencia.',
              ]}
              onOpenLicense={() => setConfigTab('license')}
            />
          )}

          {configTab === 'audit' && hasSystemFeature('audit.advanced') && (
            <AuditSettingsTab
              fetchWithAuth={fetchWithAuth}
              showFeedback={showFeedback}
            />
          )}

          {configTab === 'license' && (
            <LicenseSettingsTab
              fetchWithAuth={fetchWithAuth}
              showFeedback={showFeedback}
              canEditLicense={canAccessCapability('configuracion.licencia', 'edit')}
              selectedOrganizationId={selectedOrganizationId}
            />
          )}

          {configTab === 'updates' && (
            <UpdatesSettingsTab
              fetchWithAuth={fetchWithAuth}
              showFeedback={showFeedback}
              canApplyUpdates={canAccessCapability('configuracion.actualizaciones', 'edit')}
            />
          )}
        </div>
      </div>
    </div>

    <AiAgentPromptModal
      promptAgentIndex={promptAgentIndex}
      promptAgent={promptAgent}
      canEditAi={canEditAi}
      agentActionOptions={agentActionOptions}
      setPromptAgentIndex={setPromptAgentIndex}
      updateAgentWorkflowItem={updateAgentWorkflowItem}
      restoreAgentPrompt={restoreAgentPrompt}
    />
    </>

  )
}
