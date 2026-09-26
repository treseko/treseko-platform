import { Card } from 'react-bootstrap'
import { useI18n } from '../../../../i18n'
import { ApiKeyPanel } from '../ApiKeyPanel'

type Props = {
  apiKeys: any[]
  apiKeysLoading: boolean
  apiKeyName: string
  newApiKeyValue: string
  setApiKeyName: (value: string) => void
  createUserApiKey: () => void
  revokeUserApiKey: (id: string) => void
  setUserApiKeyState: (id: string, estado: 'ACTIVE' | 'PAUSED') => void
  copyToClipboard: (text: string, label?: string) => void
}

export function ApiKeysSettingsTab(props: Props) {
  const { t } = useI18n()
  return (
    <div className="animate__animated animate__fadeIn">
      <Card className="border-0 shadow-sm rounded-4 bg-white p-4">
        <h5 className="fw-bold text-dark mb-1">{t('configuracion.apiKeysSectionTitle')}</h5>
        <p className="small text-muted mb-0">{t('configuracion.apiKeysSectionDesc')}</p>
      </Card>
      <ApiKeyPanel {...props} />
    </div>
  )
}
