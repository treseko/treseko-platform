// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BugTrackerPage } from './BugTrackerPage'
import es from '../../i18n/catalogs/es/bugs'

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string, params: any = {}) => {
  const value = (es as any)[key.replace('bugs.', '')] || key
  return value.replace(/\{(\w+)\}/g, (_: string, name: string) => String(params[name] ?? `{${name}}`))
} }) }))
vi.mock('../../EvidenceUpload', () => ({ EvidenceUpload: () => null }))
vi.mock('../../shared/components/EvidenceViewerModal', () => ({ EvidenceViewerModal: () => null }))
afterEach(cleanup)
const baseBug = { id: 'bug-1', codigo: 'BUG-1', proyecto_id: 'project-1', titulo: 'Error de pago', estado: 'ABIERTO', asignado_a: 'user-1', severidad: 'MEDIA', prioridad: 'P2', tipo_contexto: 'CLASICO', comments: [], attachments: [], external_links: [] }
function fixture(capabilities = (_: string) => true) {
  let bug: any = { ...baseBug }
  const fetcher = vi.fn(async (url: string, options: any = {}) => {
    if (url.includes('/api-context/') || url.includes('/conversational-context/')) return Response.json({ detail: 'Sin contexto' }, { status: 404 })
    if (url.includes('/history/')) return Response.json([{ id: 'event-1', actor_id: 'user-1', from_status: 'ABIERTO', to_status: bug.estado, occurred_at: '2026-10-10T12:00:00Z', build_name: '1.0.6' }])
    if (url.includes('/dedupe-suggestions/')) return Response.json([{ bug: { ...baseBug, id: 'original', codigo: 'BUG-2' } }])
    if (url.includes('/mark-duplicate/')) { bug = { ...bug, estado: 'DUPLICADO', duplicate_of_id: 'original' }; return Response.json(bug) }
    if (url.includes('/comments/') && options.method === 'POST') { bug = { ...bug, comments: [{ id: 'comment-1', comentario: JSON.parse(options.body).comentario }] }; return Response.json(bug.comments[0]) }
    if (url.includes('/transition/')) { bug = { ...bug, estado: JSON.parse(options.body).estado }; return Response.json(bug) }
    if (options.method === 'PATCH') { bug = { ...bug, ...JSON.parse(options.body) }; return Response.json(bug) }
    if (url.includes('/proyectos/')) return Response.json({ items: [bug], total: 125, summary: { total: 125, abiertos: 125, criticos: 2 } })
    return Response.json(bug)
  })
  const props = { currentProjectId: 'project-1', currentUserId: 'user-1', fetchWithAuth: fetcher, showFeedback: vi.fn(), canAccessCapability: capabilities, hasSystemFeature: () => true, appUsers: [{ id: 'user-1', name: 'Responsable QA' }] }
  return { fetcher, props }
}
async function openAndEdit() {
  fireEvent.click(await screen.findByRole('button', { name: 'Ver' }))
  await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name: 'Editar bug' }))
  const title = document.getElementById('bug-detail-title')!
  fireEvent.change(title, { target: { value: 'Título pendiente' } })
  return title
}

