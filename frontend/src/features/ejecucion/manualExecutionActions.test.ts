import assert from 'node:assert/strict'
import test from 'node:test'
import { createManualExecutionActions } from './manualExecutionActions'
import { normalizeExecutionHistoryPayload } from '../casos/caseActions'

test('history payload keeps the real total while returning only the requested page', () => {
  const history = normalizeExecutionHistoryPayload({
    items: [{ estado: 'FALLO', fecha: '2026-08-16T12:00:00Z' }],
    total: 32,
    has_more: true,
    stats: { total: 32, passed: 4, failed: 10, blocked: 18, pending: 0 },
  }, 0, 10)

  assert.equal(history.length, 1)
  assert.equal(history.total, 32)
  assert.equal(history.stats.failed, 10)
  assert.equal(history.hasMore, true)
})

const createActions = (
  events: string[],
  activeRun: any = { id: 'run-1' },
  activeExecutionTests = [
    { id: 'case-1', name: 'Caso actual' },
    { id: 'case-2', name: 'Caso siguiente' }
  ],
  selectedTest = activeExecutionTests[0]
) => {
  const state: any = { selectedTest, casosList: activeExecutionTests, currentExecutionCase: { id: 'execution-1' } }
  const applyState = (current: any, update: any) => typeof update === 'function' ? update(current) : update
  const actions = createManualExecutionActions({
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
  setSelectedTest: update => {
    events.push('select-next')
    state.selectedTest = applyState(state.selectedTest, update)
  },
  setCasosList: update => {
    events.push('update-case-list')
    state.casosList = applyState(state.casosList, update)
  },
  setBuildCaseResultHistoryByBuild: () => undefined,
  setStepResults: () => events.push('clear-steps'),
  setSnapshotNotes: () => events.push('clear-notes'),
  setGeneralExecutionStatus: () => events.push('set-status-sin-correr'),
  setGeneralExecutionNote: () => events.push('clear-general-note'),
  setExecutionSnapshots: () => events.push('clear-snapshots'),
  setSnapshotAttachments: () => events.push('clear-snapshot-attachments'),
  setGeneralExecutionSnapshot: () => events.push('clear-general-snapshot'),
  setGeneralExecutionAttachments: () => events.push('clear-general-attachments'),
  setCurrentExecutionCase: update => {
    events.push('update-current-case')
    state.currentExecutionCase = applyState(state.currentExecutionCase, update)
  },
  setCurrentExecutionRun: () => events.push('update-run-statuses'),
  setRedmineDecisionByExecution: () => undefined,
  setShowRedminePrompt: () => undefined,
  setShowRedmineDrawer: () => undefined,
  setRedmineBugs: () => undefined,
  t: key => key,
  showFeedback: () => undefined
} as any)
  return Object.assign(actions, { getState: () => state })
}

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

test('advancing a case updates its visible result before remote reloads', async () => {
  const events: string[] = []
  const actions = createActions(events)

  await actions.advanceToNextTest('case-1', 'FALLO')

  assert.equal(actions.getState().casosList[0].lastResult, 'FALLO')
  assert.deepEqual(events.slice(0, 3), [
    'select-next',
    'update-case-list',
    'update-run-statuses'
  ])
})

test('specialized consoles can synchronize a terminal result without advancing the batch', () => {
  const events: string[] = []
  const actions = createActions(events)

  actions.syncExecutionCaseStatus('case-1', 'FALLO', { status: 'FALLO', turns: [{ status: 'FAILED' }] })

  assert.equal(actions.getState().casosList[0].lastResult, 'FALLO')
  assert.equal(events.includes('select-next'), true)
  assert.equal(events.includes('update-case-list'), true)
  assert.equal(events.includes('update-run-statuses'), true)
  assert.equal(events.includes('return-to-list'), false)
})

test('chatbot sync updates the execution row even when case and execution ids differ', () => {
  const events: string[] = []
  const actions = createActions(events)

  actions.syncExecutionCaseStatus('case-1', 'FALLO', { status: 'FALLO' })

  assert.equal(actions.getState().currentExecutionCase.estado_resultado, 'FALLO')
})

test('a single chatbot case closes the batch when the logical case id is completed', async () => {
  const events: string[] = []
  const actions = createActions(
    events,
    { id: 'run-1', execution_statuses_by_case_id: { 'case-1': 'SIN_CORRER' } },
    [{ id: 'case-1', name: 'Caso Chatbot' }],
    { id: 'case-1', name: 'Caso Chatbot' },
  )

  await actions.advanceToNextTest('case-1', 'FALLO')

  assert.equal(events.includes('return-to-list'), true)
  assert.equal(events.includes('load-details-start'), false)
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

test('chatbot advancement finds a pending case after the current last case', async () => {
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

  await actions.advanceToNextTest('case-2', 'FALLO', { preferPending: true })

  assert.equal(events.includes('load-details-start'), true)
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
