import { cleanup, render, screen, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createProjectActions } from './projectActions'
import { ProjectPortfolioGrid } from './ProjectPortfolioGrid'
import { createCaseActions } from '../casos/caseActions'
import { createSuiteActions } from '../casos/suiteActions'
import { useAppSessionBootstrap } from '../../app/useAppSessionBootstrap'

vi.mock('../../shared/hooks/useLiveRefresh', () => ({ useLiveRefresh: () => {} }))
afterEach(cleanup)
const A = '00000000-0000-4000-8000-000000000001'
const B = '00000000-0000-4000-8000-000000000002'
const noop = () => {}
const base = () => ({
  t: (key: string) => key, projectsSource: 'backend', currentOrgId: 'org',
  currentProjectId: A, managingProjectId: null, componentsList: [], organizations: [], projectsList: [],
  setProjectsLoading: vi.fn(), setProjectsList: vi.fn(), setCurrentProjectId: vi.fn(),
  setCurrentOrgId: vi.fn(), setSelectedOrganizationId: vi.fn(), setCurrentCompId: vi.fn(),
  setCurrentBuildId: vi.fn(), setProjectsSource: vi.fn(), setProjectSyncMessage: vi.fn(),
  showFeedback: vi.fn(), projectCreateInFlightRef: { current: false },
})
const formEvent = () => {
  const form = document.createElement('form')
  form.innerHTML = '<input name="projName" value="Sales QA">'
  document.body.append(form)
  return { form, event: { preventDefault: noop, currentTarget: form } as any }
}

it('keeps the form after failure and permits a successful retry', async () => {
  const params = { ...base(), fetchWithAuth: vi.fn()
    .mockResolvedValueOnce(Response.json({ detail: 'QA failure' }, { status: 500 }))
    .mockResolvedValueOnce(Response.json({ id: A, nombre: 'Sales QA', organizacion_id: 'org' })) }
  const { form, event } = formEvent()
  // reset restores defaults, so use a real user edit distinct from the initial value.
  const input = form.elements.namedItem('projName') as HTMLInputElement
  input.value = 'Typed Sales QA'
  const actions = createProjectActions(params as any)
  await actions.handleCreateProject(event)
  expect(input.value).toBe('Typed Sales QA')
  expect(params.projectCreateInFlightRef.current).toBe(false)
  await actions.handleCreateProject(event)
  expect(input.value).toBe('Sales QA')
  expect(params.fetchWithAuth).toHaveBeenCalledTimes(2)
  form.remove()
})

it('blocks simultaneous submissions across recreated action factories', async () => {
  let release!: (response: Response) => void
  const params = { ...base(), fetchWithAuth: vi.fn(() => new Promise<Response>(resolve => { release = resolve })) }
  const { form, event } = formEvent()
  const first = createProjectActions(params as any).handleCreateProject(event)
  await createProjectActions(params as any).handleCreateProject(event)
  expect(params.fetchWithAuth).toHaveBeenCalledTimes(1)
  release(Response.json({ id: A, nombre: 'Sales QA', organizacion_id: 'org' }))
  await first
  expect(params.showFeedback).not.toHaveBeenCalled()
  expect(params.projectCreateInFlightRef.current).toBe(false)
  form.remove()
})

it('keeps an explicitly selected empty organization after loading projects', async () => {
  const params = { ...base(), currentOrgId: 'empty', organizations: [{ id: 'empty' }, { id: 'other' }],
    fetchWithAuth: vi.fn(async () => Response.json([{ id: A, nombre: 'Other project', organizacion_id: 'other' }])) }
  await createProjectActions(params as any).loadProjectsFromBackend()
  expect(params.setCurrentOrgId).toHaveBeenLastCalledWith('empty')
  expect(params.setCurrentProjectId).toHaveBeenLastCalledWith('')
})

it('session recovery does not jump from an empty organization to another', () => {
  const setter = vi.fn()
  renderHook(() => useAppSessionBootstrap({
    isAuthenticated: true, projectsSource: 'backend', workspacePreferencesHydrated: false,
    loggedUser: {}, syncSessionFromBackend: noop, setIsAuthenticated: noop,
    initialBackendLoadKeyRef: { current: '' }, organizationMembersLoadKeyRef: { current: '' },
    projectsLoading: false, projectsList: [{ id: A, orgId: 'other' }],
    currentProjectId: '', currentOrgId: 'empty', setCurrentProjectId: setter,
    setCurrentOrgId: setter, setSelectedOrganizationId: setter,
    setCurrentCompId: setter, setCurrentBuildId: setter, hydrateProjectContext: setter,
  }))
  expect(setter).not.toHaveBeenCalled()
})

for (const kind of ['cases', 'suites']) {
  for (const fail of [false, true]) {
    it(`discards late ${kind} ${fail ? 'errors' : 'results'} after a project change`, async () => {
      let release!: (response: Response) => void
      const contextHydrationVersionRef = { current: 0 }, generation = { current: 0 }
      const setItems = vi.fn(), setError = vi.fn()
      const fetcher = vi.fn((url: string) => url.includes(A)
        ? new Promise<Response>(resolve => { release = resolve })
        : Promise.resolve(Response.json([{ id: 'B-item' }])))
      const make = () => kind === 'cases'
        ? createCaseActions({ contextHydrationVersionRef, casesLoadVersionRef: generation,
          projectsSource: 'backend', componentsList: [], currentBuildId: '', buildCaseResultHistoryByBuild: {},
          fetchWithAuth: fetcher, mapBackendCasoToTest: (x: any) => x,
          setCasosList: setItems, setCasosLoading: noop, setProjectSyncMessage: setError, t: (x: string) => x } as any)
        : createSuiteActions({ contextHydrationVersionRef, suitesLoadVersionRef: generation,
          projectsSource: 'backend', fetchWithAuth: fetcher, setSuitesTree: setItems,
          setSuitesLoading: noop, setProjectSyncMessage: setError, t: (x: string) => x } as any)
      const load = (actions: any, id: string) => kind === 'cases'
        ? actions.loadCasosFromBackend(id) : actions.loadSuitesFromBackend(id)
      const old = load(make(), A)
      contextHydrationVersionRef.current++
      await load(make(), B)
      release(Response.json(fail ? { detail: 'obsolete' } : [{ id: 'A-item' }], { status: fail ? 500 : 200 }))
      await old
      expect(setItems).toHaveBeenCalledTimes(1)
      expect(setError).not.toHaveBeenCalled()
    })
  }
}


for (const editable of [true, false]) {
  it(`explains an empty portfolio for ${editable ? 'creators' : 'readers'}`, () => {
    render(<ProjectPortfolioGrid context={{
      t: (key: string) => key, activeOrganizations: [{ id: 'empty' }],
      currentOrgId: 'empty', projectsList: [], projectsLoading: false,
      canEditProjectPortfolio: editable, handleCreateProject: noop,
    }} />)
    expect(screen.getByRole('status')).toHaveTextContent('proyectos.noProjectsInSolution')
    expect(screen.getByRole('status')).toHaveTextContent(editable
      ? 'proyectos.createFirstProjectHint' : 'proyectos.askForFirstProjectHint')
  })
}
