// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { ScheduledMissionsPanel } from './ScheduledMissionsPanel'
import { RecordingEvidence } from './RecordingEvidence'

afterEach(cleanup)
it('reloads persisted schedules and cancels on the server', async () => {
  const row = { id: 'mission', nombre: 'Nightly regression', estado: 'PENDING', scheduled_at: '2027-01-01T02:00:00Z' }
  const fetchWithAuth = vi.fn(async (_url: string, options?: RequestInit) => ({ ok: true, json: async () => options?.method === 'DELETE' ? { ...row, estado: 'CANCELLED' } : [row] }) as Response)
  render(<I18nProvider><ScheduledMissionsPanel projectId="project" fetchWithAuth={fetchWithAuth} /></I18nProvider>)
  await screen.findByText('Nightly regression')
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith(expect.stringContaining('/ai-schedules/mission'), { method: 'DELETE' }))
  await waitFor(() => expect(screen.queryByRole('button')).toBeNull())
})
it('disables expired video references and rejects malformed identifiers', () => {
  const { rerender } = render(<I18nProvider><RecordingEvidence reference={{ id: '00000000-0000-4000-8000-000000000003', temporary: true, expires_at: '2020-01-01T00:00:00Z' }} /></I18nProvider>)
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  rerender(<I18nProvider><RecordingEvidence reference={{ id: '../outside' }} /></I18nProvider>)
  expect(screen.queryByRole('button')).toBeNull()
})

it('shows the dry-run player and deletes only on an explicit click', async () => {
  const create = vi.fn(() => 'blob:temporary-video'), revoke = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true })
  const fetchWithAuth = vi.fn(async (_url: string, options?: RequestInit) => ({ ok: true, status: options?.method === 'DELETE' ? 204 : 200, blob: async () => new Blob(['video']) }) as Response)
  const reference = { id: '00000000-0000-4000-8000-000000000003', temporary: true, expires_at: '2027-01-01T00:00:00Z' }
  const view = render(<I18nProvider><RecordingEvidence reference={reference} inlineTemporary fetchWithAuth={fetchWithAuth} /></I18nProvider>)
  await waitFor(() => expect(view.container.querySelector('video')?.getAttribute('src')).toBe('blob:temporary-video'))
  expect(fetchWithAuth.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false)
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar video' }))
  await screen.findByText('Video eliminado del servidor.')
  expect(view.container.querySelector('video')).toBeNull()
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:temporary-video'))
})
it('closing the preview preserves the server video; failed deletion permits retry', async () => {
  const fetchWithAuth = vi.fn(async (_url: string, options?: RequestInit) => ({ ok: options?.method !== 'DELETE', status: options?.method === 'DELETE' ? 503 : 200, blob: async () => new Blob(['video']) }) as Response)
  const reference = { id: '00000000-0000-4000-8000-000000000003', temporary: true, expires_at: '2027-01-01T00:00:00Z' }
  const view = render(<I18nProvider><RecordingEvidence reference={reference} inlineTemporary fetchWithAuth={fetchWithAuth} /></I18nProvider>)
  await waitFor(() => expect(view.container.querySelector('video')).not.toBeNull())
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar video' }))
  await screen.findByText('No se pudo eliminar el video. Volvé a intentarlo.')
  expect(view.container.querySelector('video')).not.toBeNull()
  expect((screen.getByRole('button', { name: 'Eliminar video' }) as HTMLButtonElement).disabled).toBe(false)
  const calls = fetchWithAuth.mock.calls.length
  view.unmount()
  expect(fetchWithAuth.mock.calls.length).toBe(calls)
})


it('does not restore an old pending state after cancellation', async () => {
  const row = { id: 'mission', nombre: 'Scheduled QA', estado: 'PENDING', scheduled_at: '2027-01-01T02:00:00Z' }
  let poll: (() => void) | undefined
  const realInterval = window.setInterval.bind(window)
  const interval = vi.spyOn(window, 'setInterval').mockImplementation(((callback: () => void, delay: number) => {
    if (delay === 5000) { poll = callback; return 0 }
    return realInterval(callback, delay)
  }) as any)
  let resolvePoll!: (response: Response) => void
  let reads = 0
  const fetchWithAuth = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'DELETE') return { ok: true, json: async () => ({ ...row, estado: 'CANCELLED' }) } as Response
    reads++
    if (reads === 1) return { ok: true, json: async () => [row] } as Response
    return new Promise<Response>(resolve => { resolvePoll = resolve })
  })
  try {
    render(<I18nProvider><ScheduledMissionsPanel projectId="project" fetchWithAuth={fetchWithAuth} /></I18nProvider>)
    await screen.findByText('Scheduled QA')
    act(() => poll?.())
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull())
    await act(async () => { resolvePoll({ ok: true, json: async () => [row] } as Response) })
    expect(screen.queryByRole('button')).toBeNull()
  } finally { interval.mockRestore() }
})

it('clears the previous projects schedules when switching projects', async () => {
  const row = { id: 'mission', nombre: 'Project A schedule', estado: 'PENDING', scheduled_at: '2027-01-01T02:00:00Z' }
  const fetchWithAuth = vi.fn(async (url: string) => ({ ok: !url.includes('/project-b/'), json: async () => [row] }) as Response)
  const view = render(<I18nProvider><ScheduledMissionsPanel projectId="project-a" fetchWithAuth={fetchWithAuth} /></I18nProvider>)
  await screen.findByText('Project A schedule')
  view.rerender(<I18nProvider><ScheduledMissionsPanel projectId="project-b" fetchWithAuth={fetchWithAuth} /></I18nProvider>)
  await waitFor(() => expect(screen.queryByText('Project A schedule')).toBeNull())
})
