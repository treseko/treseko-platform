import assert from 'node:assert/strict'
import test from 'node:test'
import { isBuildReadOnly } from './buildState'

test('allows only an active build in ACTIVA state', () => {
  assert.equal(isBuildReadOnly({ active: true, state: 'ACTIVA' }), false)
  assert.equal(isBuildReadOnly({ active: false, state: 'HISTORICA' }), true)
  assert.equal(isBuildReadOnly({ active: true, state: 'HISTORICA' }), true)
  assert.equal(isBuildReadOnly({ active: false, state: 'PREPARACION' }), true)
})

test('does not infer editability when build data is missing', () => {
  assert.equal(isBuildReadOnly(null), false)
  assert.equal(isBuildReadOnly(undefined), false)
})
