import React from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHistorialController } from './hooks/useHistorialController'
import { HistorialRunsPage } from './pages/HistorialRunsPage'
import { HistoryFormatEvidence } from './HistoryFormatEvidence'
import { HistorialRunsTable } from './components/HistorialRunsTable'

vi.mock('../../i18n', () => { const t = (key: string) => key; return { useI18n: () => ({ t }) } })
vi.mock('../motor-ia/AiExecutionReportModal', () => ({ AiExecutionReportModal: () => null }))
afterEach(cleanup)
beforeEach(() => window.history.replaceState({}, '', '/?tab=historial'))
const project = '0f46e8e6-341d-4a1e-9942-6baaf663acdd'
const row = (id: string) => ({ id, runId: id, origin: 'MANUAL', passed: 1, status: 'passed' })
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done }); return { promise, resolve } }
function params(fetchWithAuth: any) {
  return { activeTab: 'historial', currentProjectId: project, currentBuildId: 'build', projectsSource: 'backend' as const,
    initialRunHistory: [], fetchWithAuth, setProjectSyncMessage: vi.fn(), showFeedback: vi.fn(), loadProjectMetrics: vi.fn(), setActiveTab: vi.fn() }
}
const response = (items = [row('run1')], total = items.length) => Response.json({ items, total })

describe('History applied filters and request lifecycle', () => {
  it('preserves applied filters on refresh and exposes pages and total', async () => {
    const fetch = vi.fn(async (_url: string) => response([row('run1')], 63))
    const { result } = renderHook(() => useHistorialController(params(fetch)))
    await waitFor(() => expect(result.current.historyState.loading).toBe(false))
    await act(() => result.current.loadProjectRunHistory({ status: 'FALLO', skip: 25, limit: 25 }))
    await act(() => result.current.loadProjectRunHistory())
    expect(fetch.mock.calls.at(-1)?.[0]).toContain('status=FALLO')
    expect(fetch.mock.calls.at(-1)?.[0]).toContain('skip=25')
    expect(result.current.historyState.total).toBe(63)
    expect(new URLSearchParams(window.location.search).get('h_status')).toBe('FALLO')
  })
  it('ignores a slow old filter response after reset', async () => {
    const slow = deferred()
    const fetch = vi.fn((url: string) => url.includes('status=FALLO') ? slow.promise : Promise.resolve(response([row('current')])))
    const { result } = renderHook(() => useHistorialController(params(fetch)))
    await waitFor(() => expect(result.current.runHistory[0]?.id).toBe('current'))
    act(() => { void result.current.loadProjectRunHistory({ status: 'FALLO' }) })
    await act(() => result.current.loadProjectRunHistory({}))
    await act(async () => { slow.resolve(response([row('old')])); await slow.promise })
    expect(result.current.runHistory[0].id).toBe('current')
    expect(result.current.historyState.filters).toEqual({})
  })
  it('ignores a response from a previous project', async () => {
    const slow = deferred()
    const fetch = vi.fn((url: string) => url.includes(project) ? slow.promise : Promise.resolve(response([row('projectB')])))
    const { result, rerender } = renderHook(({ projectId }) => useHistorialController({ ...params(fetch), currentProjectId: projectId }), { initialProps: { projectId: project } })
    rerender({ projectId: '1c10b6c2-9c9a-41a9-bac1-3a5a18961f08' })
    await waitFor(() => expect(result.current.runHistory[0]?.id).toBe('projectB'))
    await act(async () => { slow.resolve(response([row('oldProject')])); await slow.promise })
    expect(result.current.runHistory[0].id).toBe('projectB')
  })
  it('keeps previous results but reports an error and allows retry', async () => {
    const fetch = vi.fn(async (_url: string) => response())
    const { result } = renderHook(() => useHistorialController(params(fetch)))
    await waitFor(() => expect(result.current.runHistory).toHaveLength(1))
    fetch.mockResolvedValueOnce(Response.json({ detail: 'Servidor temporalmente no disponible' }, { status: 500 }))
    await act(() => result.current.loadProjectRunHistory({}))
    expect(result.current.historyState.error).toContain('Servidor temporalmente no disponible')
    expect(result.current.runHistory).toHaveLength(1)
    await act(() => result.current.loadProjectRunHistory())
    expect(result.current.historyState.error).toBe('')
  })
  it('restores a filtered page from its URL', async () => {
    window.history.replaceState({}, '', '/?tab=historial&h_status=FALLO&h_limit=25&h_skip=25&run_id=run2')
    const fetch = vi.fn(async (_url: string) => response([row('run2')], 63))
    const { result } = renderHook(() => useHistorialController(params(fetch)))
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(fetch.mock.calls[0][0]).toContain('skip=25')
    expect(fetch.mock.calls[0][0]).toContain('status=FALLO')
    expect(result.current.pendingHistorialRunDetailId).toBe('run2')
  })
  it('keeps URL filters while the project context resolves during startup', async () => {
    window.history.replaceState({}, '', '/?tab=historial&h_limit=25&h_skip=25&h_status=FALLO')
    const fetch = vi.fn(async (_url: string) => response([row('resolved')], 63))
    const { result, rerender } = renderHook(({ projectId }) => useHistorialController({ ...params(fetch), currentProjectId: projectId }), { initialProps: { projectId: '' } })
    rerender({ projectId: project })
    await waitFor(() => expect(result.current.runHistory[0]?.id).toBe('resolved'))
    expect(fetch.mock.calls[0][0]).toContain('skip=25')
    expect(fetch.mock.calls[0][0]).toContain('status=FALLO')
  })
  it('rejects an inverted date range before issuing a search', async () => {
    const fetch = vi.fn(async (_url: string) => response())
    const { result } = renderHook(() => useHistorialController(params(fetch)))
    await waitFor(() => expect(result.current.runHistory).toHaveLength(1))
    const count = fetch.mock.calls.length
    await act(() => result.current.loadProjectRunHistory({ date_from: '2026-10-11', date_to: '2026-10-10' }))
    expect(fetch.mock.calls).toHaveLength(count)
    expect(result.current.historyState.error).toBe('historial.invalidDates')
  })
})

