import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HistoryFormatEvidence } from './HistoryFormatEvidence'
import { RunDetailModal } from './RunDetailModal'
import { HistorialRunsPage } from './pages/HistorialRunsPage'
import { HistorialRunsTable } from './components/HistorialRunsTable'
vi.mock('../../i18n', () => { const t = (key: string, values?: Record<string, any>) => `${key}${values ? ' ' + Object.values(values).join(' ') : ''}`; return { useI18n: () => ({ t }) } })
afterEach(cleanup)

it('shows the timing of each API request and the execution total separately', () => {
  render(<HistoryFormatEvidence caso={{ formato_prueba: 'API', api_resultado: { duration_ms: 46, steps: [12, 34].map(total_ms => ({ request: { method: 'GET', url: 'https://example.invalid' }, response: { status: 200, timings: { total_ms } }, assertions: [] })) } }} />)
  expect(screen.getByText('HTTP 200 · 12 ms')).toBeTruthy()
  expect(screen.getByText('HTTP 200 · 34 ms')).toBeTruthy()
  expect(screen.getByText('historial.totalDuration: 46 ms')).toBeTruthy()
  expect(screen.queryByText('HTTP 200 · 46 ms')).toBeNull()
})
it('does not substitute the total when request timing is unavailable', () => {
  render(<HistoryFormatEvidence caso={{ formato_prueba: 'API', api_resultado: { duration_ms: 46, steps: [{ response: { status: 500 } }] } }} />)
  expect(screen.getByText('HTTP 500 · - ms')).toBeTruthy()
})
it('opens all six persisted URL captures from the detail and hides them without evidence permission', () => {
  const onOpenEvidence = vi.fn()
  const detail = { id: 'r1', casos: [{ id: 'e1', formato_prueba: 'CLASICA', titulo: 'Pago', snapshots: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, numero_paso: i+1, evidencias: [{ id: `url${i}`, public_url: `https://example.invalid/${i}.png`, content_type: 'image/png', filename_original: `Captura ${i+1}`, available: true }] })) }] }
  const props = { detail, detailLoading: false, detailError: '', getStatusColor: () => 'success', onHide: vi.fn(), onOpenEvidence }
  const { rerender } = render(<RunDetailModal {...props} />)
  for (let i=1; i<=6; i++) fireEvent.click(screen.getByRole('button', { name: `Captura ${i}` }))
  expect(onOpenEvidence.mock.calls.map(([item]) => item.public_url)).toEqual(Array.from({ length: 6 }, (_, i) => `https://example.invalid/${i}.png`))
  rerender(<RunDetailModal {...props} canViewEvidence={false} />)
  expect(screen.queryByRole('button', { name: 'Captura 1' })).toBeNull()
})
it('shows running results and counts separately from not-run cases', () => {
  render(<HistorialRunsTable runs={[{ id: 'r1', runId: 'Run IA', status: 'running', passed: 0, failed: 0, blocked: 0, pending: 0, running: 1 }]} getStatusColor={() => 'success'} onOpenEvidence={vi.fn()} onOpenRunDetail={vi.fn()} />)
  expect(screen.getAllByText('historial.inProgress')).toHaveLength(2)
  expect(screen.getAllByText('historial.runningCount 1')).toHaveLength(2)
  expect(screen.queryByText('historial.notRun')).toBeNull()
})
it.each([{ server: false, denied: '', expected: false }, { server: true, denied: 'bugs.crear', expected: false }, { server: true, denied: 'bugs.ver', expected: false }, { server: true, denied: '', expected: true }])('gates conversational bug actions for $server / $denied', async ({ server, denied, expected }) => {
  const fetchWithAuth = vi.fn(async (_url: string, _options?: RequestInit) => Response.json({ codigo: 'BUG-1' }))
  const detail = { id: 'r1', can_create_bug: server, casos: [{ id: 'e1', caso_id: 'c1', titulo: 'Chatbot', formato_prueba: 'CONVERSACIONAL', execution_mode: 'IA', estado: 'FALLO', has_ai_report: true, ai_report: { status: 'FAILED' }, chatbot_resultado: { turns: [] } }] }
  render(<RunDetailModal detail={detail} detailLoading={false} detailError="" getStatusColor={() => 'danger'} onHide={vi.fn()} onOpenEvidence={vi.fn()} fetchWithAuth={fetchWithAuth} canAccessCapability={key => key !== denied} />)
  fireEvent.click(screen.getByRole('button', { name: 'historial.viewAiReport' }))
  const button = screen.queryByRole('button', { name: 'motorIa.createConversationalBug' })
  expect(Boolean(button)).toBe(expected)
  if (expected) { fireEvent.click(button!); await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledTimes(1)); expect(fetchWithAuth.mock.calls[0]?.[0]).toContain('/ejecuciones/e1/bugs/') }
  else expect(fetchWithAuth).not.toHaveBeenCalled()
})
it('keeps collapsed advanced filters visible as removable tags and restores them expanded', () => {
  const load = vi.fn(async () => {})
  render(<HistorialRunsPage currentProjectId="project" currentProjectRunHistory={[]} getStatusColor={() => 'success'} onOpenEvidence={vi.fn()} buildsList={[]} componentsList={[]} environments={[]} appUsers={[]} initialFilters={{}} pendingRunDetailId="" onPendingRunDetailConsumed={vi.fn()} onLoadHistory={load} onLoadRunDetail={vi.fn()} historyState={{ filters: { case_code: 'ABC-123', status: 'FALLO', run_result: 'FALLO' }, skip: 25, limit: 25, total: 63 }} />)
  expect(screen.getByRole('button', { name: 'historial.fewerFilters (1)' }).getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'historial.fewerFilters (1)' }))
  expect(screen.getByText('historial.exactCode: ABC-123')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'historial.removeFilter historial.exactCode: ABC-123' }))
  expect(load).toHaveBeenCalledWith({ case_code: '', status: 'FALLO', run_result: 'FALLO', skip: 0, limit: 25 })
  expect(screen.getByRole('combobox', { name: 'historial.caseStatus' })).toBeTruthy()
  expect(screen.getByRole('combobox', { name: 'historial.runResult' })).toBeTruthy()
})

it('does not offer a conversational bug action on a classic AI report', () => {
  const detail = { id: 'r1', can_create_bug: true, casos: [{ id: 'e1', caso_id: 'c1', titulo: 'Clásica IA', formato_prueba: 'CLASICA', execution_mode: 'IA', estado: 'FALLO', has_ai_report: true, ai_report: { status: 'FAILED' } }] }
  render(<RunDetailModal detail={detail} detailLoading={false} detailError="" getStatusColor={() => 'danger'} onHide={vi.fn()} onOpenEvidence={vi.fn()} canAccessCapability={() => true} />)
  fireEvent.click(screen.getByRole('button', { name: 'historial.viewAiReport' }))
  expect(screen.queryByRole('button', { name: 'motorIa.createConversationalBug' })).toBeNull()
})
