import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { AIClient } from './client.ts';

test('health rejects a 200 provider response that is not JSON', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('provider response is not JSON');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');
  const client = new AIClient({
    provider: 'openai-compatible',
    endpoint: `http://127.0.0.1:${(address as any).port}/v1`,
    model: 'test-provider',
    maxRetries: 1,
  });
  try {
    assert.deepEqual(await client.checkHealthDetailed(), { ok: false, category: 'invalid_response', status: undefined });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
