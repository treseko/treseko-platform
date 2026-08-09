import assert from 'node:assert/strict'
import test from 'node:test'
import { isBuildReadOnly } from './buildState'

test('allows active and preparation builds, but protects historical builds', () => {
  assert.equal(isBuildReadOnly({ active: true, state: 'ACTIVA' }), false)
  assert.equal(isBuildReadOnly({ active: false, state: 'HISTORICA' }), true)
  assert.equal(isBuildReadOnly({ active: true, state: 'HISTORICA' }), true)
  assert.equal(isBuildReadOnly({ active: false, state: 'PREPARACION' }), false)
  assert.equal(isBuildReadOnly({ active: undefined, state: 'PREPARACION' }), false)
  assert.equal(isBuildReadOnly({ active: false }), true)
})

test('does not infer editability when build data is missing', () => {
  assert.equal(isBuildReadOnly(null), false)
  assert.equal(isBuildReadOnly(undefined), false)
})
