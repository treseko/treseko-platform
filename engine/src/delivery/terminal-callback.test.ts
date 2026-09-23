import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import test from 'node:test';
import path from 'node:path';
import { deliverTerminalResult, persistPendingTerminalDelivery, terminalDeliveryId, validateTerminalCallbackUrl } from './terminal-callback.ts';

test('callback URL exige allowlist y rechaza destinos privados', () => {
  assert.equal(validateTerminalCallbackUrl('https://backend.example.test/result', 'backend.example.test').hostname, 'backend.example.test');
  assert.throws(() => validateTerminalCallbackUrl('https://evil.example.test/result', 'backend.example.test'), /allowlist/i);
  assert.throws(() => validateTerminalCallbackUrl('http://127.0.0.1:8000/result', '127.0.0.1'), /privada/i);
});

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
    attempts: 2, timeoutMs: 1000, resolveHost: async () => ['93.184.216.34'], fetchImpl: fetchImpl as typeof fetch,
  });
  assert.equal(ack.attempts, 2);
  assert.equal(calls, 2);
});

test('rechaza un callback cuyo hostname cambia a una red privada antes de conectar', async () => {
  let calls = 0;
  await assert.rejects(() => deliverTerminalResult({
    url: 'https://backend.example.test/result', executionId: 'dns-rebinding', payload: {},
    attempts: 1, timeoutMs: 1000,
    resolveHost: async () => ['93.184.216.34', '127.0.0.1'],
    fetchImpl: (async () => { calls += 1; throw new Error('must not connect'); }) as typeof fetch,
  }), /destino|privad|segur/i);
  assert.equal(calls, 0);
});

test('fija el callback al IP validado aunque el fetch vuelva a resolver el hostname', async () => {
  let requested: string | URL | undefined;
  const ack = await deliverTerminalResult({
    url: 'https://backend.example.test/result', executionId: 'dns-pinned', payload: {},
    attempts: 1, timeoutMs: 1000,
    resolveHost: async () => ['93.184.216.34'],
    fetchImpl: (async (input) => {
      requested = input as string | URL;
      return new Response(JSON.stringify({ execution_id: 'dns-pinned', acknowledged: true, report_complete: true, terminal_delivery_id: 'ai-terminal:dns-pinned' }), { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(ack.acknowledged, true);
  assert.match(String(requested), /93\.184\.216\.34/);
});
