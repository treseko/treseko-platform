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

test('vision probe verifies two different image answers', async () => {
  let requestCount = 0;
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    const content = payload.messages?.[0]?.content || [];
    assert.equal(content.some((item: any) => item.type === 'image_url'), true);
    const answer = requestCount++ === 0 ? 'ROJO' : 'AZUL';
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const client = new AIClient({ provider: 'openai-compatible', endpoint: `http://127.0.0.1:${(address as any).port}/v1`, model: 'vision-test', maxRetries: 1 });
  try {
    const result = await client.checkVisionCapability();
    assert.equal(result.status, 'verified');
    assert.equal(result.verified, true);
    assert.deepEqual(result.attempts.map((attempt) => attempt.answer), ['ROJO', 'AZUL']);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('vision probe does not trust a model that answers both images the same way', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: 'ROJO' } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const client = new AIClient({ provider: 'openai-compatible', endpoint: `http://127.0.0.1:${(address as any).port}/v1`, model: 'text-only-test', maxRetries: 1 });
  try {
    const result = await client.checkVisionCapability();
    assert.equal(result.verified, false);
    assert.equal(result.status, 'unknown');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