describe('Bug Tracker operational corrections', () => {
  it('paginates on the server, applies sorting and clears filters', async () => {
    const { props, fetcher } = fixture()
    render(<BugTrackerPage {...props} />)
    await screen.findByText('Mostrando 1–25 de 125')
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await screen.findByText('Mostrando 26–50 de 125')
    expect(fetcher.mock.calls.some(([url]) => url.includes('skip=25'))).toBe(true)
    fireEvent.change(screen.getByLabelText('Ordenar por'), { target: { value: 'priority' } })
    await waitFor(() => expect(fetcher.mock.calls.at(-1)?.[0]).toContain('sort=priority'))
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'EN_PROGRESO' } })
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar' }))
    await waitFor(() => expect(fetcher.mock.calls.at(-1)?.[0]).toContain('estado=EN_PROGRESO'))
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }))
    await waitFor(() => expect(fetcher.mock.calls.at(-1)?.[0]).not.toContain('estado='))
    expect(fetcher.mock.calls.at(-1)?.[0]).toContain('include_summary=true')
  })

  it('preserves edits across comments and status changes, then patches only modified fields', async () => {
    const { props, fetcher } = fixture()
    render(<BugTrackerPage {...props} />)
    const title = await openAndEdit()
    fireEvent.change(screen.getByLabelText('Agregar comentario'), { target: { value: 'Se reproduce en QA' } })
    fireEvent.click(screen.getByRole('button', { name: 'Comentar' }))
    await screen.findByText('Se reproduce en QA')
    expect(title).toHaveValue('Título pendiente')
    fireEvent.change(document.getElementById('bug-detail-status')!, { target: { value: 'EN_PROGRESO' } })
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes('/transition/'))).toBe(true))
    expect(title).toHaveValue('Título pendiente')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios del bug' }))
    await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true))
    expect(JSON.parse(fetcher.mock.calls.find(([, options]) => options?.method === 'PATCH')![1].body)).toEqual({ titulo: 'Título pendiente' })
  })

  it('confirms discarding changes and keeps only one modal visible', async () => {
    const { props } = fixture()
    render(<BugTrackerPage {...props} />)
    await openAndEdit()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cerrar' }))
    await screen.findByText('Cambios sin guardar')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Seguir editando' }))
    await waitFor(() => expect(document.getElementById('bug-detail-title')).toHaveValue('Título pendiente'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cerrar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Descartar cambios' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows history and links a duplicate to its original', async () => {
    const { props, fetcher } = fixture()
    render(<BugTrackerPage {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ver' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Historial' }))
    await screen.findByText(/Responsable QA ·/)
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como duplicado' }))
    const original = await screen.findByLabelText('Bug principal')
    await waitFor(() => expect(within(original).getByRole('option', { name: /BUG-2/ })).toBeTruthy())
    fireEvent.change(original, { target: { value: 'original' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar duplicado' }))
    await screen.findByRole('button', { name: 'Ver bug principal' })
    expect(JSON.parse(fetcher.mock.calls.find(([url]) => url.includes('/mark-duplicate/'))![1].body).duplicate_of_id).toBe('original')
  })

  it('allows own resolution without triage and preserves the current status option', async () => {
    const { props } = fixture(capability => ['bugs.ver', 'bugs.resolver'].includes(capability))
    render(<BugTrackerPage {...props} />)
    const select = await screen.findByLabelText('Cambiar estado de BUG-1')
    expect(within(select).getByRole('option', { name: 'Abierto' })).toBeTruthy()
    expect(within(select).getByRole('option', { name: 'Resuelto' })).toBeTruthy()
    expect(within(select).queryByRole('option', { name: 'Cerrado' })).toBeNull()
    expect(within(select).queryByRole('option', { name: 'Duplicado' })).toBeNull()
  })

  it('opens a deep link under React Strict Mode without consuming the cancelled request', async () => {
    const { props } = fixture()
    const consumed = vi.fn()
    render(<React.StrictMode><BugTrackerPage {...props} deepLinkBugId="bug-1" onDeepLinkConsumed={consumed} /></React.StrictMode>)
    await screen.findByRole('button', { name: 'Editar bug' })
    expect(consumed).toHaveBeenCalledOnce()
  })

  it('does not show the previous project when the new project request fails', async () => {
    const fetcher = vi.fn(async (url: string) => url.includes('/project-new/')
      ? Response.json({ detail: 'Proyecto no disponible' }, { status: 403 })
      : Response.json({ items: [{ ...baseBug, titulo: 'Solo proyecto anterior' }], total: 1, summary: {} }))
    const props = { currentUserId: 'user-1', fetchWithAuth: fetcher, showFeedback: vi.fn(), canAccessCapability: () => true }
    const view = render(<BugTrackerPage {...props} currentProjectId="project-old" />)
    await screen.findByText('Solo proyecto anterior')
    view.rerender(<BugTrackerPage {...props} currentProjectId="project-new" />)
    await screen.findByRole('alert')
    expect(screen.queryByText('Solo proyecto anterior')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy()
  })

  it('does not offer resolution for another assignee', async () => {
    const { props } = fixture(capability => ['bugs.ver', 'bugs.resolver'].includes(capability))
    render(<BugTrackerPage {...props} currentUserId="another-user" />)
    await screen.findByRole('button', { name: 'Ver' })
    expect(screen.queryByLabelText('Cambiar estado de BUG-1')).toBeNull()
  })

  it('ignores stale list responses when switching projects', async () => {
    let finish: (response: Response) => void = () => {}
    const oldRequest = new Promise<Response>(resolve => { finish = resolve })
    const fetcher = vi.fn((url: string) => url.includes('/project-old/') ? oldRequest : Promise.resolve(Response.json({ items: [{ ...baseBug, titulo: 'Proyecto nuevo' }], total: 1, summary: {} })))
    const props = { currentUserId: 'user-1', fetchWithAuth: fetcher, showFeedback: vi.fn(), canAccessCapability: () => true }
    const view = render(<BugTrackerPage {...props} currentProjectId="project-old" />)
    view.rerender(<BugTrackerPage {...props} currentProjectId="project-new" />)
    await screen.findByText('Proyecto nuevo')
    await act(async () => finish(Response.json({ items: [{ ...baseBug, titulo: 'Respuesta vieja' }], total: 1, summary: {} })))
    expect(screen.queryByText('Respuesta vieja')).toBeNull()
    expect(screen.getByText('Proyecto nuevo')).toBeTruthy()
  })
})
