import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { InventarioPage } from './InventarioPage'

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
afterEach(cleanup)

const asset = (id: string, name: string) => ({
  id, nombre: name, proyecto_id: 'A', tipo: 'Servidor', naturaleza: 'fisico',
  estado: 'Activo', criticidad: 'Media', endpoints: [{ id: 'endpoint-1', tipo: 'hostname', valor: 'qa-host', principal: true }],
})
const props = (fetchWithAuth: any, project = 'A', editable = true) => ({
  currentProjectId: project, fetchWithAuth, canAccessCapability: () => editable,
  confirmAction: vi.fn(async () => true),
} as any)

it('does not replace the current project with a late response', async () => {
  let resolveOld: (response: Response) => void = () => {}
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/categorias/')) return Response.json([])
    if (url.includes('proyecto_id=A')) return new Promise<Response>(resolve => { resolveOld = resolve })
    return Response.json([asset('B-asset', 'Current project asset')])
  })
  const view = render(<InventarioPage {...props(fetcher)} />)
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes('/activos/'))).toBe(true))
  view.rerender(<InventarioPage {...props(fetcher, 'B')} />)
  await screen.findAllByText('Current project asset')
  await act(async () => { resolveOld(Response.json([asset('A-asset', 'Obsolete project asset')])) })
  expect(screen.queryByText('Obsolete project asset')).not.toBeInTheDocument()
  expect(screen.getAllByText('Current project asset').length).toBeGreaterThan(0)
})

it('loads persisted categories and creates them through the server', async () => {
  const categories = [{ id: 'persisted', proyecto_id: 'A', nombre: 'Existing category' }]
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/categorias/')) {
      if (options?.method === 'POST') categories.push({ id: 'new-category', proyecto_id: 'A', nombre: JSON.parse(String(options.body)).nombre })
      return Response.json(options?.method === 'POST' ? categories.at(-1) : categories)
    }
    return Response.json([])
  })
  render(<InventarioPage {...props(fetcher)} />)
  await screen.findByText('inventario.noAssets')
  fireEvent.change(screen.getByPlaceholderText('inventario.newCategory'), { target: { value: 'New category' } })
  fireEvent.click(screen.getByRole('button', { name: 'inventario.createCategory' }))
  await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true))
  await waitFor(() => expect(screen.getByPlaceholderText('inventario.newCategory')).toHaveValue(''))
  fireEvent.click(screen.getByRole('button', { name: 'inventario.addPhysical' }))
  expect(await screen.findByRole('option', { name: 'Existing category' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'New category' })).toBeInTheDocument()
})

it('allows readers to inspect all asset fields without submitting changes', async () => {
  const fetcher = vi.fn(async (url: string, _options?: RequestInit) => Response.json(url.includes('/categorias/') ? [] : [asset('server', 'Read only server')]))
  render(<InventarioPage {...props(fetcher, 'A', false)} />)
  fireEvent.click(await screen.findByRole('button', { name: 'inventario.viewAsset' }))
  expect(screen.getByDisplayValue('Read only server')).toBeDisabled()
  expect(screen.getByDisplayValue('qa-host')).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'inventario.saveAsset' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'inventario.editAsset' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'common.close' }))
  expect(fetcher.mock.calls.every(([, options]) => !options?.method)).toBe(true)
})

it('sends endpoint removal in one PATCH and keeps a failed edit open', async () => {
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'PATCH') return Response.json({ detail: 'Inventory save rejected' }, { status: 422 })
    return Response.json(url.includes('/categorias/') ? [] : [asset('server', 'Atomic server')])
  })
  render(<InventarioPage {...props(fetcher)} />)
  fireEvent.click(await screen.findByRole('button', { name: 'inventario.editAsset' }))
  const remove = screen.getByRole('button', { name: 'inventario.remove' })
  fireEvent.click(remove)
  fireEvent.click(screen.getByRole('button', { name: 'inventario.saveAsset' }))
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Inventory save rejected'))
  const writes = fetcher.mock.calls.filter(([, options]) => options?.method)
  expect(writes).toHaveLength(1)
  expect(writes[0][1]?.method).toBe('PATCH')
  expect(JSON.parse(String(writes[0][1]?.body)).endpoints).toEqual([])
})
