import assert from 'node:assert/strict'
import test from 'node:test'
import { createConfigurationActions } from './configurationActions'

function response(body: unknown, ok = true, status = ok ? 200 : 500) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function setup(overrides: Partial<Parameters<typeof createConfigurationActions>[0]> = {}) {
  const state = { apiKeys: [{ id: 'old', activo: true }], attachment: null as any, loading: false, key: '' }
  const feedback: any[] = []
  const fetchWithAuth = overrides.fetchWithAuth || (async () => response({}))
  const actions = createConfigurationActions({
    t: (key: string) => key,
    isAuthenticated: true,
    apiKeys: state.apiKeys,
    apiKeyName: 'Mi clave',
    fetchWithAuth,
    setApiKeys: (update: any) => { state.apiKeys = typeof update === 'function' ? update(state.apiKeys) : update },
    setApiKeysLoading: value => { state.loading = value },
    setNewApiKeyValue: value => { state.key = value },
    setAttachmentConfig: update => { state.attachment = typeof update === 'function' ? update(state.attachment) : update },
    setAttachmentConfigLoading: value => { state.loading = value },
    showFeedback: (...args) => feedback.push(args),
    confirmAction: async () => true,
    ...overrides,
  })
  return { actions, state, feedback }
}

test('configuration actions load and save attachments on happy path', async () => {
  const calls: Request[] = []
  const { actions, state, feedback } = setup({
    fetchWithAuth: async (_url, options) => {
      calls.push(new Request('http://test', options))
      return response(options?.method === 'PATCH' ? { max_mb: 30 } : { max_mb: 25 })
    },
  })
  await actions.loadAttachmentConfig()
  await actions.saveAttachmentConfig({ max_mb: 30 })
  assert.deepEqual(state.attachment, { max_mb: 30 })
  assert.equal(state.loading, false)
  assert.equal(calls.length, 2)
  assert.equal(feedback.length, 1)
})

test('configuration actions report attachment failures and release loading', async () => {
  const { actions, state, feedback } = setup({ fetchWithAuth: async () => response({ detail: 'backend down' }, false) })
  await actions.loadAttachmentConfig()
  await actions.saveAttachmentConfig({ max_mb: 30 })
  assert.equal(state.loading, false)
  assert.equal(feedback.length, 2)
  assert.equal(feedback[0][2], 'warning')
  assert.equal(feedback[1][2], 'danger')
})

test('configuration actions create and revoke an API key', async () => {
  const { actions, state, feedback } = setup({
    apiKeys: [],
    fetchWithAuth: async (_url, options) => options?.method === 'DELETE'
      ? response({ id: 'new', activo: false })
      : response({ id: 'new', activo: true, api_key: 'secret-value' }),
  })
  await actions.createUserApiKey()
  assert.equal(state.key, 'secret-value')
  assert.deepEqual(state.apiKeys[0], { id: 'new', activo: true, api_key: 'secret-value' })
  await actions.revokeUserApiKey('new')
  assert.equal(state.apiKeys[0].activo, false)
  assert.equal(feedback.length, 2)
})

test('configuration actions do not load API keys while unauthenticated', async () => {
  let calls = 0
  const { actions, state } = setup({ isAuthenticated: false, fetchWithAuth: async () => { calls += 1; return response([]) } })
  await actions.loadApiKeys()
  assert.equal(calls, 0)
  assert.equal(state.loading, false)
})

test('configuration actions handle API key creation errors without mutating keys', async () => {
  const original = [{ id: 'old', activo: true }]
  const { actions, state, feedback } = setup({ apiKeys: original, fetchWithAuth: async () => response({ detail: 'forbidden' }, false) })
  await actions.createUserApiKey()
  assert.deepEqual(state.apiKeys, original)
  assert.equal(state.loading, false)
  assert.equal(feedback[0][2], 'danger')
})

test('configuration actions respect cancellation before revoking active keys', async () => {
  let calls = 0
  const { actions, state } = setup({
    confirmAction: async () => false,
    fetchWithAuth: async () => { calls += 1; return response({}) },
  })
  await actions.handleApiKeyEnabledChange(false)
  assert.equal(calls, 0)
  assert.equal(state.apiKeys[0].activo, true)
})
