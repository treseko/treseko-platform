import { strict as assert } from 'node:assert';
import test from 'node:test';
import { createMcpRuntimeServices } from './mcp-runtime.ts';

test('creates a vault resolver without putting the secret in runtime metadata', async () => {
  const previousUrl = process.env.MCP_RUNTIME_RESOLVER_URL;
  const previousToken = process.env.AI_ENGINE_INTERNAL_TOKEN;
  const previousAllowlist = process.env.MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS;
  const originalFetch = globalThis.fetch;
  let request: Request | undefined;
  process.env.MCP_RUNTIME_RESOLVER_URL = 'https://backend.example.test/internal/mcp/runtime-credential';
  process.env.MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS = 'https://backend.example.test';
  process.env.AI_ENGINE_INTERNAL_TOKEN = 'engine-secret';
  globalThis.fetch = (async (_input, init) => {
    request = new Request(String(_input), init);
    return new Response(JSON.stringify({ secret: 'mcp-secret' }), { status: 200 });
  }) as typeof fetch;
  try {
    const services = createMcpRuntimeServices({ resolveHost: async () => ['93.184.216.34'], fetchImpl: globalThis.fetch });
    assert.ok(services);
    assert.equal(await services.resolveCredential('vault:credential-1'), 'mcp-secret');
    assert.equal(request?.headers.get('x-engine-internal-token'), 'engine-secret');
    assert.deepEqual(await request?.json(), { reference: 'vault:credential-1' });
    assert.equal(JSON.stringify(services).includes('mcp-secret'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.MCP_RUNTIME_RESOLVER_URL; else process.env.MCP_RUNTIME_RESOLVER_URL = previousUrl;
    if (previousToken === undefined) delete process.env.AI_ENGINE_INTERNAL_TOKEN; else process.env.AI_ENGINE_INTERNAL_TOKEN = previousToken;
    if (previousAllowlist === undefined) delete process.env.MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS; else process.env.MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS = previousAllowlist;
  }
});

test('rejects a resolver result that is a hostname instead of a literal IP', async () => {
  const previous = { url: process.env.MCP_RUNTIME_RESOLVER_URL, origins: process.env.MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS, token: process.env.AI_ENGINE_INTERNAL_TOKEN };
  process.env.MCP_RUNTIME_RESOLVER_URL = 'https://backend.example.test/internal/runtime';
  process.env.MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS = 'https://backend.example.test';
  process.env.AI_ENGINE_INTERNAL_TOKEN = 'engine-secret';
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { calls += 1; return new Response(JSON.stringify({ secret: 'must-not-leak' })); }) as typeof fetch;
  try {
    const services = createMcpRuntimeServices({ resolveHost: async () => ['backend.example.test'] });
    assert.ok(services);
    assert.equal(await services.resolveCredential('vault:credential-1'), undefined);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous.url === undefined) delete process.env.MCP_RUNTIME_RESOLVER_URL; else process.env.MCP_RUNTIME_RESOLVER_URL = previous.url;
    if (previous.origins === undefined) delete process.env.MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS; else process.env.MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS = previous.origins;
    if (previous.token === undefined) delete process.env.AI_ENGINE_INTERNAL_TOKEN; else process.env.AI_ENGINE_INTERNAL_TOKEN = previous.token;
  }
});

