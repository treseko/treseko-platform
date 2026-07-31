import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import test from 'node:test';
import path from 'node:path';
import { deliverTerminalResult, persistPendingTerminalDelivery, terminalDeliveryId } from './terminal-callback.ts';

test('persiste la entrega terminal pendiente en el runtime privado del Engine', () => {
  const previousDir = process.env.ENGINE_PENDING_DELIVERIES_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-terminal-outbox-'));
  process.env.ENGINE_PENDING_DELIVERIES_DIR = directory;
  const executionId = 'cd43e6c1-a25d-4fa3-94ec-d6ff3cdd4c77';
  try {
    persistPendingTerminalDelivery({
      url: 'http://backend.test/result', token: 'test-token', executionId, payload: { status: 'PASO' },
    });
    const file = path.join(directory, `${executionId}.json`);
    assert.equal(fs.existsSync(file), true);
    // Windows does not expose POSIX file modes. The privacy guarantee is
    // asserted on POSIX runners, while Windows validates persistence itself.
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).executionId, executionId);
  } finally {
    if (previousDir === undefined) delete process.env.ENGINE_PENDING_DELIVERIES_DIR;
    else process.env.ENGINE_PENDING_DELIVERIES_DIR = previousDir;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('reintenta con el mismo id y acepta solo un ACK persistido', async () => {
  let calls = 0;
  const executionId = '6e06ed8a-d566-48aa-b537-c0c40db36be2';
  const fetchImpl = async (_url: any, init: any) => {
    calls += 1;
    const payload = JSON.parse(init.body);
    assert.equal(init.headers['X-Idempotency-Key'], terminalDeliveryId(executionId));
    assert.equal(payload.metadata.terminal_delivery_id, terminalDeliveryId(executionId));
    if (calls === 1) return new Response(JSON.stringify({ id: executionId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({
      execution_id: executionId,
      acknowledged: true,
      report_complete: true,
      terminal_delivery_id: terminalDeliveryId(executionId),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const ack = await deliverTerminalResult({
    url: 'http://backend.test/result', executionId, payload: { status: 'PASO', metadata: {} },
    attempts: 2, timeoutMs: 1000, fetchImpl: fetchImpl as typeof fetch,
  });
  assert.equal(ack.attempts, 2);
  assert.equal(calls, 2);
});
