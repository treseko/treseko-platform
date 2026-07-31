import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectLoaders } from './projectLoaders'

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
      json: async () => url.endsWith('/builds/') ? builds : {},
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
      json: async () => url.endsWith('/builds/') ? builds : {},
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
