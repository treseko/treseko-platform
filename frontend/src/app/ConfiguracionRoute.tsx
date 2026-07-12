import { ConfiguracionPage } from '../features/configuracion/ConfiguracionPage'
import type { AiEngineConfigState } from '../features/configuracion/hooks/useAiEngineConfig'
import type { AdminUserRolesConfigState } from '../features/configuracion/hooks/useAdminUserRolesConfig'
import type { GeneralConfigurationState } from '../features/configuracion/hooks/useGeneralConfiguration'
import type { SessionConfigState } from '../features/configuracion/hooks/useSessionConfig'
import type { BrandingState } from './branding'

type ConfiguracionRouteProps = {
  configTab: string
  setConfigTab: (tab: any) => void
  canAccessModule: (moduleId: any, level?: any) => boolean
  canAccessCapability: (capabilityId: any, level?: any) => boolean
  hasSystemFeature: (featureId: string) => boolean
  showFeedback: (title: string, message: string, variant?: string) => void
  generalConfiguration: GeneralConfigurationState
  sessionConfiguration: SessionConfigState
  aiEngineConfiguration: AiEngineConfigState
  adminUserRolesConfiguration: AdminUserRolesConfigState
  organizations: any[]
  projectsList: any[]
  selectedOrganizationId: string | null
  setSelectedOrganizationId: (id: string) => void
  handleCreateOrganization: (event: any) => void
  handleUpdateOrganization: (event: any, orgId: string) => void
  handleSetOrganizationActive: (orgId: string, active: boolean) => Promise<any>
  loadOrganizationsFromBackend: (options?: { includeInactive?: boolean }) => Promise<any[]>
  organizationMembers: any[]
  organizationMemberForm: any
  setOrganizationMemberForm: (form: any) => void
  handleAssignOrganizationMember: (event: any) => void
  handleRemoveOrganizationMember: (userId: string) => void
  loggedUser: any
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  onLoggedUserUpdated: (user: any) => void
  onBrandingUpdated: (branding: BrandingState) => void
  setActiveTab: (tab: any) => void
  onOpenIaScheduler: () => void
}

export function ConfiguracionRoute({
  configTab,
  setConfigTab,
  canAccessModule,
  canAccessCapability,
  hasSystemFeature,
  showFeedback,
  generalConfiguration,
  sessionConfiguration,
  aiEngineConfiguration,
  adminUserRolesConfiguration,
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
  handleAssignOrganizationMember,
  handleRemoveOrganizationMember,
  loggedUser,
  fetchWithAuth,
  onLoggedUserUpdated,
  onBrandingUpdated,
  setActiveTab,
  onOpenIaScheduler,
}: ConfiguracionRouteProps) {
  return (
    <ConfiguracionPage
      configTab={configTab}
      setConfigTab={setConfigTab}
      canAccessModule={canAccessModule}
      canAccessCapability={canAccessCapability}
      hasSystemFeature={hasSystemFeature}
      showFeedback={showFeedback}
      apiKeys={generalConfiguration.apiKeys}
      apiKeysLoading={generalConfiguration.apiKeysLoading}
      apiKeyName={generalConfiguration.apiKeyName}
      newApiKeyValue={generalConfiguration.newApiKeyValue}
      setApiKeyName={generalConfiguration.setApiKeyName}
      createUserApiKey={generalConfiguration.createUserApiKey}
      revokeUserApiKey={generalConfiguration.revokeUserApiKey}
      handleApiKeyEnabledChange={generalConfiguration.handleApiKeyEnabledChange}
      copyToClipboard={generalConfiguration.copyToClipboard}
      attachmentConfig={generalConfiguration.attachmentConfig}
      setAttachmentConfig={generalConfiguration.setAttachmentConfig}
      attachmentConfigLoading={generalConfiguration.attachmentConfigLoading}
      saveAttachmentConfig={generalConfiguration.saveAttachmentConfig}
      sessionConfig={sessionConfiguration.sessionConfig}
      setSessionConfig={sessionConfiguration.setSessionConfig}
      sessionConfigLoading={sessionConfiguration.sessionConfigLoading}
      saveSessionConfig={sessionConfiguration.saveSessionConfig}
      aiEngineConfig={aiEngineConfiguration.aiEngineConfig}
      setAiEngineConfig={aiEngineConfiguration.setAiEngineConfig}
      aiEngineConfigLoading={aiEngineConfiguration.aiEngineConfigLoading}
      aiEngineHealth={aiEngineConfiguration.aiEngineHealth}
      saveAiEngineConfig={aiEngineConfiguration.saveAiEngineConfig}
      checkAiEngineHealth={aiEngineConfiguration.checkAiEngineHealth}
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
      assignableUsers={adminUserRolesConfiguration.assignableUsers}
      handleAssignOrganizationMember={handleAssignOrganizationMember}
      handleRemoveOrganizationMember={handleRemoveOrganizationMember}
      adConfig={adminUserRolesConfiguration.adConfig}
      setAdConfig={adminUserRolesConfiguration.setAdConfig}
      appUsers={adminUserRolesConfiguration.appUsers}
      openUserModal={adminUserRolesConfiguration.openUserModal}
      handleDeactivateUser={adminUserRolesConfiguration.handleDeactivateUser}
      loadUsersFromBackend={adminUserRolesConfiguration.loadUsersFromBackend}
      loggedUser={loggedUser}
      fetchWithAuth={fetchWithAuth}
      onLoggedUserUpdated={onLoggedUserUpdated}
      onBrandingUpdated={onBrandingUpdated}
      systemRoleItems={adminUserRolesConfiguration.systemRoleItems}
      customRoles={adminUserRolesConfiguration.customRoles}
      openRoleModal={adminUserRolesConfiguration.openRoleModal}
      handleDeactivateRole={adminUserRolesConfiguration.handleDeactivateRole}
      setActiveTab={setActiveTab}
      onOpenIaScheduler={onOpenIaScheduler}
    />
  )
}