test('allows the Compose HTTP resolver only when explicitly enabled', async () => {
  const previous = { url: process.env.MCP_RUNTIME_RESOLVER_URL, origins: process.env.MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS, token: process.env.AI_ENGINE_INTERNAL_TOKEN, insecure: process.env.MCP_RUNTIME_RESOLVER_ALLOW_INSECURE_HTTP };
  process.env.MCP_RUNTIME_RESOLVER_URL = 'http://backend:8000/internal/runtime';
  process.env.MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS = 'http://backend:8000';
  process.env.AI_ENGINE_INTERNAL_TOKEN = 'engine-secret';
  delete process.env.MCP_RUNTIME_RESOLVER_ALLOW_INSECURE_HTTP;
  try { assert.equal(createMcpRuntimeServices(), undefined); process.env.MCP_RUNTIME_RESOLVER_ALLOW_INSECURE_HTTP = 'true'; assert.ok(createMcpRuntimeServices({ resolveHost: async () => ['93.184.216.34'], fetchImpl: async () => new Response(JSON.stringify({ secret: 'ok' })) })); }
  finally {
    for (const [key, value] of Object.entries({ MCP_RUNTIME_RESOLVER_URL: previous.url, MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS: previous.origins, AI_ENGINE_INTERNAL_TOKEN: previous.token, MCP_RUNTIME_RESOLVER_ALLOW_INSECURE_HTTP: previous.insecure })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('does not create a resolver without both internal boundary settings', () => {
  const previousUrl = process.env.MCP_RUNTIME_RESOLVER_URL;
  const previousToken = process.env.AI_ENGINE_INTERNAL_TOKEN;
  delete process.env.MCP_RUNTIME_RESOLVER_URL;
  delete process.env.AI_ENGINE_INTERNAL_TOKEN;
  try { assert.equal(createMcpRuntimeServices(), undefined); }
  finally {
    if (previousUrl === undefined) delete process.env.MCP_RUNTIME_RESOLVER_URL; else process.env.MCP_RUNTIME_RESOLVER_URL = previousUrl;
    if (previousToken === undefined) delete process.env.AI_ENGINE_INTERNAL_TOKEN; else process.env.AI_ENGINE_INTERNAL_TOKEN = previousToken;
  }
});

test('does not create a resolver for non-HTTPS, non-exact, or private resolver origins', () => {
  const previous = { url: process.env.MCP_RUNTIME_RESOLVER_URL, origins: process.env.MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS, token: process.env.AI_ENGINE_INTERNAL_TOKEN };
  process.env.AI_ENGINE_INTERNAL_TOKEN = 'engine-secret';
  for (const [url, origins] of [['http://backend.example.test/internal/runtime', 'http://backend.example.test'], ['https://attacker.example.test/internal/runtime', 'https://backend.example.test'], ['https://127.0.0.1/internal/runtime', 'https://127.0.0.1']]) {
    process.env.MCP_RUNTIME_RESOLVER_URL = url;
    process.env.MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS = origins;
    assert.equal(createMcpRuntimeServices(), undefined);
  }
  if (previous.url === undefined) delete process.env.MCP_RUNTIME_RESOLVER_URL; else process.env.MCP_RUNTIME_RESOLVER_URL = previous.url;
  if (previous.origins === undefined) delete process.env.MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS; else process.env.MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS = previous.origins;
  if (previous.token === undefined) delete process.env.AI_ENGINE_INTERNAL_TOKEN; else process.env.AI_ENGINE_INTERNAL_TOKEN = previous.token;
});

test('DNS pins resolver requests and never sends the token when resolution is unsafe', async () => {
  const previous = { url: process.env.MCP_RUNTIME_RESOLVER_URL, origins: process.env.MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS, token: process.env.AI_ENGINE_INTERNAL_TOKEN };
  process.env.MCP_RUNTIME_RESOLVER_URL = 'https://backend.example.test/internal/runtime';
  process.env.MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS = 'https://backend.example.test';
  process.env.AI_ENGINE_INTERNAL_TOKEN = 'engine-secret';
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return new Response(JSON.stringify({ secret: 'nope' })); }) as typeof fetch;
  try {
    const services = createMcpRuntimeServices({ resolveHost: async () => ['127.0.0.1'] });
    assert.ok(services);
    assert.equal(await services.resolveCredential('vault:credential-1'), undefined);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous.url === undefined) delete process.env.MCP_RUNTIME_RESOLVER_URL; else process.env.MCP_RUNTIME_RESOLVER_URL = previous.url;
    if (previous.origins === undefined) delete process.env.MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS; else process.env.MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS = previous.origins;
    if (previous.token === undefined) delete process.env.AI_ENGINE_INTERNAL_TOKEN; else process.env.AI_ENGINE_INTERNAL_TOKEN = previous.token;
  }
});
