import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUpdateAdmission } from './update-admission.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-admission-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const request = value => fs.writeFileSync(path.join(directory, 'request.json'),
    JSON.stringify(value), { mode: 0o600 });
  const status = () => JSON.parse(fs.readFileSync(path.join(directory, 'status.json'), 'utf8'));
  return { directory, request, status,
    gate: createUpdateAdmission({ directory, version: '1.0.3' }) };
}
const idle = { activeJobs: 0, pendingResults: 0 };

test('process identity publication is separate from permission to stop', t => {
  const f = fixture(t);
  assert.equal(f.gate.publishIdentity(), true);
  const identity = JSON.parse(fs.readFileSync(path.join(f.directory, 'runtime.json'), 'utf8'));
  assert.equal(identity.version, '1.0.3');
  assert.equal(identity.pid, process.pid);
  assert.equal(Object.hasOwn(identity, 'ready'), false);
  assert.equal(f.gate.pause(idle), false);
  assert.equal(fs.existsSync(path.join(f.directory, 'status.json')), false);
});

test('no request does not create control files or pause ordinary work', t => {
  const f = fixture(t);
  assert.equal(f.gate.pause(idle), false);
  assert.deepEqual(fs.readdirSync(f.directory), []);
});

test('pause acknowledges only drained activity; resume removes receipt', t => {
  const f = fixture(t);
  f.request({ schema: 1, transaction: 'release-1.0.3' });
  for (const activity of [{ activeJobs: 1, pendingResults: 0 },
    { activeJobs: 0, pendingResults: 1 }, idle]) {
    assert.equal(f.gate.pause(activity), true);
    assert.equal(f.status().ready, activity === idle);
    assert.equal(f.status().transaction, 'release-1.0.3');
    assert.equal(f.status().pid, process.pid);
    assert.equal(f.status().version, '1.0.3');
  }
  fs.unlinkSync(path.join(f.directory, 'request.json'));
  assert.equal(f.gate.pause(idle), false);
  assert.equal(fs.existsSync(path.join(f.directory, 'status.json')), false);
});

for (const invalid of [null, { schema: 1, transaction: 123 },
  { schema: 1, transaction: ['tx'] }, { schema: 1, transaction: '../tx' },
  { schema: 1, transaction: 'tx', token: 'must-not-be-accepted' }]) {
  test(`invalid request discards previous acknowledgement: ${JSON.stringify(invalid)}`, t => {
    const f = fixture(t);
    f.request({ schema: 1, transaction: 'tx' });
    f.gate.pause(idle);
    assert.equal(f.status().ready, true);
    f.request(invalid);
    assert.equal(f.gate.pause(idle), true);
    assert.equal(fs.existsSync(path.join(f.directory, 'status.json')), false);
  });
}

test('invalid activity counters cannot acknowledge a safe stop', t => {
  const f = fixture(t);
  f.request({ schema: 1, transaction: 'tx' });
  f.gate.pause(idle);
  assert.equal(f.gate.pause({ activeJobs: -1, pendingResults: 0 }), true);
  assert.equal(fs.existsSync(path.join(f.directory, 'status.json')), false);
});

test('symlink request pauses without reading or overwriting target', t => {
  const f = fixture(t);
  const target = path.join(f.directory, 'protected');
  fs.writeFileSync(target, 'private fixture');
  fs.symlinkSync(target, path.join(f.directory, 'request.json'));
  assert.equal(f.gate.pause(idle), true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'private fixture');
  assert.equal(fs.existsSync(path.join(f.directory, 'status.json')), false);
});
