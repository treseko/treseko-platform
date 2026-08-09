import assert from 'node:assert/strict'
import test from 'node:test'
import { getManualConsoleCaseStatus } from './manualConsoleStatus'

test('new manual run does not inherit the historical case result', () => {
  assert.equal(getManualConsoleCaseStatus({
    testId: 'case-2',
    currentRun: { id: 'run-1', execution_statuses_by_case_id: { 'case-2': 'SIN_CORRER' } },
    historicalStatus: 'FALLO',
  }), 'SIN_CORRER')
})

test('manual console uses the active run status for non-selected cases', () => {
  assert.equal(getManualConsoleCaseStatus({
    testId: 'case-2',
    currentRun: { id: 'run-1', execution_statuses_by_case_id: { 'case-2': 'PASO' } },
    historicalStatus: 'FALLO',
  }), 'PASO')
})

test('historical status remains available outside an active run', () => {
  assert.equal(getManualConsoleCaseStatus({
    testId: 'case-2',
    historicalStatus: 'FALLO',
  }), 'FALLO')
})

test('selected case uses its current execution status', () => {
  assert.equal(getManualConsoleCaseStatus({
    testId: 'case-1',
    selectedTestId: 'case-1',
    currentRun: { id: 'run-1', execution_statuses_by_case_id: { 'case-1': 'SIN_CORRER' } },
    currentExecutionCase: { estado_resultado: 'FALLO' },
    historicalStatus: 'PASO',
  }), 'FALLO')
})
