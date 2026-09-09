// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IncidentCenterPage } from './IncidentCenterPage'

vi.mock('../../i18n', () => {
  const t = (key: string) => key
  return { useI18n: () => ({ t }) }
})
vi.mock('../../EvidenceUpload', () => ({ EvidenceUpload: () => null }))
afterEach(cleanup)

describe('incident report deep links', () => {
  it('opens the exact bug even when it is absent from the inbox page', async () => {
    const bug = { id: 'linked-bug', codigo: 'BUG-21', titulo: 'Fallo del informe', estado: 'ABIERTO', tipo_contexto: 'CLASICO' }
    let finishInbox: (value: Response) => void = () => {}
    const inbox = new Promise<Response>(resolve => { finishInbox = resolve })
    const fetchWithAuth = vi.fn(async (url: string) => {
      if (url.includes('/incidencias/centro/')) return inbox
      return Response.json(url.endsWith('/bugs/linked-bug/') ? bug : [])
    })
    const consumed = vi.fn()
    render(<IncidentCenterPage builds={[]} deepLinkBugId="linked-bug" onDeepLinkConsumed={consumed} fetchWithAuth={fetchWithAuth} canAccessCapability={() => false} />)
    await screen.findByText('Fallo del informe')
    finishInbox(Response.json({ items: [], total: 0 }))
    await waitFor(() => expect(consumed).toHaveBeenCalledOnce())
    expect(screen.getByText('Fallo del informe')).toBeTruthy()
    expect(fetchWithAuth.mock.calls.some(([url]) => url.endsWith('/bugs/linked-bug/history/'))).toBe(true)
  })

  it.each([403, 404])('reports HTTP %s without opening a bug', async status => {
    const fetchWithAuth = vi.fn(async (url: string) => url.includes('/incidencias/centro/')
      ? Response.json({ items: [], total: 0 })
      : Response.json({ detail: 'No disponible' }, { status }))
    const consumed = vi.fn()
    render(<IncidentCenterPage builds={[]} deepLinkBugId="missing" onDeepLinkConsumed={consumed} fetchWithAuth={fetchWithAuth} canAccessCapability={() => false} />)
    await screen.findByText(new RegExp(`\\(${status}\\): No disponible`))
    expect(consumed).toHaveBeenCalledOnce()
    expect(fetchWithAuth.mock.calls.some(([url]) => url.includes('/history/'))).toBe(false)
  })
})
