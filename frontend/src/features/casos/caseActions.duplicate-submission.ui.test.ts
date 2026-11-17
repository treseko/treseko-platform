import { expect, it, vi } from 'vitest'
import { createCaseActions } from './caseActions'

const PROJECT_ID = '00000000-0000-4000-8000-000000000001'
const CASE_ID = '00000000-0000-4000-8000-000000000002'
const SUITE_ID = '00000000-0000-4000-8000-000000000003'

const makeParams = (fetchWithAuth: any, caseCloneInFlightRef: { current: boolean }) => ({
  contextHydrationVersionRef: { current: 0 },
  casesLoadVersionRef: { current: 0 },
  caseCloneInFlightRef,
  t: (key: string) => key,
  projectsSource: 'backend',
  managingProjectId: PROJECT_ID,
  currentProjectId: PROJECT_ID,
  currentBuildId: '',
  componentsList: [],
  casosPage: 0,
  casosPageSize: 50,
  casosSearchQuery: '',
  casosFilterSuite: null,
  casosFilterPrioridad: null,
  casosFilterCriticidad: null,
  casosFilterEstado: null,
  casosFilterEtiqueta: '',
  selectedTest: null,
  buildCaseResultHistoryByBuild: {},
  fetchWithAuth,
  mapBackendCasoToTest: (item: any) => item,
  setCasosLoading: vi.fn(),
  setCasosList: vi.fn(),
  setCasosSearchResults: vi.fn(),
  setCasosTotal: vi.fn(),
  setShowCasoModal: vi.fn(),
  setProjectSyncMessage: vi.fn(),
  setCaseVersions: vi.fn(),
  setVersionsCase: vi.fn(),
  setSelectedCompareVersionId: vi.fn(),
  setShowVersionsModal: vi.fn(),
  showFeedback: vi.fn(),
  confirmAction: vi.fn(),
})

it('sends only one case-clone request during repeated submission', async () => {
  let finishClone!: (response: Response) => void
  const fetchWithAuth = vi.fn((_: string, options?: RequestInit) => options?.method === 'POST'
    ? new Promise<Response>(resolve => { finishClone = resolve })
    : Promise.resolve(Response.json({ items: [], total: 0, has_more: false })))
  const caseCloneInFlightRef = { current: false }
  const params = makeParams(fetchWithAuth, caseCloneInFlightRef)

  const first = createCaseActions(params as any).handleCloneCaso(CASE_ID, SUITE_ID)
  await Promise.resolve()
  const repeated = await createCaseActions(params as any).handleCloneCaso(CASE_ID, SUITE_ID)

  expect(repeated).toBe(false)
  expect(fetchWithAuth).toHaveBeenCalledTimes(1)
  finishClone(Response.json({ id: 'cloned-case', proyecto_id: PROJECT_ID }))
  await first
  expect(caseCloneInFlightRef.current).toBe(false)
})
