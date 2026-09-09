import assert from 'node:assert/strict'
import test from 'node:test'
import { isTerminalUpdateStatus } from './updateMaintenance'

test('maintenance ends for terminal update states, including failed rollback', () => {
  assert.equal(isTerminalUpdateStatus('failed'), true)
  assert.equal(isTerminalUpdateStatus('done', 'applied'), true)
  assert.equal(isTerminalUpdateStatus('done', 'prepared'), false)
  assert.equal(isTerminalUpdateStatus('restarting'), false)
  assert.equal(isTerminalUpdateStatus('in_progress'), false)
})
