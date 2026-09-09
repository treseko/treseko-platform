import assert from 'node:assert/strict'
import test from 'node:test'
import { createExecutionSelectorActions } from './executionSelectorActions'

const noop = () => undefined

test('opens the execution batch with every globally selected API case across suites', () => {
  const selectedExecutionTests = Array.from({ length: 123 }, (_, index) => ({
    id: `api-case-${index + 1}`,
    formato_prueba: 'API',
  }))
  const visibleTests = selectedExecutionTests.slice(0, 10)
  let modalCaseIds: string[] | null = null
  let selectorShown = false
  let feedbackCount = 0

  const actions = createExecutionSelectorActions({
    filteredTests: visibleTests,
    selectedExecutionTests,
    selectedExecutionDiscardedCount: 0,
    suiteBuildMissingCount: 0,
    suiteComponentMismatchCount: 0,
    executionModalTests: [],
    setExecutionModalCaseIds: value => {
      modalCaseIds = typeof value === 'function' ? value(null) : value
    },
    setShowExecSelector: value => {
      selectorShown = value
    },
    setSelectedTest: noop,
    setSelectedTestsForIa: noop,
    setSchedulerSearch: noop,
    setExecName: noop,
    setScheduledTime: noop,
    setShowIaScheduler: noop,
    showFeedback: () => {
      feedbackCount += 1
    },
    t: key => key,
  })

  actions.openExecutionSelector()

  assert.equal(selectorShown, true)
  assert.equal(feedbackCount, 0)
  assert.deepEqual(modalCaseIds, selectedExecutionTests.map(testCase => testCase.id))
  assert.equal(modalCaseIds?.length, 123)
})

test('does not block a global selection when the current suite has no visible cases', () => {
  const selectedExecutionTests = [{ id: 'api-from-another-suite', formato_prueba: 'API' }]
  let modalCaseIds: string[] | null = null
  let selectorShown = false

  const actions = createExecutionSelectorActions({
    filteredTests: [],
    selectedExecutionTests,
    selectedExecutionDiscardedCount: 0,
    suiteBuildMissingCount: 3,
    suiteComponentMismatchCount: 0,
    executionModalTests: [],
    setExecutionModalCaseIds: value => {
      modalCaseIds = typeof value === 'function' ? value(null) : value
    },
    setShowExecSelector: value => {
      selectorShown = value
    },
    setSelectedTest: noop,
    setSelectedTestsForIa: noop,
    setSchedulerSearch: noop,
    setExecName: noop,
    setScheduledTime: noop,
    setShowIaScheduler: noop,
    showFeedback: noop,
    t: key => key,
  })

  actions.openExecutionSelector()

  assert.equal(selectorShown, true)
  assert.deepEqual(modalCaseIds, ['api-from-another-suite'])
})

test('removes a case from the modal and the global execution selection', () => {
  let modalCaseIds: string[] | null = ['api-case', 'classic-case']
  let selectedExecutionTestIds = ['api-case', 'classic-case']

  const actions = createExecutionSelectorActions({
    filteredTests: [],
    selectedExecutionTests: [],
    selectedExecutionDiscardedCount: 0,
    suiteBuildMissingCount: 0,
    suiteComponentMismatchCount: 0,
    executionModalTests: [],
    setExecutionModalCaseIds: value => {
      modalCaseIds = typeof value === 'function' ? value(modalCaseIds) : value
    },
    setSelectedExecutionTestIds: value => {
      selectedExecutionTestIds = typeof value === 'function' ? value(selectedExecutionTestIds) : value
    },
    setShowExecSelector: noop,
    setSelectedTest: noop,
    setSelectedTestsForIa: noop,
    setSchedulerSearch: noop,
    setExecName: noop,
    setScheduledTime: noop,
    setShowIaScheduler: noop,
    showFeedback: noop,
    t: key => key,
  })

  actions.removeExecutionModalCase('classic-case')

  assert.deepEqual(modalCaseIds, ['api-case'])
  assert.deepEqual(selectedExecutionTestIds, ['api-case'])
})

test('restores a deselected format in the modal and global execution selection', () => {
  let modalCaseIds: string[] | null = ['api-case']
  let selectedExecutionTestIds = ['api-case']

  const actions = createExecutionSelectorActions({
    filteredTests: [],
    selectedExecutionTests: [],
    selectedExecutionDiscardedCount: 0,
    suiteBuildMissingCount: 0,
    suiteComponentMismatchCount: 0,
    executionModalTests: [],
    setExecutionModalCaseIds: value => {
      modalCaseIds = typeof value === 'function' ? value(modalCaseIds) : value
    },
    setSelectedExecutionTestIds: value => {
      selectedExecutionTestIds = typeof value === 'function' ? value(selectedExecutionTestIds) : value
    },
    setShowExecSelector: noop,
    setSelectedTest: noop,
    setSelectedTestsForIa: noop,
    setSchedulerSearch: noop,
    setExecName: noop,
    setScheduledTime: noop,
    setShowIaScheduler: noop,
    showFeedback: noop,
    t: key => key,
  })

  actions.restoreExecutionModalCases(['classic-case', 'api-case'])

  assert.deepEqual(modalCaseIds, ['api-case', 'classic-case'])
  assert.deepEqual(selectedExecutionTestIds, ['api-case', 'classic-case'])
})

test('can remove and restore the same format repeatedly without losing its case ids', () => {
  let modalCaseIds: string[] | null = ['api-1', 'api-2', 'classic-1']
  let selectedExecutionTestIds = ['api-1', 'api-2', 'classic-1']

  const actions = createExecutionSelectorActions({
    filteredTests: [],
    selectedExecutionTests: [],
    selectedExecutionDiscardedCount: 0,
    suiteBuildMissingCount: 0,
    suiteComponentMismatchCount: 0,
    executionModalTests: [],
    setExecutionModalCaseIds: value => {
      modalCaseIds = typeof value === 'function' ? value(modalCaseIds) : value
    },
    setSelectedExecutionTestIds: value => {
      selectedExecutionTestIds = typeof value === 'function' ? value(selectedExecutionTestIds) : value
    },
    setShowExecSelector: noop,
    setSelectedTest: noop,
    setSelectedTestsForIa: noop,
    setSchedulerSearch: noop,
    setExecName: noop,
    setScheduledTime: noop,
    setShowIaScheduler: noop,
    showFeedback: noop,
    t: key => key,
  })

  actions.removeExecutionModalCase('api-1')
  actions.removeExecutionModalCase('api-2')
  actions.restoreExecutionModalCases(['api-1', 'api-2'])

  assert.deepEqual(modalCaseIds, ['classic-1', 'api-1', 'api-2'])
  assert.deepEqual(selectedExecutionTestIds, ['classic-1', 'api-1', 'api-2'])
})
