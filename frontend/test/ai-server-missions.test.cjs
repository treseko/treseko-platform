const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, deps = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => deps[name], Date, Intl, Set, Map,
    window: { setTimeout: () => { throw new Error('Browser timer must not own execution'); } } });
  return exports;
}
const dates = load('src/shared/utils/dateTime.ts');
const actions = load('src/features/motor-ia/iaMissionActions.ts', {
  '../../app/constants': { API_BASE: '/api' }, '../../app/validation': { isValidUUID: value => /^[a-f0-9-]{36}$/i.test(value) },
  '../../shared/utils/dateTime': dates, '../../app/errorMessages': { humanizeAiError: value => String(value) },
});
const project = '00000000-0000-4000-8000-000000000001';
const build = '00000000-0000-4000-8000-000000000002';
const cases = ['00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004'];
const noop = () => {};
function setup(ok = true) {
  const calls = [], feedback = [];
  const instance = actions.createIaMissionActions({ projectsSource: 'backend', currentProjectId: project, currentBuildId: build,
    buildsList: [{ id: build, active: true, componentId: 'web' }], currentProjectCases: cases.map(id => ({ id, componentId: 'web' })),
    selectedTestsForIa: cases, execName: 'Server mission', scheduledTime: dates.toDateTimeLocalInput(new Date(Date.now() + 120000).toISOString()),
    fetchWithAuth: async (url, options) => { calls.push({ url, options }); return { ok, json: async () => url.includes('/ejecuciones/') ? [] : { id: 'run', nombre: 'Server mission', detail: 'denied' } }; },
    setProjectSyncMessage: noop, setIaQueue: noop, setIaExecutionStreams: noop, setIaLogs: noop,
    setShowIaScheduler: noop, setActiveTab: noop, showFeedback: (...args) => feedback.push(args), t: key => key,
  });
  return { ...instance, calls, feedback };
}
test('scheduling persists all selected cases immediately without a browser timer', async () => {
  const state = setup();
  await state.handleLaunchIaMission('scheduled');
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].url, '/api/ai-schedules/');
  const body = JSON.parse(state.calls[0].options.body);
  assert.deepEqual(body.caso_ids, cases);
  assert.ok(body.scheduled_at.endsWith('Z'));
  assert.equal(state.feedback[0][2], 'success');
});
test('immediate mission submits the whole batch with no per-case browser dispatch', async () => {
  const state = setup();
  await state.handleLaunchIaMission('now');
  assert.equal(state.calls[0].url, '/api/ai-missions/');
  assert.deepEqual(JSON.parse(state.calls[0].options.body).caso_ids, cases);
  assert.equal(state.calls.filter(call => call.options?.method === 'POST').length, 1);
  assert.ok(!state.calls.some(call => call.url.includes('/automatizar/')));
});
test('backend refusal cannot produce a successful scheduling message', async () => {
  const state = setup(false);
  await state.handleLaunchIaMission('scheduled');
  assert.equal(state.feedback[0][2], 'danger');
});

test('recording choice is sent for both immediate and scheduled batches', async () => {
 for (const mode of ['now','scheduled']) {
  const state=setup();
  await state.handleLaunchIaMission(mode,{recordVideo:false});
  assert.equal(JSON.parse(state.calls[0].options.body).record_video,false);
 }
});

test('shared guard prevents duplicate scheduling across recreated action factories', async () => {
  let resolve;
  const inFlight = { current: false };
  let requests = 0;
  const params = { projectsSource: 'backend', currentProjectId: project, currentBuildId: build,
    buildsList: [{ id: build, active: true, componentId: 'web' }], currentProjectCases: cases.map(id => ({ id, componentId: 'web' })),
    selectedTestsForIa: cases, execName: 'Server mission', scheduledTime: dates.toDateTimeLocalInput(new Date(Date.now() + 120000).toISOString()),
    iaMissionSubmissionRef: inFlight,
    fetchWithAuth: async () => { requests++; return new Promise(r => { resolve = r; }); },
    setProjectSyncMessage: noop, setIaQueue: noop, setIaExecutionStreams: noop, setIaLogs: noop,
    setShowIaScheduler: noop, setActiveTab: noop, showFeedback: noop, t: key => key };
  const first = actions.createIaMissionActions(params).handleLaunchIaMission('scheduled');
  await actions.createIaMissionActions(params).handleLaunchIaMission('scheduled');
  assert.equal(requests, 1);
  resolve({ ok: true, json: async () => ({ id: 'mission' }) });
  await first;
  assert.equal(inFlight.current, false);
});

test('failed scheduling preserves the modal and allows a later retry', async () => {
  const closed = [], feedback = [];
  let requests = 0;
  const instance = actions.createIaMissionActions({ projectsSource: 'backend', currentProjectId: project, currentBuildId: build,
    buildsList: [{ id: build, active: true, componentId: 'web' }], currentProjectCases: cases.map(id => ({ id, componentId: 'web' })),
    selectedTestsForIa: cases, execName: 'Server mission', scheduledTime: dates.toDateTimeLocalInput(new Date(Date.now() + 120000).toISOString()),
    fetchWithAuth: async () => { requests++; return { ok: requests > 1, text: async () => 'Service unavailable', json: async () => ({ id: 'mission' }) }; },
    setProjectSyncMessage: noop, setIaQueue: noop, setIaExecutionStreams: noop, setIaLogs: noop,
    setShowIaScheduler: value => closed.push(value), setActiveTab: noop, showFeedback: (...args) => feedback.push(args), t: key => key });
  await instance.handleLaunchIaMission('scheduled');
  assert.equal(closed.length, 0);
  assert.equal(feedback.at(-1)[2], 'danger');
  await instance.handleLaunchIaMission('scheduled');
  assert.equal(requests, 2);
  assert.deepEqual(closed, [false]);
  assert.equal(feedback.at(-1)[2], 'success');
});
