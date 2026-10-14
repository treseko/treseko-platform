import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectLoaders } from './projectLoaders'
import { loadProjectPages } from './projectPagination'

test('carga 405 elementos sin omitir las páginas posteriores a 200', async () => {
  const offsets: number[] = []
  const rows = Array.from({ length: 405 }, (_, id) => ({ id }))
  const loaded = await loadProjectPages(async url => {
    const offset = Number(new URL(url, 'http://localhost').searchParams.get('skip'))
    offsets.push(offset)
    return { ok: true, json: async () => rows.slice(offset, offset + 200) } as Response
  }, '/api/proyectos/?organizacion_id=qa')
  assert.deepEqual(offsets, [0, 200, 400])
  assert.deepEqual(loaded, rows)
})

for (const ok of [true, false]) {
  test(`descarta una respuesta tardía ${ok ? 'correcta' : 'fallida'}`, async () => {
    let current = true
    const loaded = await loadProjectPages(async () => {
      current = false
      return { ok, json: async () => ok ? [{ id: 'old' }] : { detail: 'old error' } } as Response
    }, '/api/proyectos/', () => current)
    assert.equal(loaded, null)
  })
}

test('no entrega un listado parcial cuando falla su segunda página', async () => {
  let calls = 0
  await assert.rejects(loadProjectPages(async () => {
    calls += 1
    return { ok: calls === 1, json: async () => calls === 1 ? Array(200).fill({ id: 'qa' }) : { detail: 'QA second page failure' } } as Response
  }, '/api/proyectos/'), /QA second page failure/)
  assert.equal(calls, 2)
})

test('rechaza una respuesta que no contiene un listado', async () => {
  await assert.rejects(loadProjectPages(async () => ({ ok: true, json: async () => ({ items: [] }) }) as Response,
    '/api/proyectos/'), /listado válido/)
})

test('conserva una build histórica seleccionada al hidratar el proyecto', async () => {
  const selected: string[] = []
  const builds = [
    { id: 'historical', proyecto_id: 'project', componente_id: 'component', nombre: '1.0.0', activo: false, estado: 'HISTORICA' },
    { id: 'active', proyecto_id: 'project', componente_id: 'component', nombre: '1.1.0', activo: true, estado: 'ACTIVA' },
  ]
  const loaders = createProjectLoaders({
    projectsSource: 'backend', currentCompId: 'component', componentsList: [],
    fetchWithAuth: async (url) => ({
      ok: true,
      json: async () => new URL(url, 'http://localhost').pathname.endsWith('/builds/') ? builds : {},
    } as Response),
    setComponentsList: () => {}, setBuildsList: () => {}, setBuildCaseIds: () => {},
    setCurrentCompId: () => {}, setNewTestComponent: () => {},
    setCurrentBuildId: (id) => selected.push(id), setProjectSyncMessage: () => {},
  })
  const result = await loaders.loadBuildsForProject(
    'project', [{ id: 'component', projectId: 'project' }], 'component', 'historical',
  )
  assert.equal(result?.activeBuildId, 'historical')
  assert.equal(selected.at(-1), 'historical')
})

test('solo usa la build activa cuando no existe una selección histórica válida', async () => {
  const selected: string[] = []
  const builds = [
    { id: 'historical', proyecto_id: 'project', componente_id: 'component', nombre: '1.0.0', activo: false, estado: 'HISTORICA' },
    { id: 'active', proyecto_id: 'project', componente_id: 'component', nombre: '1.1.0', activo: true, estado: 'ACTIVA' },
  ]
  const loaders = createProjectLoaders({
    projectsSource: 'backend', currentCompId: 'component', componentsList: [],
    fetchWithAuth: async (url) => ({
      ok: true,
      json: async () => new URL(url, 'http://localhost').pathname.endsWith('/builds/') ? builds : {},
    } as Response),
    setComponentsList: () => {}, setBuildsList: () => {}, setBuildCaseIds: () => {},
    setCurrentCompId: () => {}, setNewTestComponent: () => {},
    setCurrentBuildId: (id) => selected.push(id), setProjectSyncMessage: () => {},
  })

  const result = await loaders.loadBuildsForProject(
    'project', [{ id: 'component', projectId: 'project' }], 'component', 'missing',
  )
  assert.equal(result?.activeBuildId, 'active')
  assert.equal(selected.at(-1), 'active')
})
