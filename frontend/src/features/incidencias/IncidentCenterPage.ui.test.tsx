// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IncidentCenterPage } from './IncidentCenterPage'

vi.mock('../../i18n', () => { const t = (key: string) => key; return { useI18n: () => ({ t }) } })
vi.mock('../../EvidenceUpload', () => ({ EvidenceUpload: () => null }))
afterEach(cleanup)
const bug = { id: 'b1', codigo: 'BUG-1', titulo: 'Incidente', estado: 'ABIERTO', asignado_a: 'u1',
  proyecto_id: 'p1', caso_id: 'c1', ejecucion_id: 'e1', descripcion: 'Descripción importante',
  resolucion_pantalla: '1920x1080', resolucion: '', notas_qa: '', severidad: 'ALTA', prioridad: 'P1' }
const builds = [{ id: 'build1', proyecto_id: 'p1', nombre: 'Corrección', activo: true },
  { id: 'other', proyecto_id: 'p2', nombre: 'Otro proyecto', activo: true },
  { id: 'inactive', proyecto_id: 'p1', nombre: 'Cerrada', activo: false }]
function fixture(initial = bug) {
  let stored = { ...initial }
  const fetchWithAuth = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method) {
      const data = JSON.parse(String(options.body))
      if (url.endsWith('/comments/')) return Response.json({ id: 'comment', comentario: data.comentario })
      stored = { ...stored, ...data }
      return Response.json(stored)
    }
    if (url.includes('/incidencias/centro/')) return Response.json({ items: [stored], total: 1, summary: { abiertos: 1, criticos: 1 } })
    if (url.includes('/history/')) return Response.json([{ id: 'h1', from_status: 'ABIERTO', to_status: 'EN_PROGRESO', actor_id: 'u1', occurred_at: '2026-10-10T00:00:00Z' }])
    if (url.includes('/conversational-context/')) return Response.json({ detail: 'Sin evidencia' }, { status: 403 })
    return Response.json([])
  })
  return { fetchWithAuth }
}
async function open(options: any = {}) {
  const f = fixture(options.bug || bug)
  const onOpenCase = vi.fn(); const onOpenExecution = vi.fn()
  render(<IncidentCenterPage builds={builds} users={[{ id: 'u1', nombre_completo: 'Responsable QA' }]} currentUserId="u1" canAccessCapability={() => true} onOpenCase={onOpenCase} onOpenExecution={onOpenExecution} {...f} {...options} />)
  fireEvent.click(await screen.findByText('Incidente'))
  return { ...f, onOpenCase, onOpenExecution }
}
const actions = () => fireEvent.click(screen.getByText('incidencias.actionsTab'))
const dialog = () => within(screen.getByRole('dialog'))

