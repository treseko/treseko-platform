import assert from 'node:assert/strict'
import test from 'node:test'
import { isTerminalApiStatus } from './ApiAutomationMonitorModal'

test('API monitor treats successful and failed runs as terminal', () => {
  for (const status of ['COMPLETED', 'FAILED', 'ERROR', 'BLOCKED', 'CANCELLED', 'ABORTED', 'TIMEOUT']) {
    assert.equal(isTerminalApiStatus(status), true, status)
  }
})

test('API monitor keeps polling only active states', () => {
  assert.equal(isTerminalApiStatus('PENDING'), false)
  assert.equal(isTerminalApiStatus('RUNNING'), false)
  assert.equal(isTerminalApiStatus(undefined), false)
})
