import { expect, it, vi } from 'vitest'
import { createSuiteActions } from './suiteActions'

const PROJECT_ID = '00000000-0000-4000-8000-000000000001'
const SUITE_ID = '00000000-0000-4000-8000-000000000002'
const PARENT_ID = '00000000-0000-4000-8000-000000000003'

const makeParams = (fetchWithAuth: any, suiteMoveInFlightRef: { current: boolean }) => ({
  contextHydrationVersionRef: { current: 0 },
  suitesLoadVersionRef: { current: 0 },
  suiteMoveInFlightRef,
  t: (key: string) => key,
  projectsSource: 'backend',
  currentCompId: '',
  managingProjectId: null,
  currentProjectId: PROJECT_ID,
  componentsList: [],
  suiteForm: {},
  editingSuiteId: null,
  movingSuiteId: SUITE_ID,
  moveSuiteParentId: PARENT_ID,
  fetchWithAuth,
  setSuitesLoading: vi.fn(),
  setSuitesTree: vi.fn(),
  setProjectSyncMessage: vi.fn(),
  setShowSuiteModal: vi.fn(),
  setSuiteForm: vi.fn(),
  setEditingSuiteId: vi.fn(),
  setShowMoveSuiteModal: vi.fn(),
  setMovingSuiteId: vi.fn(),
  setMoveSuiteParentId: vi.fn(),
  setSelectedSuiteId: vi.fn(),
  setSelectedSubSuiteId: vi.fn(),
  setExpandedSuites: vi.fn(),
  setNewTestSuite: vi.fn(),
  setNewTestSuiteSub: vi.fn(),
  showFeedback: vi.fn(),
  confirmAction: vi.fn(),
})

it('sends only one suite-move request during repeated submission', async () => {
  let finishMove!: (response: Response) => void
  const fetchWithAuth = vi.fn((_: string, options?: RequestInit) => options?.method === 'PATCH'
    ? new Promise<Response>(resolve => { finishMove = resolve })
    : Promise.resolve(Response.json([])))
  const suiteMoveInFlightRef = { current: false }
  const params = makeParams(fetchWithAuth, suiteMoveInFlightRef)

  const first = createSuiteActions(params as any).handleMoveSuite()
  await Promise.resolve()
  const repeated = await createSuiteActions(params as any).handleMoveSuite()

  expect(repeated).toBe(false)
  expect(fetchWithAuth).toHaveBeenCalledTimes(1)
  finishMove(Response.json({ detail: 'moved' }))
  await first
  expect(suiteMoveInFlightRef.current).toBe(false)
})
