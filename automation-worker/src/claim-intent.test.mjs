import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClaimIntent } from './claim-intent.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-claim-intent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('claim intent survives reopening and only matching confirmation clears it', t => {
  const dir = fixture(t);
  const intent = createClaimIntent(dir);
  assert.equal(intent.pending(), null);
  intent.begin('job-one');
  const attempt = intent.attemptId();
  assert.match(attempt, /^[0-9a-f-]{36}$/);
  const reopened = createClaimIntent(dir);
  assert.equal(reopened.pending(), 'job-one');
  assert.equal(reopened.attemptId(), attempt);
  assert.throws(() => reopened.begin('job-two'));
  reopened.confirmed('job-two');
  assert.equal(reopened.pending(), 'job-one');
  reopened.confirmed('job-one');
  assert.equal(reopened.pending(), null);
  reopened.begin('job-one');
  assert.notEqual(reopened.attemptId(), attempt);
});

test('legacy unresolved intent stays blocked without inventing an attempt identity', t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'claim.json'),
    '{"schema":1,"job_id":"old-job"}', { mode: 0o600 });
  const intent = createClaimIntent(dir);
  assert.equal(intent.pending(), 'old-job');
  assert.equal(intent.attemptId(), null);
  assert.throws(() => intent.begin('old-job'));
});

test('partial journal fails closed instead of declaring no pending claim', t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'claim.json'), '{', { mode: 0o600 });
  assert.throws(() => createClaimIntent(dir).pending());
  assert.throws(() => createClaimIntent(dir).begin('job-one'));
});

test('symlink journal is not followed', t => {
  const dir = fixture(t);
  const target = path.join(dir, 'fixture');
  fs.writeFileSync(target, 'unchanged');
  fs.symlinkSync(target, path.join(dir, 'claim.json'));
  assert.throws(() => createClaimIntent(dir).pending());
  assert.equal(fs.readFileSync(target, 'utf8'), 'unchanged');
});

test('only a matching CLOSED receipt clears the durable attempt', t => {
  const intent = createClaimIntent(fixture(t));
  intent.begin('job-one');
  const receipt = { schema: 1, job_id: 'job-one', attempt_id: intent.attemptId(), decision: 'WAIT' };
  assert.equal(intent.reconciled(receipt), 'WAIT');
  assert.equal(intent.pending(), 'job-one');
  for (const altered of [{ attempt_id: 'wrong' }, { job_id: 'wrong' },
    { schema: 2 }, { decision: 'SUCCESS' }]) {
    assert.throws(() => intent.reconciled({ ...receipt, ...altered }));
    assert.equal(intent.pending(), 'job-one');
  }
  assert.equal(intent.reconciled({ ...receipt, decision: 'CLOSED' }), 'CLOSED');
  assert.equal(intent.pending(), null);
});
