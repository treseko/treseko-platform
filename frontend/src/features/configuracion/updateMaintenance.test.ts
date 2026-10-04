import assert from 'node:assert/strict'
import test from 'node:test'
import { isTerminalUpdateStatus, shouldRenewUpdateMaintenance } from './updateMaintenance'

test('maintenance ends for terminal update states, including failed rollback', () => {
  assert.equal(isTerminalUpdateStatus('failed'), true)
  assert.equal(isTerminalUpdateStatus('done', 'applied'), true)
  assert.equal(isTerminalUpdateStatus('done', 'prepared'), false)
  assert.equal(isTerminalUpdateStatus('restarting'), false)
  assert.equal(isTerminalUpdateStatus('in_progress'), false)
})

test('maintenance timeout does not renew forever while the backend keeps reporting restarting', () => {
  assert.equal(shouldRenewUpdateMaintenance({ active: true }), true)
  assert.equal(shouldRenewUpdateMaintenance({ active: false, timedOut: true }), false)
  assert.equal(shouldRenewUpdateMaintenance({ active: false }), false)
})
