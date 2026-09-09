import assert from 'node:assert/strict'
import test from 'node:test'
import { isBuildExecutable, isBuildReadOnly } from './buildState'

test('only marks a build executable when both indicators agree', () => {
  assert.equal(isBuildExecutable({ active: true, state: 'ACTIVA' }), true)
  assert.equal(isBuildExecutable({ active: true, state: 'PREPARACION' }), false)
  assert.equal(isBuildExecutable({ active: false, state: 'ACTIVA' }), false)
  assert.equal(isBuildExecutable({ active: false, state: 'PREPARACION' }), false)
})

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
