// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../i18n'
import { McpSettingsSection, shouldShowMcpPanel } from './McpSettingsSection'

afterEach(cleanup)

const props = {
  canAccessCapability: (capability: string, level?: string) => capability === 'mcp.usar' && level === 'read',
  canEdit: false,
  tools: [],
  credentials: [],
  loading: false,
  error: null,
  rawCredential: null,
  copyToClipboard: vi.fn(),
  onCreate: vi.fn(),
  onRevoke: vi.fn(),
}

describe('McpSettingsSection', () => {
  it('uses the MCP read capability to decide visibility', () => {
    expect(shouldShowMcpPanel(props.canAccessCapability)).toBe(true)
    expect(shouldShowMcpPanel(() => false)).toBe(false)
  })

  it('renders the MCP panel for users who can read API keys', () => {
    render(<I18nProvider><McpSettingsSection {...props} /></I18nProvider>)
    expect(screen.getByText('Configuración MCP')).toBeTruthy()
  })

  it('does not render the MCP panel without the MCP read capability', () => {
    render(<I18nProvider><McpSettingsSection {...props} canAccessCapability={() => false} /></I18nProvider>)
    expect(screen.queryByText('Configuración MCP')).toBeNull()
  })
})
