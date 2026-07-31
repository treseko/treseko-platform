import { Fragment, useEffect, useMemo, useState } from 'react'
import { Nav, Card, Badge, Form, Button, Table, Dropdown } from 'react-bootstrap'
import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Settings, Building2, Users, ShieldCheck, Link, Sliders, Save, Plus, RotateCcw, Copy, Upload, Download, Archive, Flag, Activity, User, Cpu, MoreHorizontal, BadgeCheck, Mail, Crown, DownloadCloud, ClipboardCheck } from 'lucide-react'
import { useI18n, createLocaleFormatter } from '../../../i18n'
import { AiSettingsSection } from '../components/tabs/AiSettingsSection'
import { AuditSettingsTab } from '../components/tabs/AuditSettingsTab'
import { GeneralSettingsTab } from '../components/tabs/GeneralSettingsTab'
import { IntegrationsSettingsTab } from '../components/tabs/IntegrationsSettingsTab'
import { OrganizationsSettingsTab } from '../components/tabs/OrganizationsSettingsTab'
import { LicenseSettingsTab } from '../components/tabs/LicenseSettingsTab'
import { NotificationsSettingsTab } from '../components/tabs/NotificationsSettingsTab'
import { ProfileSettingsTab } from '../components/tabs/ProfileSettingsTab'
import { RolesSettingsTab, UsersSettingsTab } from '../components/tabs/UsersRolesSettingsTab'
import { SystemMonitorTab } from '../components/tabs/SystemMonitorTab'
import { UpdatesSettingsTab } from '../components/tabs/UpdatesSettingsTab'
import { useAttachmentMimeOptions } from '../hooks/useAttachmentMimeOptions'
import { useProfileSettings } from '../hooks/useProfileSettings'
import type { ConfiguracionPageProps } from '../types/configuracion'
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
  const { t } = useI18n()
  return (
    <div className="animate__animated animate__fadeIn">
      <Card className="border-0 shadow-sm rounded-4 bg-white p-4">
        <div className="d-flex flex-column flex-md-row justify-content-between align-items-start gap-3">
          <div>
            <Badge bg="warning" text="dark" className="border mb-3 d-inline-flex align-items-center gap-1">
              <Crown size={14} /> {t('configuracion.premiumBadge')}
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
            {t('configuracion.premiumLockedViewLicense')}
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
  onPreferencesUpdated,
  onBrandingUpdated,
  systemRoleItems,
  customRoles,
  openRoleModal,
  handleDeactivateRole,
  setActiveTab,
  onOpenIaScheduler,
}: ConfiguracionPageProps) {
  const { t, locale } = useI18n()
  const f = useMemo(() => createLocaleFormatter(locale), [locale])
  const hasAiEngineAccess = hasSystemFeature('ai.engine') || hasSystemFeature('ai.basic_execution')
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
      { id: 'general', visible: canAccessCapability('configuracion.preferencias', 'read'), label: t('configuracion.tabGeneral'), icon: Settings },
      { id: 'profile', visible: canAccessCapability('configuracion.perfil', 'read'), label: t('configuracion.tabProfile'), icon: User },
      { id: 'clients', visible: canAccessCapability('configuracion.clientes', 'read'), label: t('configuracion.tabClients'), icon: Building2 },
      { id: 'users', visible: canAccessCapability('configuracion.usuarios', 'read'), label: t('configuracion.tabUsers'), icon: Users },
      { id: 'roles', visible: canAccessCapability('configuracion.roles', 'read'), label: t('configuracion.tabRoles'), icon: ShieldCheck },
      { id: 'notifications', visible: canAccessNotifications, label: t('configuracion.tabNotifications'), icon: Mail },
      { id: 'integrations', visible: canAccessCapability('configuracion.integraciones', 'read'), label: t('configuracion.tabIntegrations'), icon: Link },
      { id: 'ai', visible: canAccessCapability('configuracion.pruebas_ia', 'read'), label: t('configuracion.tabAi'), icon: Cpu },
      { id: 'monitor', visible: canAccessCapability('configuracion.monitor', 'read'), label: t('configuracion.tabMonitor'), icon: Activity },
      { id: 'audit', visible: canAccessCapability('configuracion.monitor', 'read'), label: t('configuracion.tabAudit'), icon: ClipboardCheck },
      { id: 'license', visible: canAccessCapability('configuracion.licencia', 'read'), label: t('configuracion.tabLicense'), icon: BadgeCheck },
      { id: 'updates', visible: canAccessCapability('configuracion.actualizaciones', 'read'), label: t('configuracion.tabUpdates'), icon: DownloadCloud },
    ].filter(tab => tab.visible)
  }, [canAccessCapability, hasSystemFeature, t])

  useEffect(() => {
    if (visibleConfigTabs.length > 0 && !visibleConfigTabs.some(tab => tab.id === configTab)) {
      setConfigTab(visibleConfigTabs[0].id)
    }
  }, [configTab, setConfigTab, visibleConfigTabs])

  const { profileDraft, setProfileDraft, saveMyProfile, saveLanguage } = useProfileSettings({
    loggedUser,
    fetchWithAuth,
    onLoggedUserUpdated,
    onPreferencesUpdated,
    showFeedback,
    t,
  })
  const { attachmentMimeGroups, toggleAttachmentMime } = useAttachmentMimeOptions({
    attachmentConfig,
    setAttachmentConfig,
  })
  return (
    <>
    <div className="config-page d-flex flex-column h-100 overflow-hidden bg-light text-dark">

      {/* Header Configuracion */}
      <div className="p-4 border-bottom bg-white d-flex align-items-center gap-3 flex-shrink-0 shadow-sm z-1">
        <Sliders size={28} className="text-primary flex-shrink-0" aria-hidden="true" />
        <div>
          <h4 className="fw-bold m-0 text-dark">{t('configuracion.pageTitle')}</h4>
          <span className="text-muted small">{t('configuracion.pageSubtitle')}</span>
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
              saveLanguage={saveLanguage}
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
              projects={projectsList}
            />
          )}

          {configTab === 'notifications' && !hasSystemFeature('notifications.email') && (
            <PremiumLockedSettingsPanel
              title={t('configuracion.notificationsPremiumTitle')}
              description={t('configuracion.notificationsPremiumDesc')}
              bullets={[
                t('configuracion.notificationsPremiumBullet1'),
                t('configuracion.notificationsPremiumBullet2'),
                t('configuracion.notificationsPremiumBullet3'),
              ]}
              onOpenLicense={() => setConfigTab('license')}
            />
          )}


          <AiSettingsSection
            configTab={configTab}
            hasAiEngineAccess={hasAiEngineAccess}
            canAccessModule={canAccessModule}
            canAccessCapability={canAccessCapability}
            aiEngineConfig={aiEngineConfig}
            setAiEngineConfig={setAiEngineConfig}
            aiEngineConfigLoading={aiEngineConfigLoading}
            aiEngineHealth={aiEngineHealth}
            checkAiEngineHealth={checkAiEngineHealth}
            saveAiEngineConfig={saveAiEngineConfig}
            fetchWithAuth={fetchWithAuth}
            showFeedback={showFeedback}
            t={t}
            onOpenIaScheduler={onOpenIaScheduler}
            setActiveTab={setActiveTab}
          />

          {/* TAB 3: INTEGRACIONES */}
          {configTab === 'integrations' && (
            <IntegrationsSettingsTab
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
              title={t('configuracion.auditPremiumTitle')}
              description={t('configuracion.auditPremiumDesc')}
              bullets={[
                t('configuracion.auditPremiumBullet1'),
                t('configuracion.auditPremiumBullet2'),
                t('configuracion.auditPremiumBullet3'),
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

    </>

  )
}
