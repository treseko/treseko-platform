import { expect, it, vi } from 'vitest'
import { createComponentActions } from './componentActions'

const PROJECT_ID = '00000000-0000-4000-8000-000000000001'
const COMPONENT_ID = '00000000-0000-4000-8000-000000000002'

const makeParams = (fetchWithAuth: any, componentMutationInFlightRef: { current: boolean }) => ({
  canEditCurrentProject: true,
  projectsSource: 'backend',
  managingProjectId: PROJECT_ID,
  currentProjectId: PROJECT_ID,
  componentForm: { id: '', name: 'Payments API', description: '', techStack: '', variablesText: '' },
  componentsList: [],
  fetchWithAuth,
  setComponentsList: vi.fn(),
  setCurrentCompId: vi.fn(),
  setNewTestComponent: vi.fn(),
  setCurrentBuildId: vi.fn(),
  setShowComponentModal: vi.fn(),
  setComponentForm: vi.fn(),
  setProjectSyncMessage: vi.fn(),
  showFeedback: vi.fn(),
  confirmAction: vi.fn(),
  t: (key: string) => key,
  componentMutationInFlightRef,
})

const submitEvent = () => ({ preventDefault: vi.fn(), currentTarget: {} } as any)

it('sends only one component-create request during repeated form submission', async () => {
  let finishCreate!: (response: Response) => void
  const fetchWithAuth = vi.fn(() => new Promise<Response>(resolve => { finishCreate = resolve }))
  const componentMutationInFlightRef = { current: false }
  const params = makeParams(fetchWithAuth, componentMutationInFlightRef)

  const first = createComponentActions(params as any).handleSaveComponentForm(submitEvent())
  await Promise.resolve()
  await createComponentActions(params as any).handleSaveComponentForm(submitEvent())

  expect(fetchWithAuth).toHaveBeenCalledTimes(1)
  finishCreate(Response.json({ id: COMPONENT_ID, nombre: 'Payments API', proyecto_id: PROJECT_ID }))
  await first
  expect(componentMutationInFlightRef.current).toBe(false)
})
