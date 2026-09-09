import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(20);
  }
  assert.fail('Timed out waiting for worker protocol transition');
}

for (const mode of ['idle', 'next', 'claim', 'ambiguous-claim']) {
  const duringNext = mode === 'next';
  const duringClaim = mode === 'claim' || mode === 'ambiguous-claim';
  test(`real worker pauses and resumes: ${mode}`,
    { timeout: 10000 }, async t => {
      const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-worker-process-')));
      const source = path.dirname(fileURLToPath(import.meta.url));
      const worker = path.join(root, 'worker');
      fs.cpSync(source, path.join(worker, 'src'), { recursive: true });
      fs.symlinkSync(path.resolve(source, '../node_modules'), path.join(worker, 'node_modules'), 'dir');
      fs.writeFileSync(path.join(worker, 'package.json'), '{"type":"module","version":"1.0.3"}');
      const control = path.join(root, 'control');
      fs.mkdirSync(control, { mode: 0o700 });
      const request = path.join(control, 'request.json');
      const status = path.join(control, 'status.json');
      const pause = () => fs.writeFileSync(request,
        '{"schema":1,"transaction":"process-test"}', { mode: 0o600 });
      let next = 0, claims = 0, requests = 0, held, resultResponse, sentAttempt;
      const resultPayloads = [];
      const server = http.createServer((req, res) => {
        requests++;
        res.setHeader('Content-Type', 'application/json');
        req.resume();
        if (req.url.endsWith('/next')) {
          next++;
          if (duringNext && next === 1) { held = res; return; }
          if (duringClaim && next === 1) { res.end('{"id":"fixture-job"}'); return; }
          res.end('null');
        } else if (req.url.endsWith('/claim')) {
          claims++;
          sentAttempt = req.headers['x-claim-intent'];
          if (duringClaim) { held = res; return; }
          res.writeHead(409).end('{}');
        } else if (req.url.endsWith('/result')) {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            resultPayloads.push(JSON.parse(body));
            if (resultPayloads.length === 1) res.writeHead(503).end('{}');
            else resultResponse = res;
          });
        } else res.end('{"id":"fixture-runner"}');
      });
      let child;
      t.after(async () => {
        if (child && child.exitCode === null && child.signalCode === null) {
          const exited = once(child, 'exit');
          child.kill('SIGKILL');
          await exited;
        }
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      if (mode === 'idle') pause();
      const startWorker = () => spawn(process.execPath, [path.join(worker, 'src/worker.mjs')], {
        cwd: worker, stdio: 'ignore',
        // Deliberately do not inherit production credentials or local .env.
        env: { PATH: process.env.PATH, QA_API_BASE: `http://127.0.0.1:${server.address().port}`,
          QA_RUNNER_TOKEN: 'synthetic-process-test', QA_RUNNER_TOKEN_FILE: path.join(root, 'token'),
          QA_RESULT_SPOOL_DIR: path.join(root, 'spool'), QA_UPDATE_CONTROL_DIR: control,
          QA_POLL_INTERVAL_MS: '20', QA_HEARTBEAT_INTERVAL_MS: '100',
          QA_RESULT_RETRY_ATTEMPTS: '1', QA_RESULT_RETRY_BASE_MS: '20',
          QA_TEST_TRACE_ENABLED: 'false', TRESEKO_WORKER_VERSION: '1.0.3' },
      });
      child = startWorker();
      if (duringNext) {
        await until(() => held);
        pause();
        held.end('{"id":"fixture-job"}');
      }
      if (duringClaim) {
        await until(() => held);
        pause();
        if (mode === 'ambiguous-claim') {
          const saved = JSON.parse(fs.readFileSync(path.join(root, 'claim-intent/claim.json'), 'utf8'));
          assert.equal(saved.attempt_id, sentAttempt);
          assert.match(sentAttempt, /^[0-9a-f-]{36}$/);
          // Simulate a committed claim whose response is lost. No lease reaches
          // this process, so local zero counters cannot prove backend idleness.
          held.destroy();
          await delay(500);
          const receipt = fs.existsSync(status)
            ? JSON.parse(fs.readFileSync(status, 'utf8')) : null;
          assert.notEqual(receipt?.ready, true, 'unreconciled claim must block update readiness');
          assert.equal(receipt?.unresolved_claims, 1);
          const exited = once(child, 'exit');
          child.kill('SIGKILL');
          await exited;
          child = startWorker();
          await until(() => JSON.parse(fs.readFileSync(status, 'utf8')).pid === child.pid);
          assert.equal(JSON.parse(fs.readFileSync(status, 'utf8')).ready, false);
          assert.equal(next, 1, 'restart must not take another job');
          assert.equal(claims, 1);
          return;
        }
        await delay(100);
        assert.equal(fs.existsSync(status), false, 'claim in flight is not drained');
        held.end(JSON.stringify({ id: 'fixture-job', lease_token: 'synthetic-lease',
          lease_expires_at: new Date(Date.now() + 60000).toISOString(),
          attempt_count: 1, max_attempts: 3, job_type: 'API_EXECUTION',
          payload_congelado: {} }));
        // Deliberately invalid API job follows the real BLOCKED-result path.
        // First delivery fails, the durable spool is retried while paused.
        await until(() => resultResponse);
        await delay(100);
        assert.equal(fs.existsSync(status), false, 'unacknowledged result is not drained');
        assert.equal(next, 1);
        assert.equal(claims, 1);
        assert.equal(resultPayloads.length, 2);
        assert.deepEqual(resultPayloads[0], resultPayloads[1]);
        assert.equal(resultPayloads[0].status, 'BLOCKED');
        assert.ok(resultPayloads[0].result_event_id);
        const spool = path.join(root, 'spool');
        assert.equal(fs.readdirSync(spool).filter(name => name.endsWith('.json')).length, 1);
        resultResponse.end('{}');
      }
      await until(() => fs.existsSync(status));
      const receipt = JSON.parse(fs.readFileSync(status, 'utf8'));
      assert.equal(receipt.ready, true);
      assert.equal(receipt.pid, child.pid);
      assert.equal(receipt.transaction, 'process-test');
      const stoppedAt = next;
      await delay(150);
      assert.equal(next, stoppedAt);
      assert.equal(claims, duringClaim ? 1 : 0);
      if (mode === 'idle') assert.equal(requests, 0);
      if (duringClaim) assert.equal(fs.readdirSync(path.join(root, 'spool'))
        .filter(name => name.endsWith('.json')).length, 0);
      fs.unlinkSync(request);
      await until(() => next > stoppedAt);
      assert.equal(fs.existsSync(status), false);
      assert.equal(child.exitCode, null);
    });
}
