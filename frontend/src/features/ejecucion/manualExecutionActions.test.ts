import assert from 'node:assert/strict'
import test from 'node:test'
import { createManualExecutionActions } from './manualExecutionActions'

const createActions = (
  events: string[],
  activeRun: any = { id: 'run-1' },
  activeExecutionTests = [
    { id: 'case-1', name: 'Caso actual' },
    { id: 'case-2', name: 'Caso siguiente' }
  ],
  selectedTest = activeExecutionTests[0]
) => createManualExecutionActions({
  activeExecutionTests,
  selectedTest,
  currentExecutionRun: activeRun,
  currentExecutionCase: { id: 'execution-1' },
  currentBuildId: '',
  buildCaseIds: {},
  activeBuildCaseIds: [],
  managingProjectId: null,
  currentProjectId: '',
  componentsList: [],
  executionSnapshots: [],
  stepResults: {},
  snapshotNotes: {},
  snapshotAttachments: {},
  attachmentConfig: {},
  generalExecutionStatus: 'FALLO',
  generalExecutionNote: '',
  generalExecutionSnapshot: null,
  generalExecutionAttachments: [],
  redmineDecisionByExecution: {},
  fetchWithAuth: async () => new Response('{}', { status: 200 }),
  loadExecutionDetails: async () => {
    events.push('load-details-start')
    await new Promise(resolve => setTimeout(resolve, 0))
    events.push('load-details-end')
  },
  loadCasoExecutionHistory: async () => [],
  loadCasosFromBackend: async () => undefined,
  loadBuildCases: async () => [],
  loadBuildCaseExecutionStatus: async () => undefined,
  persistExecutionSnapshots: async snapshots => snapshots,
  getExecutionCompletionPlan: () => ({ canComplete: false }),
  getSnapshotStatus: () => 'PASO',
  returnToExecutionList: () => events.push('return-to-list'),
  setSelectedTest: () => events.push('select-next'),
  setCasosList: () => events.push('update-case-list'),
  setBuildCaseResultHistoryByBuild: () => undefined,
  setStepResults: () => events.push('clear-steps'),
  setSnapshotNotes: () => events.push('clear-notes'),
  setGeneralExecutionStatus: () => events.push('set-status-sin-correr'),
  setGeneralExecutionNote: () => events.push('clear-general-note'),
  setExecutionSnapshots: () => events.push('clear-snapshots'),
  setSnapshotAttachments: () => events.push('clear-snapshot-attachments'),
  setGeneralExecutionSnapshot: () => events.push('clear-general-snapshot'),
  setGeneralExecutionAttachments: () => events.push('clear-general-attachments'),
  setCurrentExecutionCase: () => events.push('clear-current-case'),
  setCurrentExecutionRun: () => events.push('update-run-statuses'),
  setRedmineDecisionByExecution: () => undefined,
  setShowRedminePrompt: () => undefined,
  setShowRedmineDrawer: () => undefined,
  setRedmineBugs: () => undefined,
  t: key => key,
  showFeedback: () => undefined
} as any)

test('advancing an active manual run keeps the finished case visible until the next case loads', async () => {
  const events: string[] = []
  const actions = createActions(events)

  await actions.deferRedmineReportAndContinue()

  assert.deepEqual(events, [
    'load-details-start',
    'load-details-end',
    'select-next',
    'update-case-list'
  ])
  assert.equal(events.includes('set-status-sin-correr'), false)
})

test('advancing without an active run still resets the next case state', async () => {
  const events: string[] = []
  const actions = createActions(events, null)

  await actions.advanceToNextTest()

  assert.equal(events[0], 'clear-steps')
  assert.equal(events.includes('set-status-sin-correr'), true)
  assert.equal(events.at(-2), 'select-next')
  assert.equal(events.at(-1), 'update-case-list')
})

test('completing the last case does not close the console while another case is pending', async () => {
  const events: string[] = []
  const actions = createActions(
    events,
    { id: 'run-1', execution_statuses_by_case_id: { 'case-1': 'SIN_CORRER', 'case-2': 'SIN_CORRER' } },
    [
      { id: 'case-1', name: 'Caso pendiente' },
      { id: 'case-2', name: 'Último caso' }
    ],
    { id: 'case-2', name: 'Último caso' }
  )

  await actions.advanceToNextTest('case-2', 'PASO')

  assert.equal(events.includes('return-to-list'), false)
})

test('closing the console is reserved for a batch whose cases are all terminal', async () => {
  const events: string[] = []
  const actions = createActions(
    events,
    { id: 'run-1', execution_statuses_by_case_id: { 'case-1': 'PASO', 'case-2': 'SIN_CORRER' } },
    [
      { id: 'case-1', name: 'Caso ya terminado' },
      { id: 'case-2', name: 'Último caso' }
    ],
    { id: 'case-2', name: 'Último caso' }
  )

  await actions.advanceToNextTest('case-2', 'FALLO')

  assert.equal(events.includes('return-to-list'), true)
})
