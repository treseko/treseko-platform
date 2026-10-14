import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useReportesMetrics } from './hooks/useReportesMetrics'
import { createReportActions, metricsContextKey } from './reportActions'
import { ReportMetricsNotice } from './ReportMetricsNotice'
import { buildReportTablesHtml } from './reportExportUtils'

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
afterEach(cleanup)
const projectA = '11111111-1111-4111-8111-111111111111'
const projectB = '22222222-2222-4222-8222-222222222222'
const buildA = '33333333-3333-4333-8333-333333333333'
const buildB = '44444444-4444-4444-8444-444444444444'
const reply = (data: any, status = 200) => new Response(JSON.stringify(data), { status })

function harness() {
  const pending: Array<(response: Response) => void> = []
  const params = {
    currentProjectId: projectA, currentBuildId: buildA, projectsSource: 'backend' as const,
    fetchWithAuth: vi.fn(() => new Promise<Response>(resolve => pending.push(resolve))),
    setProjectMetrics: vi.fn(), setMetricsLoading: vi.fn(), setMetricsError: vi.fn(),
    setProjectSyncMessage: vi.fn(), t: ((key: string) => key) as any,
    requestRef: { current: { context: metricsContextKey(projectA, buildA, 'backend'), sequence: 0, active: true } },
  }
  return { params, pending }
}

describe('report metrics reliability', () => {
  it('keeps the latest build across action factories and ignores late failures/finalizers', async () => {
    const { params, pending } = harness()
    const old = createReportActions(params).loadProjectMetrics()
    params.currentBuildId = buildB
    params.requestRef.current.context = metricsContextKey(projectA, buildB, 'backend')
    const recent = createReportActions(params).loadProjectMetrics()
    pending[1](reply({ build_id: buildB })); await recent
    pending[0](reply({ detail: 'old failure' }, 500)); await old
    expect(params.setProjectMetrics).toHaveBeenCalledExactlyOnceWith({ build_id: buildB })
    expect(params.setMetricsError.mock.calls.every(([error]) => error === '')).toBe(true)
    expect(params.setMetricsLoading.mock.calls).toEqual([[true], [true], [false]])
  })

  it('discards late successes when another request wins in the same context', async () => {
    const { params, pending } = harness(); const actions = createReportActions(params)
    const old = actions.loadProjectMetrics(); const recent = actions.loadProjectMetrics()
    pending[1](reply({ value: 'new' })); await recent
    pending[0](reply({ value: 'old' })); await old
    expect(params.setProjectMetrics).toHaveBeenCalledExactlyOnceWith({ value: 'new' })
  })

  it('shows errors without replacing previous data and clears them on retry', async () => {
    const { params, pending } = harness(); const actions = createReportActions(params)
    const failure = actions.loadProjectMetrics(undefined, { silent: true })
    pending[0](reply({ detail: 'Controlled error' }, 500)); await failure
    expect(params.setMetricsError).toHaveBeenLastCalledWith('reportes.metricsLoadError: Controlled error')
    expect(params.setProjectMetrics).not.toHaveBeenCalled()
    const retry = actions.loadProjectMetrics(); expect(params.setMetricsError).toHaveBeenLastCalledWith('')
    pending[1](reply({ recovered: true })); await retry
    expect(params.setProjectMetrics).toHaveBeenLastCalledWith({ recovered: true })
  })

  it('clears context and ignores old responses after project change and unmount', async () => {
    const pending: Array<(response: Response) => void> = []
    const fetchWithAuth = vi.fn(() => new Promise<Response>(resolve => pending.push(resolve)))
    const { result, rerender, unmount } = renderHook(({ project }) => useReportesMetrics({
      activeTab: 'reportes', currentProjectId: project, currentBuildId: buildA,
      projectsSource: 'backend', fetchWithAuth, setProjectSyncMessage: vi.fn(),
    }), { initialProps: { project: projectA } })
    await act(async () => { pending[0](reply({ project: projectA })) })
    expect(result.current.projectMetrics).toEqual({ project: projectA })
    let oldRefresh: Promise<void>
    act(() => { oldRefresh = result.current.loadProjectMetrics() })
    rerender({ project: projectB }); expect(result.current.projectMetrics).toBeNull()
    expect(result.current.metricsError).toBe('')
    await act(async () => { pending[2](reply({ project: projectB })) })
    await act(async () => { pending[1](reply({ project: projectA })); await oldRefresh })
    expect(result.current.projectMetrics).toEqual({ project: projectB })
    act(() => { void result.current.loadProjectMetrics() })
    unmount(); await act(async () => { pending[3](reply({ project: projectB })) })
  })

  it('renders error, stale-data warning and usable retry; hides notice after recovery', () => {
    const retry = vi.fn()
    const { rerender } = render(<ReportMetricsNotice error="Controlled error" hasPreviousData loading={false} onRetry={retry} />)
    expect(screen.getByRole('alert').textContent).toContain('reportes.metricsStaleNotice')
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' })); expect(retry).toHaveBeenCalledOnce()
    rerender(<ReportMetricsNotice error="Controlled error" hasPreviousData={false} loading onRetry={retry} />)
    expect(screen.queryByText('reportes.metricsStaleNotice')).toBeNull()
    expect(screen.getByRole('button')).toBeDisabled()
    rerender(<ReportMetricsNotice error="" hasPreviousData loading={false} onRetry={retry} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('exports one valid case row with aligned columns and no stray case text', () => {
    const html = buildReportTablesHtml({ suiteTree: [{ nombre: 'Suite', total: 1,
      casos: [{ codigo: 'UNIQUE-CASE', formato_prueba: 'API', titulo: '<Caso>' }] }],
    projectMetrics: {}, reportStats: {}, bugMetrics: {}, t: key => key })
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(html.split('UNIQUE-CASE')).toHaveLength(2)
    expect([...doc.body.childNodes].some(node => node.nodeType === 3 && node.textContent?.includes('UNIQUE-CASE'))).toBe(false)
    const row = [...doc.querySelectorAll('tr')].find(node => node.textContent?.includes('UNIQUE-CASE'))!
    expect(row.cells).toHaveLength(17)
    expect(row.closest('table')?.querySelectorAll('thead th')).toHaveLength(17)
    expect(row.textContent).toContain('<Caso>')
  })
})
