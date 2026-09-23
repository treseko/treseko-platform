// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../i18n'
import { McpPanel } from './McpPanel'

afterEach(cleanup)

const tool = { name: 'treseko.project.get', description: 'Project metadata', required_scope: 'mcp.projects.read', capability: 'proyectos.portfolio', read_only: true, operation: 'read' }
const credential = { id: 'cred-1', nombre: 'CI', key_prefix: 'mcp_123456', activo: true, fecha_creacion: '2026-01-01T00:00:00Z', scopes_json: ['mcp.projects.read'], purpose: 'mcp' as const }
const base = { fetchWithAuth: vi.fn(), copyToClipboard: vi.fn(), confirmAction: vi.fn(), showFeedback: vi.fn() }

function renderPanel(overrides: Partial<React.ComponentProps<typeof McpPanel>> = {}) {
  return render(<I18nProvider><McpPanel canEdit={false} tools={[tool]} credentials={[credential]} loading={false} error={null} rawCredential={null} onCreate={vi.fn()} onRevoke={vi.fn()} {...base} {...overrides} /></I18nProvider>)
}

describe('McpPanel', () => {
  it('shows endpoint, tools, required capability and scope without raw keys', () => {
    renderPanel()
    expect(screen.getByText('/api/mcp')).toBeTruthy()
    expect(screen.getByText('treseko.project.get')).toBeTruthy()
    expect(screen.getAllByText('mcp.projects.read').length).toBeGreaterThan(0)
    expect(screen.getByText('proyectos.portfolio')).toBeTruthy()
    expect(screen.queryByText(/mcp_[A-Za-z0-9]{20,}/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Crear/i })).toBeNull()
  })

  it('marks tools whose scope is visible but not selectable for this user', () => {
    renderPanel({ scopeCatalog: [{ scope: 'mcp.projects.read', user_level: 'none', selectable: false, tools: [{ name: tool.name, capability: tool.capability, required_level: 'read', operation: 'read' }] }] })
    fireEvent.click(screen.getByText('Herramientas disponibles'))
    expect(screen.getByText('No autorizada para tu usuario')).toBeTruthy()
  })

  it('hides credential mutations while MCP is disabled', () => {
    renderPanel({ canEdit: true, enabled: false, status: 'disabled' })
    expect(screen.queryByRole('button', { name: /Crear/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Revocar/i })).toBeNull()
    expect(screen.getAllByText(/deshabilitado/i).length).toBeGreaterThan(0)
  })

  it('exposes governed import scopes with explicit write labels and deny-by-default', () => {
    renderPanel({ canEdit: true })
    const permissions = screen.getByTestId('mcp-import-permissions')
    expect(permissions).toBeTruthy()
    expect(permissions.querySelector('code')?.textContent).toBe('mcp.cases.import.preview')
    expect(permissions.textContent).toContain('mcp.cases.import.commit')
    expect(permissions.textContent).toContain('mcp.cases.import.rollback')
    expect(screen.getAllByText(/escritura explícita/i)).toHaveLength(2)
    expect(screen.getByText(/Denegado por defecto/i)).toBeTruthy()
  })

  it('keeps import permission labels visible in read-only mode without mutation controls', () => {
    renderPanel()
    expect(screen.getByTestId('mcp-import-permissions')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Crear/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Revocar/i })).toBeNull()
  })

  it('keeps scope checkboxes outside accordion header buttons', async () => {
    renderPanel({ canEdit: true, scopeCatalog: [{ scope: 'mcp.projects.read', user_level: 'read', selectable: true, tools: [{ name: tool.name, capability: tool.capability, required_level: 'read', operation: 'read' }] }] })
    screen.getByRole('button', { name: /Crear credencial/i }).click()
    await waitFor(() => {
      const checkbox = screen.getByRole('checkbox', { name: /mcp.projects.read/i })
      expect(checkbox.closest('button')).toBeNull()
    })
  })

  it('shows one-time secret only through the acknowledged flow', () => {
    const onDismissRawCredential = vi.fn()
    renderPanel({ canEdit: true, rawCredential: 'mcp_secret_once', onDismissRawCredential })
    expect(screen.getByText('mcp_secret_once')).toBeTruthy()
    expect(screen.getByText(/solo se mostrará una vez/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Copiar/i })).toBeTruthy()
    screen.getByRole('button', { name: /Entendido|Ocultar/i }).click()
    expect(onDismissRawCredential).toHaveBeenCalledOnce()
  })

  it('never renders a raw credential while MCP is disabled', () => {
    renderPanel({ canEdit: true, enabled: false, status: 'disabled', rawCredential: 'mcp_secret_disabled' })
    expect(screen.queryByText('mcp_secret_disabled')).toBeNull()
    expect(screen.queryByRole('button', { name: /Copiar/i })).toBeNull()
  })
})