describe('Incident Center working flows', () => {
  it('shows description, traceability, severity and separate screen resolution', async () => {
    const f = await open()
    expect(screen.getByText('Descripción importante')).toBeTruthy()
    fireEvent.click(dialog().getByText('incidencias.viewCase')); expect(f.onOpenCase).toHaveBeenCalledOnce()
    fireEvent.click(dialog().getByText('incidencias.viewExecution')); expect(f.onOpenExecution).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText('incidencias.reproductionTab')); expect(screen.getByRole('tab', { selected: true }).textContent).toBe('incidencias.reproductionTab'); expect(screen.getByText('1920x1080')).toBeTruthy()
    actions(); expect((screen.getByLabelText('incidencias.solutionNotes') as HTMLTextAreaElement).value).toBe('')
    expect(screen.getAllByText('incidencias.severityHigh').length).toBeGreaterThan(0)
  })
  it('keeps drafts across tabs, comments, assignment and transitions', async () => {
    const f = await open(); actions()
    fireEvent.change(screen.getByLabelText('incidencias.qaNotes'), { target: { value: 'Borrador QA' } })
    fireEvent.click(screen.getByText('incidencias.diagnosisTab')); actions()
    expect((screen.getByLabelText('incidencias.qaNotes') as HTMLTextAreaElement).value).toBe('Borrador QA')
    fireEvent.change(screen.getByLabelText('incidencias.comment'), { target: { value: 'Comentario enviado' } })
    fireEvent.click(screen.getByText('incidencias.addComment'))
    await waitFor(() => expect((screen.getByLabelText('incidencias.comment') as HTMLTextAreaElement).value).toBe(''))
    fireEvent.change(screen.getByLabelText('incidencias.status', { selector: '#incident-quick-status' }), { target: { value: 'EN_PROGRESO' } })
    fireEvent.click(screen.getByText('incidencias.updateStatus'))
    await waitFor(() => expect(f.fetchWithAuth.mock.calls.some(([, options]) => options?.method === 'POST' && String(options.body).includes('EN_PROGRESO'))).toBe(true))
    expect((screen.getByLabelText('incidencias.qaNotes') as HTMLTextAreaElement).value).toBe('Borrador QA')
    await waitFor(() => expect(screen.getByText('incidencias.saveSolution').closest('fieldset')?.disabled).toBe(false))
    fireEvent.click(screen.getByText('incidencias.saveSolution'))
    await waitFor(() => expect(f.fetchWithAuth.mock.calls.some(([, options]) => options?.method === 'PATCH' && options.body === JSON.stringify({ notas_qa: 'Borrador QA' }))).toBe(true))
  })
  it('confirms discard with a single modal and restores the draft when cancelled', async () => {
    const f = await open(); actions(); fireEvent.change(screen.getByLabelText('incidencias.qaNotes'), { target: { value: 'Borrador' } })
    fireEvent.click(screen.getByText('incidencias.viewCase'))
    expect(f.onOpenCase).not.toHaveBeenCalled()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(screen.getByText('bugs.keepEditing'))
    fireEvent.click(screen.getByText('incidencias.closeDetail'))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByText('bugs.unsavedMessage')).toBeTruthy()
    fireEvent.click(screen.getByText('bugs.keepEditing'))
    expect((screen.getByLabelText('incidencias.qaNotes') as HTMLTextAreaElement).value).toBe('Borrador')
    fireEvent.click(screen.getByText('incidencias.closeDetail')); fireEvent.click(screen.getByText('bugs.discardChanges'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
  it('allows own resolution without triage and filters build choices', async () => {
    const f = await open({ canAccessCapability: (cap: string) => ['incidencias.ver', 'bugs.resolver'].includes(cap) }); actions()
    const status = screen.getByLabelText('incidencias.status', { selector: '#incident-quick-status' })
    expect(within(status).queryByText('incidencias.statusClosed')).toBeNull()
    expect(within(status).queryByText('incidencias.statusInProgress')).toBeNull()
    fireEvent.change(status, { target: { value: 'RESUELTO' } })
    await screen.findByRole('option', { name: 'Corrección' })
    const build = screen.getByLabelText('bugs.correctionBuild')
    expect(within(build).queryByText('Otro proyecto')).toBeNull(); expect(within(build).queryByText('Cerrada')).toBeNull()
    expect((screen.getByText('incidencias.updateStatus') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(build, { target: { value: 'build1' } }); fireEvent.click(screen.getByText('incidencias.updateStatus'))
    await waitFor(() => expect(f.fetchWithAuth.mock.calls.some(([, options]) => options?.body === JSON.stringify({ estado: 'RESUELTO', resolution_build_id: 'build1' }))).toBe(true))
  })
  it('does not allow resolving another user bug or closing with triage only', async () => {
    await open({ currentUserId: 'u2', canAccessCapability: (cap: string) => ['incidencias.ver', 'bugs.resolver', 'bugs.triage'].includes(cap) }); actions()
    const status = screen.getByLabelText('incidencias.status', { selector: '#incident-quick-status' })
    for (const name of ['statusResolved', 'statusClosed', 'statusDuplicate']) expect(within(status).queryByText(`incidencias.${name}`)).toBeNull()
  })
  it.each(['RESUELTO', 'CERRADO', 'DUPLICADO', 'NO_REPRODUCIBLE', 'NO_CORRESPONDE'])('requires a fresh reappearance build from %s', async state => {
    await open({ bug: { ...bug, estado: state } }); actions()
    fireEvent.change(screen.getByLabelText('incidencias.status', { selector: '#incident-quick-status' }), { target: { value: 'REABIERTO' } })
    const build = screen.getByLabelText('bugs.reappearanceBuild') as HTMLSelectElement
    expect(build.value).toBe(''); expect((screen.getByText('incidencias.updateStatus') as HTMLButtonElement).disabled).toBe(true)
  })
  it('supports KPI filters and server sorting', async () => {
    const f = fixture(); render(<IncidentCenterPage {...f} />)
    await screen.findByText('Incidente')
    fireEvent.click(screen.getByText('incidencias.criticalAndHigh'))
    await waitFor(() => expect(f.fetchWithAuth.mock.calls.some(([url]) => url.includes('attention=critical'))).toBe(true))
    fireEvent.change(screen.getByLabelText('bugs.sortBy'), { target: { value: 'priority' } })
    await waitFor(() => expect(f.fetchWithAuth.mock.calls.some(([url]) => url.includes('sort=priority') && url.includes('attention=critical'))).toBe(true))
  })
  it('does not replace new filter results with an older response', async () => {
    let finishOld: (value: Response) => void = () => {}; let finishNew: (value: Response) => void = () => {}
    const old = new Promise<Response>(resolve => { finishOld = resolve }); const latest = new Promise<Response>(resolve => { finishNew = resolve })
    const fetchWithAuth = vi.fn((url: string) => url.includes('q=new') ? latest : old)
    render(<IncidentCenterPage fetchWithAuth={fetchWithAuth} />)
    fireEvent.change(screen.getByLabelText('incidencias.search'), { target: { value: 'new' } })
    await waitFor(() => expect(fetchWithAuth.mock.calls.some(([url]) => url.includes('q=new'))).toBe(true))
    finishNew(Response.json({ items: [{ ...bug, titulo: 'Nuevo' }], total: 1 })); await screen.findByText('Nuevo')
    finishOld(Response.json({ items: [{ ...bug, titulo: 'Antiguo' }], total: 1 }))
    await new Promise(resolve => setTimeout(resolve, 20)); expect(screen.queryByText('Antiguo')).toBeNull()
  })
  it('uses the original selection workflow with the edition gate and preserves drafts', async () => {
    const original = { ...bug, id: 'original', codigo: 'BUG-2', titulo: 'Principal', asignado_a: null }
    const base = fixture()
    const fetchWithAuth = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('q=Principal')) return Response.json({ items: [original], total: 1 })
      if (url.endsWith('/mark-duplicate/')) return Response.json({ ...bug, estado: 'DUPLICADO', duplicate_of_id: 'original' })
      return base.fetchWithAuth(url, options)
    })
    await open({ fetchWithAuth, hasSystemFeature: () => true }); actions()
    fireEvent.change(screen.getByLabelText('incidencias.qaNotes'), { target: { value: 'Borrador conservado' } })
    fireEvent.click(screen.getByText('bugs.markDuplicate'))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('bugs.searchOriginal'), { target: { value: 'Principal' } })
    await waitFor(() => expect((screen.getByText('bugs.search') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByText('bugs.search'))
    await screen.findByRole('option', { name: 'BUG-2 · Principal' })
    fireEvent.change(screen.getByLabelText('bugs.originalBug'), { target: { value: 'original' } })
    fireEvent.click(screen.getByText('bugs.confirmDuplicate'))
    await screen.findByLabelText('incidencias.qaNotes')
    expect(fetchWithAuth.mock.calls.some(([url, options]) => url.endsWith('/mark-duplicate/') && JSON.parse(String(options?.body)).duplicate_of_id === 'original')).toBe(true)
    expect((screen.getByLabelText('incidencias.qaNotes') as HTMLTextAreaElement).value).toBe('Borrador conservado')
  })
  it('hides duplicate marking without the required feature', async () => {
    await open({ hasSystemFeature: () => false }); actions()
    expect(screen.queryByText('bugs.markDuplicate')).toBeNull()
  })
  it('shows a context error instead of silently discarding structured evidence', async () => {
    await open({ bug: { ...bug, tipo_contexto: 'CONVERSACIONAL' } })
    fireEvent.click(screen.getByText('incidencias.conversationContextTab'))
    await screen.findByText(/Sin evidencia/)
    expect(screen.getByText('bugs.retry')).toBeTruthy()
  })
  it('hides exports for users without export capability', async () => {
    await open({ canAccessCapability: (cap: string) => cap !== 'bugs.exportar' })
    expect(screen.queryByText('incidencias.exportIncident')).toBeNull()
    expect(screen.queryByText('incidencias.exportCsv')).toBeNull()
  })
})
