import assert from 'node:assert/strict'
import test from 'node:test'
import { navigationFromUrl, readWorkspacePreferences, saveWorkspacePreferences, uriForWorkspaceState } from './workspacePreferences'

test('lee la navegación completa desde la URL', () => {
  assert.deepEqual(
    navigationFromUrl('https://treseko.local/?tab=configuracion&config_tab=monitor&org_id=o1&project_id=p1&comp_id=c1&build_id=b1'),
    {
      activeTab: 'configuracion',
      configTab: 'monitor',
      currentOrgId: 'o1',
      currentProjectId: 'p1',
      currentCompId: 'c1',
      currentBuildId: 'b1',
    },
  )
})

test('conserva la subsección de configuración al recargar', () => {
  const url = new URL(uriForWorkspaceState({
    activeTab: 'configuracion',
    configTab: 'ai',
  }, 'https://treseko.local/'), 'https://treseko.local')
  assert.equal(url.searchParams.get('config_tab'), 'ai')
  assert.deepEqual(navigationFromUrl(url.toString()), {
    activeTab: 'configuracion',
    configTab: 'ai',
  })
})

test('serializa configuración y proyecto sin mezclar sus subsecciones', () => {
  const configurationUrl = new URL(uriForWorkspaceState({
    activeTab: 'configuracion',
    configTab: 'monitor',
    managingProjectId: 'p1',
    projectInnerTab: 'components',
  }, 'https://treseko.local/'), 'https://treseko.local')
  assert.equal(configurationUrl.searchParams.get('tab'), 'configuracion')
  assert.equal(configurationUrl.searchParams.get('config_tab'), 'monitor')
  assert.equal(configurationUrl.searchParams.get('project_tab'), null)

  const projectUrl = new URL(uriForWorkspaceState({
    activeTab: 'proyectos',
    managingProjectId: 'p1',
    projectInnerTab: 'components',
  }, 'https://treseko.local/'), 'https://treseko.local')
  assert.equal(projectUrl.searchParams.get('manage_project_id'), 'p1')
  assert.equal(projectUrl.searchParams.get('project_tab'), 'components')
  assert.equal(projectUrl.searchParams.get('config_tab'), null)
})

test('elimina la subsección de proyecto cuando se vuelve al portafolio', () => {
  const url = new URL(uriForWorkspaceState({
    activeTab: 'proyectos',
    projectInnerTab: 'components',
  }, 'https://treseko.local/?project_tab=old&manage_project_id=p1'), 'https://treseko.local')
  assert.equal(url.searchParams.get('project_tab'), null)
  assert.equal(url.searchParams.get('manage_project_id'), null)
})

test('preserva menú lateral y subsecciones por usuario', () => {
  const values = new Map<string, string>()
  const previousStorage = globalThis.localStorage
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  })
  try {
    const user = { id: 'user-06', email: 'qa@example.test' }
    saveWorkspacePreferences(user, {
      activeTab: 'crear_pruebas',
      sidebarCollapsed: true,
      collapsedSections: { location: true, metadata: false },
    })
    assert.deepEqual(readWorkspacePreferences(user), {
      version: 2,
      activeTab: 'crear_pruebas',
      sidebarCollapsed: true,
      collapsedSections: { location: true, metadata: false },
    })
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage })
  }
})
