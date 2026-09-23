import type { ComponentProps } from 'react'
import { McpPanel } from './McpPanel'

type CapabilityReader = (capabilityId: any, level?: any) => boolean

type Props = Omit<ComponentProps<typeof McpPanel>, 'canEdit'> & {
  canAccessCapability: CapabilityReader
  canEdit: boolean
}

export function shouldShowMcpPanel(canAccessCapability: CapabilityReader) {
  return canAccessCapability('mcp.usar', 'read')
}

export function McpSettingsSection({ canAccessCapability, canEdit, ...panelProps }: Props) {
  if (!shouldShowMcpPanel(canAccessCapability)) return null
  return <McpPanel {...panelProps} canEdit={canEdit} />
}
