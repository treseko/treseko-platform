import { Card } from 'react-bootstrap'
import { useI18n } from '../../../../i18n'
import { SessionSettingsTab } from './SessionSettingsTab'
import { ActiveDirectorySettingsTab } from './ActiveDirectorySettingsTab'

type Props = {
  sessionConfig: any
  setSessionConfig: (config: any) => void
  sessionConfigLoading: boolean
  saveSessionConfig: (config: any) => void
  canEditSession: boolean
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
  canAccessCapability: (capabilityId: any, level?: any) => boolean
  hasSystemFeature: (featureId: string) => boolean
}

export function SecuritySettingsTab({
  sessionConfig,
  setSessionConfig,
  sessionConfigLoading,
  saveSessionConfig,
  canEditSession,
  fetchWithAuth,
  showFeedback,
  canAccessCapability,
  hasSystemFeature,
}: Props) {
  const { t } = useI18n()
  const canReadIdentity = canAccessCapability('configuracion.sesion', 'read')

  return (
    <div className="animate__animated animate__fadeIn">
      <Card className="border-0 shadow-sm rounded-4 bg-white p-4">
        <h5 className="fw-bold text-dark mb-1">{t('configuracion.securitySectionTitle')}</h5>
        <p className="small text-muted mb-0">{t('configuracion.securitySectionDesc')}</p>
      </Card>
      <SessionSettingsTab
        sessionConfig={sessionConfig}
        setSessionConfig={setSessionConfig}
        sessionConfigLoading={sessionConfigLoading}
        saveSessionConfig={saveSessionConfig}
        canEditSession={canEditSession}
      />
      {canReadIdentity && hasSystemFeature('auth.sso') && (
        <ActiveDirectorySettingsTab
          fetchWithAuth={fetchWithAuth}
          showFeedback={showFeedback}
          canAccessCapability={canAccessCapability}
        />
      )}
    </div>
  )
}
