// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMcpConfiguration } from './useMcpConfiguration'
import type { McpConfiguration, McpCredentialCreated } from '../api/configuracionApi'
import * as api from '../api/configuracionApi'

vi.mock('../api/configuracionApi', async () => {
  const actual = await vi.importActual<typeof import('../api/configuracionApi')>('../api/configuracionApi')
  return { ...actual, createMcpCredential: vi.fn(), fetchMcpConfiguration: vi.fn(), listMcpCredentials: vi.fn() }
})

afterEach(() => vi.restoreAllMocks())

const configuration = (enabled: boolean): McpConfiguration => ({
  enabled,
  status: enabled ? 'available' : 'disabled',
  endpoint: '/api/mcp',
  protocol_version: '2025-03-26',
  authentication: { header: 'Authorization', browser_session: true },
  tools: [],
})

const created: McpCredentialCreated = {
  id: 'cred-1', nombre: 'CI', key_prefix: 'mcp_123', activo: true,
  fecha_creacion: '2026-01-01T00:00:00Z', scopes_json: ['mcp.projects.read'], purpose: 'mcp', api_key: 'mcp_secret_once',
}

function setup() {
  const t = (key: string) => key
  const fetchWithAuth = vi.fn()
  const confirmAction = vi.fn()
  const showFeedback = vi.fn()
  return renderHook(() => useMcpConfiguration({
    isAuthenticated: true, fetchWithAuth, canRead: true, canEdit: true,
    confirmAction, showFeedback, t,
  }))
}

describe('useMcpConfiguration credential lifecycle', () => {
  it('does not commit an in-flight credential after MCP is disabled', async () => {
    vi.mocked(api.fetchMcpConfiguration).mockResolvedValueOnce(configuration(true)).mockResolvedValueOnce(configuration(false))
    vi.mocked(api.listMcpCredentials).mockResolvedValue([])
    let resolveCreate!: (credential: McpCredentialCreated) => void
    const createPromise = new Promise<McpCredentialCreated>(resolve => { resolveCreate = resolve })
    vi.mocked(api.createMcpCredential).mockReturnValue(createPromise)
    const { result } = setup()
    await waitFor(() => expect(result.current.enabled).toBe(true))

    act(() => { void result.current.create('CI', ['mcp.projects.read']) })
    await waitFor(() => expect(api.createMcpCredential).toHaveBeenCalledOnce())
    await act(async () => { await result.current.load() })
    expect(result.current.enabled).toBe(false)

    resolveCreate(created)
    await act(async () => { await Promise.resolve() })
    expect(result.current.rawCredential).toBeNull()
    expect(result.current.credentials).toEqual([])
  })

  it('does not commit an in-flight credential after unmount', async () => {
    vi.mocked(api.fetchMcpConfiguration).mockResolvedValue(configuration(true))
    vi.mocked(api.listMcpCredentials).mockResolvedValue([])
    let resolveCreate!: (credential: McpCredentialCreated) => void
    vi.mocked(api.createMcpCredential).mockReturnValue(new Promise(resolve => { resolveCreate = resolve }))
    const { result, unmount } = setup()
    await waitFor(() => expect(result.current.enabled).toBe(true))

    act(() => { void result.current.create('CI', ['mcp.projects.read']) })
    await waitFor(() => expect(api.createMcpCredential).toHaveBeenCalledOnce())
    unmount()
    resolveCreate(created)
    await act(async () => { await Promise.resolve() })
    expect(result.current.rawCredential).toBeNull()
  })
})