function page(options: any = {}) {
  const props = { currentProjectId: project, currentProjectRunHistory: [row('run1')], getStatusColor: () => 'success',
    onOpenEvidence: vi.fn(), buildsList: [], componentsList: [], environments: [], appUsers: [], initialFilters: {},
    pendingRunDetailId: '', onPendingRunDetailConsumed: vi.fn(), onLoadHistory: vi.fn(async () => {}),
    onLoadRunDetail: vi.fn(async () => ({ id: 'run1', nombre: 'Run', casos: [] })),
    historyState: { total: 63, limit: 25, skip: 0, filters: {}, loading: false, error: '' }, ...options }
  render(<HistorialRunsPage {...props} />)
  return props
}

describe('History page and format detail', () => {
  it('does not reopen a detail that was closed while loading', async () => {
    const slow = deferred(); const p = page({ onLoadRunDetail: vi.fn(() => slow.promise) })
    fireEvent.click(screen.getAllByText('historial.viewDetail')[0])
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByLabelText('Close'))
    await act(async () => { slow.resolve({ id: 'run1', casos: [] }); await slow.promise })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(p.onLoadRunDetail).toHaveBeenCalledWith('run1', 'historial')
  })
  it('shows server errors and pagination and submits with Enter', () => {
    const p = page({ historyState: { total: 63, limit: 25, skip: 0, filters: {}, error: 'Error temporal', loading: false } })
    expect(screen.getByRole('alert').textContent).toContain('Error temporal')
    fireEvent.click(screen.getByText('historial.retry')); expect(p.onLoadHistory).toHaveBeenCalledWith()
    fireEvent.click(screen.getByText('historial.next')); expect(p.onLoadHistory).toHaveBeenCalledWith({ skip: 25, limit: 25 })
    fireEvent.submit(screen.getByPlaceholderText('historial.searchCase').closest('form')!)
    expect(p.onLoadHistory).toHaveBeenLastCalledWith({ ...Object.fromEntries(['case_query','case_code','build_id','component_id','status','run_result','origin','runner_id','environment_id','dataset_id','date_from','date_to','has_evidence','version_executed','ai_review_status'].map(k=>[k,''])), skip: 0, limit: 25 })
  })
  it('shows general observations from the execution', async () => {
    page({ onLoadRunDetail: async () => ({ id: 'run1', casos: [{ id: 'e1', caso_id: 'c1', titulo: 'Pago', formato_prueba: 'CLASICA', observaciones: 'Pago rechazado por saldo insuficiente', snapshots: [] }] }) })
    fireEvent.click(screen.getAllByText('historial.viewDetail')[0])
    expect(await screen.findByText('Pago rechazado por saldo insuficiente')).toBeTruthy()
  })
  it('shows API response and assertions independently of execution mode', () => {
    render(<HistoryFormatEvidence caso={{ formato_prueba: 'API', execution_mode: 'MANUAL', api_resultado: { steps: [{ request: { method: 'GET', url: 'https://example.test/payments' }, response: { status: 500, body: 'Pago rechazado' }, assertions: [{ name: 'Status esperado', status: 'FAILED', expected: 200, actual: 500 }] }] } }} />)
    expect(screen.getAllByText('Status esperado', { exact: false })[0]).toBeTruthy()
    expect(screen.getAllByText(/Pago rechazado/)[0]).toBeTruthy()
  })
  it('shows all manual conversational turns without an AI report', () => {
    render(<HistoryFormatEvidence caso={{ formato_prueba: 'CONVERSACIONAL', execution_mode: 'MANUAL', chatbot_resultado: { turns: [{ message: 'Hola', responseText: 'Buen día', statusCode: 200 }, { message: 'Necesito ayuda', responseText: '¿Con qué?', statusCode: 200 }] } }} />)
    expect(screen.getByText('Hola')).toBeTruthy(); expect(screen.getByText('¿Con qué?')).toBeTruthy()
  })
  it('uses the total evidence count and hides forbidden actions', () => {
    const data = [{ ...row('run1'), evidenceCount: 6, evidencias: [{ id: '1', public_url: '/one.png' }, { id: '2', public_url: '/two.png' }, { id: '3', public_url: '/three.png' }] }]
    const { rerender } = render(<HistorialRunsTable runs={data} getStatusColor={() => 'success'} onOpenEvidence={vi.fn()} onOpenRunDetail={vi.fn()} />)
    expect(screen.getAllByText('+3')).toHaveLength(2)
    rerender(<HistorialRunsTable runs={data} getStatusColor={() => 'success'} onOpenEvidence={vi.fn()} onOpenRunDetail={vi.fn()} canViewDetail={false} canViewEvidence={false} />)
    expect(screen.queryByText('historial.viewDetail')).toBeNull();expect(screen.queryByText('+3')).toBeNull()
  })
})
