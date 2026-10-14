const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/features/ejecucion/executionActions.ts'), 'utf8');
test('execution selection submits one durable backend batch, preserving context and recording', () => {
  assert.ok(source.includes('/execution-batches/'));
  assert.ok(source.includes('selectedExecutionEnvironmentId'));
  assert.ok(source.includes('selectedExecutionDatasetId'));
  assert.ok(source.includes('record_video: executionOptions.recordVideo !== false'));
  assert.ok(!source.includes('/automatizar/'));
  assert.ok(!source.includes('runNextIaExecution'));
  assert.ok(!source.includes('waitForIaExecutionToFinish'));
});
const ts = require('typescript');
const vm = require('node:vm');
const exported = {};
const dependencies = {
  '../../app/constants': { API_BASE: '/api' },
  '../../app/validation': { isValidUUID: value => /^[a-f0-9-]{36}$/i.test(value) },
  '../../app/buildState': { isBuildExecutable: () => true },
  './executionProject': { resolveExecutionProjectId: params => params.currentProjectId },
  '../../app/errorMessages': { readBackendError: async () => 'denied' },
};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
  exports: exported, require: key => dependencies[key] || {}, Date, Set, Map,
  window: { setTimeout: () => { throw new Error('The browser must not schedule execution'); } },
});
for (const mode of ['ia', 'automated', 'manual']) {
  test(`${mode} submits all cases once and retains environment and dataset`, async () => {
    const project = '00000000-0000-4000-8000-000000000001';
    const build = '00000000-0000-4000-8000-000000000002';
    const tests = [3, 4].map(n => ({ id: `00000000-0000-4000-8000-00000000000${n}`, componentId: 'web' }));
    const calls = [];
    const actions = exported.createExecutionActions({ currentProjectId: project, currentBuildId: build, currentCompId: 'web',
      buildsList: [{ id: build, componentId: 'web' }], buildCaseIds: { [build]: tests.map(item => item.id) },
      selectedExecutionEnvironmentId: project, selectedExecutionDatasetId: build, t: key => key,
      fetchWithAuth: async (url, options) => { calls.push({url, body: JSON.parse(options.body)}); return {ok: true, json: async () => ({id: 'run'})}; },
    });
    await actions.createExecutionRun(mode, tests, undefined, {recordVideo: false});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, mode === 'manual' ? '/api/test-runs/' : '/api/execution-batches/');
    assert.deepEqual(Array.from(calls[0].body.caso_ids), tests.map(item => item.id));
    assert.equal(calls[0].body.entorno_id, project);
    assert.equal(calls[0].body.dataset_id, build);
    if (mode !== 'manual') assert.equal(calls[0].body.record_video, false);
  });
}
