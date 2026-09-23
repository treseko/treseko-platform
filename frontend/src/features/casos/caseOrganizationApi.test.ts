import assert from 'node:assert/strict'
import test from 'node:test'
import { createCaseOrganizationApi } from './caseOrganizationApi'

test('sends organization through the configured transactional endpoint', async () => {
  const calls: any[] = []
  const api = createCaseOrganizationApi({
    endpoint: '/api/casos/reorder',
    fetchWithAuth: async (url, init) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ cases: [], revision: 'next' }), { status: 200 })
    },
  })
  await api.organize({ caso_id: 'case-1', suite_id: 'suite-2', orden: ['case-1'], revision: 'rev-1' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/casos/reorder')
  assert.equal(calls[0].init.method, 'PATCH')
  assert.deepEqual(JSON.parse(calls[0].init.body), { caso_id: 'case-1', suite_id: 'suite-2', orden: ['case-1'], revision: 'rev-1' })
})

test('returns server errors without hiding rollback responsibility from the caller', async () => {
  const api = createCaseOrganizationApi({
    endpoint: '/api/casos/reorder',
    fetchWithAuth: async () => new Response(JSON.stringify({ detail: 'conflict' }), { status: 409 }),
  })
  await assert.rejects(() => api.organize({ caso_id: 'case-1', suite_id: 'suite-2', orden: ['case-1'], revision: 'rev-1' }), /conflict/)
})
