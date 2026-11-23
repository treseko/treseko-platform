import assert from 'node:assert/strict';
import {spawnSync as realSpawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import test from 'node:test';
import {createApiRuntime} from './api-runtime.mjs';
import {createWorkerSelfUpdater} from './worker-self-update.mjs';

test('revoked worker relinks with its persistent identity and applies the offered update before job polling', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-worker-relink-update-'));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-worker-relink-payload-'));
  const previousFetch = globalThis.fetch;
  const previousRegistrationToken = process.env.QA_REGISTRATION_TOKEN;
  delete process.env.QA_REGISTRATION_TOKEN;
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousRegistrationToken === undefined) delete process.env.QA_REGISTRATION_TOKEN;
    else process.env.QA_REGISTRATION_TOKEN = previousRegistrationToken;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  });

  const workerInstanceId = 'qa-worker-instance-stable';
  const targetBuildId = 'a'.repeat(64);
  const workerTokenPath = path.join(root, '.runner-token');
  fs.writeFileSync(workerTokenPath, 'revoked-token', { mode: 0o600 });
  fs.writeFileSync(path.join(root, '.worker-instance-id'), workerInstanceId, { mode: 0o600 });

  fs.mkdirSync(path.join(source, 'src'));
  fs.writeFileSync(path.join(source, 'src', 'worker.mjs'), 'console.log("updated worker")\n');
  fs.writeFileSync(path.join(source, 'worker-launcher.mjs'), 'console.log("persistent launcher")\n');
  fs.writeFileSync(path.join(source, 'entrypoint.sh'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
    version: '1.0.8', scripts: { start: 'node worker-launcher.mjs' },
  }));
  fs.writeFileSync(path.join(source, 'package-lock.json'), JSON.stringify({
    name: 'treseko-automation-worker', version: '1.0.8', lockfileVersion: 3,
  }));
  fs.writeFileSync(path.join(source, 'VERSION'), '1.0.8\n');
  const archive = path.join(root, 'worker-1.0.8.tar.gz');
  const packed = realSpawnSync('tar', ['-czf', archive, '-C', source, 'src/worker.mjs',
    'worker-launcher.mjs', 'entrypoint.sh', 'package.json', 'package-lock.json', 'VERSION'],
  { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  const archiveBytes = fs.readFileSync(archive);
  const archiveChecksum = createHash('sha256').update(archiveBytes).digest('hex');
  fs.unlinkSync(archive);

  const events = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/automation-runners/me') {
      events.push(`me:${request.headers['x-runner-token'] || 'none'}`);
      if (request.headers['x-runner-token'] === 'revoked-token') {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ detail: 'Runner token invalido' }));
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ id: 'same-runner-row' }));
      }
      return;
    }
    if (url.pathname === '/automation-runners/pairing-requests' && request.method === 'POST') {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(payload.capabilities.worker_instance_id, workerInstanceId);
      events.push('pairing-request');
      response.writeHead(201, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ code: 'WK-123456', pairing_token: 'qa-pairing-token',
        expires_at: new Date(Date.now() + 60_000).toISOString() }));
      return;
    }
    if (url.pathname === '/automation-runners/pairing-requests/WK-123456') {
      assert.equal(request.headers['x-pairing-token'], 'qa-pairing-token');
      events.push('pairing-approved');
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ estado: 'APPROVED', runner_token: 'replacement-token',
        runner: { id: 'same-runner-row', nombre: 'QA relink worker' } }));
      return;
    }
    if (url.pathname === '/automation-runners/me/update-status') {
      assert.equal(request.headers['x-runner-token'], 'replacement-token');
      events.push('update-status');
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'update_required', observed_version: '1.0.8',
        desired_version: '1.0.8', observed_build_id: 'b'.repeat(64), desired_build_id: targetBuildId }));
      return;
    }
    if (url.pathname === '/automation-runners/me/update-package') {
      assert.equal(request.headers['x-runner-token'], 'replacement-token');
      events.push('update-package');
      response.writeHead(200, { 'Content-Type': 'application/gzip',
        'X-Worker-Update-Version': '1.0.8', 'X-Worker-Update-Build-Id': targetBuildId,
        'X-Worker-Update-Sha256': archiveChecksum, 'Content-Length': String(archiveBytes.length) });
      response.end(archiveBytes);
      return;
    }
    if (url.pathname === '/automation-jobs/next') events.push('job-poll');
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ detail: 'Not found' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const state = { runnerToken: 'revoked-token', runnerId: 'same-runner-row', activeCorrelationId: '' };
  const runtime = createApiRuntime({
    API_BASE: `http://127.0.0.1:${server.address().port}`, REQUEST_TIMEOUT_MS: 2_000,
    RUNNER_NAME: 'QA relink worker', ORGANIZACION_ID: 'qa-solution-id', tokenPath: workerTokenPath,
    pairingStatePath: path.join(root, '.runner-token.pairing'), workerInstanceId, state,
    capabilities: () => ({ worker_instance_id: workerInstanceId, worker_build_id: 'b'.repeat(64) }),
    traceEntry() {}, traceRequestId: () => 'qa-request-id',
    errorFromResponse: (data, _text, status, correlationId) => Object.assign(
      new Error(data?.detail || `HTTP ${status}`), { error_code: `HTTP_${status}`, correlation_id: correlationId },
    ),
    safeJsonParse: (value) => { try { return JSON.parse(value); } catch { return null; } },
    isInvalidRunnerTokenError: (error) => error.error_code === 'HTTP_401',
    clearRunnerCredentials: () => {
      state.runnerToken = '';
      state.runnerId = '';
      if (fs.existsSync(workerTokenPath)) fs.unlinkSync(workerTokenPath);
    },
    saveTokenFile: (token) => fs.writeFileSync(workerTokenPath, token, { mode: 0o600 }),
    sleep: async () => {}, performance,
  });

  await runtime.registerIfNeeded();
  assert.equal(state.runnerToken, 'replacement-token');
  assert.equal(state.runnerId, 'same-runner-row');
  assert.equal(fs.readFileSync(path.join(root, '.worker-instance-id'), 'utf8'), workerInstanceId);

  let requestedExitCode = null;
  const updater = createWorkerSelfUpdater({
    fs, path, spawnSync: (command, args, options) => command === 'npm'
      ? { status: 0, stdout: '', stderr: '' }
      : realSpawnSync(command, args, options),
    process: { platform: 'linux', env: {}, exit: code => { requestedExitCode = code; } },
    rootDir: root, api: runtime.api, downloadWorkerUpdate: runtime.downloadWorkerUpdate,
    log: { info() {}, warn() {} },
  });
  const result = await updater.checkAndApply({ activeJobs: 0, pendingResults: 0, unresolvedClaims: 0 });

  assert.equal(result.status, 'restarting');
  assert.equal(requestedExitCode, 75);
  assert.deepEqual(events, ['me:revoked-token', 'pairing-request', 'pairing-approved',
    'update-status', 'update-package']);
  assert.equal(events.includes('job-poll'), false);
  assert.equal(fs.readFileSync(workerTokenPath, 'utf8'), 'replacement-token');
  const active = JSON.parse(fs.readFileSync(path.join(root, '.treseko-active-worker-release.json'), 'utf8'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.worker-releases', active.release, 'package.json'), 'utf8')).version, '1.0.8');
});
