import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOrganizationPayload, applyCanonicalOrganization, moveCaseInOrder, createCaseOrganizationHandler, organizationRevision, isCaseOrganizationAvailable, stopCaseDropPropagation, type OrganizationResponse } from './caseOrganization'

test('case organization is unavailable while search or component filters hide siblings', () => {
  assert.equal(isCaseOrganizationAvailable('', ''), true)
  assert.equal(isCaseOrganizationAvailable('login', ''), false)
  assert.equal(isCaseOrganizationAvailable('', 'component-1'), false)
})

test('nested case drops stop propagation before organizing', () => {
  let stopped = false
  stopCaseDropPropagation({ stopPropagation: () => { stopped = true } })
  assert.equal(stopped, true)
})

test('moves a case across suites and inserts it at the requested position', () => {
  const cases = [
    { id: 'a', suiteId: 'one' },
    { id: 'b', suiteId: 'one' },
    { id: 'c', suiteId: 'two' },
  ]
  assert.deepEqual(moveCaseInOrder(cases, 'b', 'two', 1), [
    { id: 'a', suiteId: 'one' },
    { id: 'c', suiteId: 'two' },
    { id: 'b', suiteId: 'two' },
  ])
})

test('moves the first case to the end of its current suite', () => {
  const cases = [
    { id: 'a', suiteId: 'one' },
    { id: 'b', suiteId: 'one' },
    { id: 'c', suiteId: 'one' },
  ]
  assert.deepEqual(moveCaseInOrder(cases, 'a', 'one', 2), [
    { id: 'b', suiteId: 'one' },
    { id: 'c', suiteId: 'one' },
    { id: 'a', suiteId: 'one' },
  ])
})

test('builds one transactional organization payload with canonical ids', () => {
  assert.deepEqual(buildOrganizationPayload('case-b', 'suite-two', 0, ['case-c', 'case-b'], undefined, 'rev-1'), {
    caso_id: 'case-b',
    suite_id: 'suite-two',
    orden: ['case-c', 'case-b'],
    revision: 'rev-1',
  })
})

test('uses canonical server order and preserves unrelated fields', () => {
  const current = [{ id: 'a', title: 'A', suiteId: 'one' }, { id: 'b', title: 'B', suiteId: 'two' }]
  const response: OrganizationResponse = {
    cases: [{ id: 'b', suite_id: 'two', orden: 0 }, { id: 'a', suite_id: 'one', orden: 0 }],
    revision: 'next',
  }
  assert.deepEqual(applyCanonicalOrganization(current, response), [
    { id: 'b', title: 'B', suiteId: 'two', orden: 0 },
    { id: 'a', title: 'A', suiteId: 'one', orden: 0 },
  ])
})

test('handler sends source and destination sibling ids and applies canonical response', async () => {
  const calls: any[] = []
  let state = [{ id: 'a', suiteId: 'one' }, { id: 'b', suiteId: 'one' }, { id: 'c', suiteId: 'two' }]
  const handler = createCaseOrganizationHandler({
    api: { organize: async (payload: any) => { calls.push(payload); return { cases: [
      { id: 'a', suite_id: 'one', orden: 0 },
      { id: 'c', suite_id: 'two', orden: 0 },
      { id: 'b', suite_id: 'two', orden: 1 },
    ], revision: 'next' } } },
    getCases: () => state,
    setCases: (next) => { state = next },
  })
  assert.equal(await handler(state[1], 'two', 1), true)
  assert.equal(calls[0].revision, organizationRevision([{ id: 'a', suiteId: 'one' }, { id: 'b', suiteId: 'one' }, { id: 'c', suiteId: 'two' }]))
  assert.equal(state.find(item => item.id === 'b')?.suiteId, 'two')
})

test('handler rejects the synthetic unsuited root before making a request', async () => {
  let called = false
  const handler = createCaseOrganizationHandler({
    api: { organize: async () => { called = true; return { cases: [], revision: 'next' } } },
    getCases: () => [{ id: 'a', suiteId: 'one' }],
    setCases: () => undefined,
  })
  assert.equal(await handler({ id: 'a', suiteId: 'one' }, null, 0), false)
  assert.equal(called, false)
})
