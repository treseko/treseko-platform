import { Card } from 'react-bootstrap'
import { useI18n } from '../../../../i18n'
import { McpSettingsSection } from '../McpSettingsSection'

type Props = {
  canAccessCapability: (capabilityId: any, level?: any) => boolean
  mcpTools: any[]
  mcpCredentials: any[]
  mcpLoading: boolean
  mcpError: string | null
  mcpRawCredential: string | null
  mcpEnabled: boolean
  mcpStatus: 'available' | 'disabled'
  mcpEndpoint: string
  mcpScopeCatalog: import('../../api/configuracionApi').McpScope[]
  mcpEffectiveCapabilities: Record<string, 'read' | 'edit'>
  dismissMcpRawCredential: () => void
  createMcpCredential: (name: string, scopes: string[], expiresAt?: string) => void
  revokeMcpCredential: (credential: any) => void
  toggleMcp: (enabled: boolean) => void
  copyToClipboard: (text: string, label?: string) => void
}

export function McpSettingsTab({ canAccessCapability, ...props }: Props) {
  const { t } = useI18n()
  return (
    <div className="animate__animated animate__fadeIn">
      <Card className="border-0 shadow-sm rounded-4 bg-white p-4">
        <h5 className="fw-bold text-dark mb-1">{t('configuracion.mcpSectionTitle')}</h5>
        <p className="small text-muted mb-0">{t('configuracion.mcpSectionDesc')}</p>
      </Card>
      <McpSettingsSection
        canAccessCapability={canAccessCapability}
        canEdit={canAccessCapability('mcp.usar', 'edit')}
        enabled={props.mcpEnabled}
        status={props.mcpStatus}
        endpoint={props.mcpEndpoint}
        scopeCatalog={props.mcpScopeCatalog}
        effectiveCapabilities={props.mcpEffectiveCapabilities}
        tools={props.mcpTools}
        credentials={props.mcpCredentials}
        loading={props.mcpLoading}
        error={props.mcpError}
        rawCredential={props.mcpRawCredential}
        onDismissRawCredential={props.dismissMcpRawCredential}
        copyToClipboard={props.copyToClipboard}
        onCreate={props.createMcpCredential}
        onRevoke={props.revokeMcpCredential}
        onToggle={props.toggleMcp}
      />
    </div>
  )
}
