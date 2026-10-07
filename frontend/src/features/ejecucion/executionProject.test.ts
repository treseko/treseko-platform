import assert from 'node:assert/strict'
import test from 'node:test'
import { readBackendError } from '../../app/errorMessages'
import { resolveExecutionProjectId } from './executionProject'

test('execution uses the project that owns the selected build when navigation context is stale', () => {
  assert.equal(resolveExecutionProjectId({
    buildsList: [{ id: 'active-build', projectId: 'build-project' }],
    currentBuildId: 'active-build',
    currentProjectId: 'old-project',
    managingProjectId: 'stale-project',
  }), 'build-project')
})

test('execution fails closed when a selected build has not loaded instead of using stale project context', () => {
  assert.equal(resolveExecutionProjectId({
    currentBuildId: 'missing-build',
    currentProjectId: 'current-project',
    managingProjectId: 'stale-project',
  }), '')
})

test('execution uses workspace project context when no build is selected', () => {
  assert.equal(resolveExecutionProjectId({
    currentProjectId: 'current-project',
    managingProjectId: 'stale-project',
  }), 'current-project')
})

test('execution errors display the backend message instead of the raw JSON envelope', async () => {
  const message = await readBackendError(new Response(JSON.stringify({
    error: {
      error_code: 'NOT_FOUND',
      message: 'Proyecto no encontrado',
      correlation_id: '8df73e07-0c1d-4d37-b0b9-e53ba2925d37',
      details: {},
    },
    detail: 'Proyecto no encontrado',
  }), { status: 404 }), 'Error de ejecución')

  assert.equal(message, 'Proyecto no encontrado')
})
