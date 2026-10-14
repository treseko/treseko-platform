import { strict as assert } from 'node:assert';
import test from 'node:test';
import { executeMcpToolAgent, isForbiddenAddress } from './mcp-tool-agent.ts';

const contract = { implementation: { native_adapter: 'universal-mcp/v1' }, capabilities: ['integration.mcp_call'], security: { allow_private_network: false, allow_filesystem: false, allow_shell: false, allow_arbitrary_code: false }, execution: { timeout_sec: 2, max_retries: 1 } };
const config = { mcp_endpoint_ref: 'treseko', mcp_tool_ref: 'treseko.project.get', mcp_endpoints: { treseko: { url: 'https://mcp.example.test/mcp', admin_allowlisted: true, allowed_hosts: ['mcp.example.test'], credential_id: 'vault:ref', tools: { 'treseko.project.get': { name: 'treseko.project.get', operation: 'read', read_only: true, input_schema: { type: 'object', required: ['project_id'], additionalProperties: false, properties: { project_id: { type: 'string' } } } } } } } };
const node = { config_json: config, universal_agent: { contract } };

test('discovers before calling and traces without secret', async () => {
  const requests: any[] = []; const traces: any[] = [];
  const fetchImpl = async (_url: any, init: any) => {
    const request = JSON.parse(init.body); if (request.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } })); if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    requests.push(request);
    return new Response(JSON.stringify(requests.length === 1 ? { jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'treseko.project.get', annotations: { readOnlyHint: true }, inputSchema: config.mcp_endpoints.treseko.tools['treseko.project.get'].input_schema }] } } : { jsonrpc: '2.0', id: request.id, result: { project: 'safe' } }), { status: 200 });
  };
  const result = await executeMcpToolAgent(node, { arguments: { project_id: 'p-1' } }, { resolveCredential: async () => 'vault-secret', trace: (event) => traces.push(event), resolveHost: async () => ['93.184.216.34'], fetchImpl });
  assert.equal(result.status, 'SUCCESS'); assert.deepEqual(requests.map((item) => item.method), ['tools/list', 'tools/call']); assert.equal(requests[1].params.name, 'treseko.project.get'); assert.equal(JSON.stringify(traces).includes('vault-secret'), false);
});

test('fails closed for prompt-selected or non-read-only operations', async () => {
  const traces: any[] = [];
  const blocked = await executeMcpToolAgent({ config_json: { ...config, mcp_endpoint_ref: 'https://attacker.test', mcp_tool_ref: 'shell' }, universal_agent: { contract } }, { url: 'https://attacker.test' }, { resolveCredential: async () => 'secret', trace: (event) => traces.push(event) });
  assert.equal(blocked.status, 'BLOCKED'); assert.equal(traces[0].status, 'blocked');
});

test('blocks private endpoints and requires exact discovered catalog schema', async () => {
  const privateConfig = { ...config, mcp_endpoints: { treseko: { ...config.mcp_endpoints.treseko, url: 'https://127.0.0.1/mcp', allowed_hosts: ['127.0.0.1'] } } };
  const blocked = await executeMcpToolAgent({ config_json: privateConfig, universal_agent: { contract } }, {}, { resolveCredential: async () => 'secret', trace: () => undefined });
  assert.equal(blocked.status, 'BLOCKED');
  const mismatch = await executeMcpToolAgent(node, {}, { resolveCredential: async () => 'secret', trace: () => undefined, fetchImpl: async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'treseko.project.get', annotations: { readOnlyHint: true }, inputSchema: { type: 'object' } }] } })) });
  assert.equal(mismatch.status, 'BLOCKED');
});

test('requires positive read-only metadata and rejects JSON-RPC errors or wrong ids', async () => {
  const notReadOnly = await executeMcpToolAgent(node, { arguments: { project_id: 'p-1' } }, { resolveCredential: async () => 'secret', trace: () => undefined, fetchImpl: async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'treseko.project.get', inputSchema: config.mcp_endpoints.treseko.tools['treseko.project.get'].input_schema }] } })) });
  assert.equal(notReadOnly.status, 'BLOCKED');
  const rpcError = await executeMcpToolAgent(node, { arguments: { project_id: 'p-1' } }, { resolveCredential: async () => 'secret', trace: () => undefined, resolveHost: async () => ['93.184.216.34'], fetchImpl: async (_url: any, init: any) => new Response(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(init.body).id, error: { code: -1, message: 'nope' } })) });
  assert.equal(rpcError.status, 'FAILED');
});

test('bounds streamed result content and never exposes credential or result secrets', async () => {
  const secret = 'vault-secret';
  const fetchImpl = async (_url: any, init: any) => {
    const request = JSON.parse(init.body); if (request.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } })); if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const body = request.method === 'tools/list'
      ? { jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'treseko.project.get', annotations: { readOnlyHint: true }, inputSchema: config.mcp_endpoints.treseko.tools['treseko.project.get'].input_schema }] } }
      : { jsonrpc: '2.0', id: request.id, result: { token: secret, text: 'x'.repeat(1000) } };
    return new Response(JSON.stringify(body));
  };
  const traces: any[] = [];
  const result = await executeMcpToolAgent(node, { arguments: { project_id: 'p-1' } }, { resolveCredential: async () => secret, trace: (event) => traces.push(event), resolveHost: async () => ['93.184.216.34'], fetchImpl });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.ok(JSON.stringify(result.sharedMemoryPatch.mcp_result).length < 5000);
});

test('fails with a sanitized result when the streaming byte ceiling is exceeded', async () => {
  const huge = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(256 * 1024 + 1))); controller.close(); } });
  const result = await executeMcpToolAgent(node, { arguments: { project_id: 'p-1' } }, { resolveCredential: async () => 'secret', trace: () => undefined, resolveHost: async () => ['93.184.216.34'], fetchImpl: async () => new Response(huge, { status: 200 }) });
  assert.equal(result.status, 'FAILED');
  assert.equal(JSON.stringify(result).includes('x'.repeat(100)), false);
});

test('blocks endpoints resolving to private or link-local addresses before credential use', async () => {
  let resolved = false;
  const result = await executeMcpToolAgent(node, { arguments: { project_id: 'p-1' } }, {
    resolveCredential: async () => { resolved = true; return 'secret'; },
    resolveHost: async () => ['127.0.0.1', '93.184.216.34'],
    trace: () => undefined,
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(resolved, false);
});

test('rejects reserved IPv4-mapped and expanded IPv6 addresses', () => {
  for (const address of [
    '::ffff:127.0.0.1',
    '0:0:0:0:0:ffff:7f00:1',
    'fe80:0000:0000:0000:021c:7eff:fe12:3456',
    'fd00:0000:0000:0000:0000:0000:0000:0001',
    'ff02:0000:0000:0000:0000:0000:0000:0001',
  ]) assert.equal(isForbiddenAddress(address), true, address);
});

test('rejects MCP endpoint query and fragment before credential resolution', async () => {
  let resolved = false;
  const queried = { ...config, mcp_endpoints: { treseko: { ...config.mcp_endpoints.treseko, url: 'https://mcp.example.test/mcp?tenant=secret' } } };
  const result = await executeMcpToolAgent({ config_json: queried, universal_agent: { contract } }, {}, {
    resolveCredential: async () => { resolved = true; return 'secret'; },
    resolveHost: async () => ['93.184.216.34'],
    trace: () => undefined,
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(resolved, false);
});

test('pins the checked DNS address even when a custom fetch implementation is supplied', async () => {
  const urls: string[] = [];
  const fetchImpl = async (url: any, init: any) => {
    urls.push(String(url));
    const request = JSON.parse(init.body); if (request.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } })); if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result = request.method === 'tools/list'
      ? { tools: [{ name: 'treseko.project.get', annotations: { readOnlyHint: true }, inputSchema: config.mcp_endpoints.treseko.tools['treseko.project.get'].input_schema }] }
      : { project: 'safe' };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  };
  const result = await executeMcpToolAgent(node, { arguments: { project_id: 'p-1' } }, {
    resolveCredential: async () => 'secret',
    resolveHost: async () => ['93.184.216.34'],
    trace: () => undefined,
    fetchImpl,
  });
  assert.equal(result.status, 'SUCCESS');
  assert.deepEqual(urls, Array(4).fill('https://93.184.216.34/mcp'));
});

test('rejects every reserved, documentation, mapped, and special IPv6 range', () => {
  for (const address of [
    '2001:0000::1', '2001:0002::1', '2001:0003::1', '2001:0020::1',
    '2001:0db8::1', '100::1', '::192.0.2.1', '::ffff:192.0.2.1',
    'fc00::1', 'fe80::1', 'ff02::1', '::', '::1',
  ]) assert.equal(isForbiddenAddress(address), true, address);
});

test('rejects the RFC 7526 192.88.99.0/24 anycast range', () => {
  assert.equal(isForbiddenAddress('192.88.99.1'), true);
});

test('does not permit an injected fetch to change the pinned destination', async () => {
  let called = 0;
  const result = await executeMcpToolAgent(node, { arguments: { project_id: 'p-1' } }, {
    resolveCredential: async () => 'secret', resolveHost: async () => ['93.184.216.34'], trace: () => undefined,
    fetchImpl: async () => { called += 1; return fetch('https://attacker.test/mcp'); },
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(called, 1);
});

function governedNode(operation: 'preview' | 'commit' | 'rollback', overrides: any = {}) {
  const name = `treseko.cases.import.${operation}`;
  const schemas: any = {
    preview: { type: 'object', required: ['project_id', 'profile_id', 'content_base64'], additionalProperties: false, properties: { project_id: { type: 'string' }, profile_id: { type: 'string', maxLength: 100 }, content_base64: { type: 'string', maxLength: 12000000 } } },
    commit: { type: 'object', required: ['project_id', 'confirmation'], additionalProperties: false, properties: { project_id: { type: 'string' }, confirmation: { type: 'string', const: 'APPLY_CASE_IMPORT' } } },
    rollback: { type: 'object', required: ['project_id', 'confirmation'], additionalProperties: false, properties: { project_id: { type: 'string' }, confirmation: { type: 'string', const: 'ROLLBACK_CASE_IMPORT' } } },
  };
  return { config_json: { mcp_endpoint_ref: 'treseko', mcp_tool_ref: name, mcp_endpoints: { treseko: { url: 'https://mcp.example.test/mcp', admin_allowlisted: true, allowed_hosts: ['mcp.example.test'], allowed_scopes: [`mcp.cases.import.${operation}`], credential_id: 'vault:ref', tools: { [name]: { name, operation, read_only: false, required_scope: `mcp.cases.import.${operation}`, input_schema: schemas[operation], ...overrides.tool } } } } }, universal_agent: { contract: { ...contract, ...overrides.contract } } };
}

const governedServices = (requests: any[], fetchResult: any = { ok: true, result: { value: 'ok' } }, discoveredSchema?: any, discoveredName = 'treseko.cases.import.preview') => ({
  resolveCredential: async () => 'secret', resolveHost: async () => ['93.184.216.34'], trace: () => undefined,
  fetchImpl: async (_url: any, init: any) => { const request = JSON.parse(init.body); if (request.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } })); if (request.method === 'notifications/initialized') return new Response(null, { status: 202 }); requests.push(request); const result = request.method === 'tools/list' ? { tools: [{ name: discoveredName, annotations: { readOnlyHint: false }, inputSchema: discoveredSchema }] } : fetchResult; return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result })); },
});

test('governed preview requires its exact scope and persisted allowlist before network', async () => {
  const requests: any[] = [];
  const result = await executeMcpToolAgent(governedNode('preview'), { arguments: { project_id: 'p', profile_id: 'x', content_base64: 'eA==' }, mcp_scopes: ['mcp.cases.import.commit'] }, governedServices(requests));
  assert.equal(result.status, 'BLOCKED'); assert.equal(requests.length, 0);
});

test('governed commit and rollback require workflow confirmation plus operation scope', async () => {
  for (const operation of ['commit', 'rollback'] as const) {
    const requests: any[] = [];
    const name = `treseko.cases.import.${operation}`;
    const args = operation === 'commit' ? { project_id: 'p', confirmation: 'APPLY_CASE_IMPORT' } : { project_id: 'p', confirmation: 'ROLLBACK_CASE_IMPORT' };
    const denied = await executeMcpToolAgent(governedNode(operation), { arguments: args, mcp_scopes: [`mcp.cases.import.${operation}`] }, governedServices(requests));
    assert.equal(denied.status, 'BLOCKED'); assert.equal(requests.length, 0, name);
    const allowedNode = governedNode(operation);
    const allowed = await executeMcpToolAgent(allowedNode, { arguments: args, mcp_scopes: [`mcp.cases.import.${operation}`], workflow_confirmation: args.confirmation }, governedServices(requests, undefined, allowedNode.config_json.mcp_endpoints.treseko.tools[name].input_schema, name));
    assert.notEqual(allowed.status, 'BLOCKED', name);
  }
});

test('governed arguments reject inline secrets and fields outside the schema without network', async () => {
  for (const argumentsValue of [{ project_id: 'p', profile_id: 'x', content_base64: 'eA==', api_key: 'secret' }, { project_id: 'p', profile_id: 'x', content_base64: 'eA==', shell: 'rm -rf /' }]) {
    const requests: any[] = [];
    const result = await executeMcpToolAgent(governedNode('preview'), { arguments: argumentsValue, mcp_scopes: ['mcp.cases.import.preview'] }, governedServices(requests));
    assert.equal(result.status, 'BLOCKED'); assert.equal(requests.length, 0);
  }
});

test('read-only tools remain governed by the existing read-only discovery contract', async () => {
  const requests: any[] = [];
  const schema = config.mcp_endpoints.treseko.tools['treseko.project.get'].input_schema;
  const result = await executeMcpToolAgent(node, { arguments: { project_id: 'p-1' } }, { resolveCredential: async () => 'secret', resolveHost: async () => ['93.184.216.34'], trace: () => undefined, fetchImpl: async (_url: any, init: any) => { const request = JSON.parse(init.body); if (request.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } })); if (request.method === 'notifications/initialized') return new Response(null, { status: 202 }); requests.push(request); const result = request.method === 'tools/list' ? { tools: [{ name: 'treseko.project.get', annotations: { readOnlyHint: true }, inputSchema: schema }] } : { project: 'safe' }; return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result })); } });
  assert.equal(result.status, 'SUCCESS'); assert.deepEqual(requests.map((item) => item.method), ['tools/list', 'tools/call']);
});

test('rejects contradictory read metadata before discovery', async () => {
  let requests = 0;
  const contradictoryNode = { config_json: { ...config, mcp_endpoints: { treseko: { ...config.mcp_endpoints.treseko, tools: { 'treseko.project.get': { ...config.mcp_endpoints.treseko.tools['treseko.project.get'], read_only: false } } } } }, universal_agent: { contract } };
  const result = await executeMcpToolAgent(contradictoryNode, { arguments: { project_id: 'p-1' } }, {
    resolveCredential: async () => 'secret', resolveHost: async () => ['93.184.216.34'], trace: () => undefined,
    fetchImpl: async (_url: any, init: any) => { requests += 1; const request = JSON.parse(init.body); if (request.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } })); if (request.method === 'notifications/initialized') return new Response(null, { status: 202 }); const body = request.method === 'tools/list' ? { tools: [{ name: 'treseko.project.get', annotations: { readOnlyHint: true }, inputSchema: config.mcp_endpoints.treseko.tools['treseko.project.get'].input_schema }] } : { project: 'safe' }; return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: body })); },
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(requests, 0);
});

test('rejects oversized quote and backslash-heavy results without truncating evidence', async () => {
  const fetchImpl = async (_url: any, init: any) => {
    const request = JSON.parse(init.body); if (request.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } })); if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result = request.method === 'tools/list'
      ? { tools: [{ name: 'treseko.project.get', annotations: { readOnlyHint: true }, inputSchema: config.mcp_endpoints.treseko.tools['treseko.project.get'].input_schema }] }
      : { items: Array.from({ length: 21 }, () => Array.from({ length: 32 }, () => '"\\\\'.repeat(166))) };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  };
  const result = await executeMcpToolAgent(node, { arguments: { project_id: 'p-1' } }, {
    resolveCredential: async () => 'secret', resolveHost: async () => ['93.184.216.34'], trace: () => undefined, fetchImpl,
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.output_json, undefined);
});

test('rejects oversized UTF-8 results without cutting a JSON result', async () => {
  const fetchImpl = async (_url: any, init: any) => {
    const request = JSON.parse(init.body); if (request.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } })); if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result = request.method === 'tools/list'
      ? { tools: [{ name: 'treseko.project.get', annotations: { readOnlyHint: true }, inputSchema: config.mcp_endpoints.treseko.tools['treseko.project.get'].input_schema }] }
      : { items: Array.from({ length: 20 }, () => Array.from({ length: 8 }, () => '🙂'.repeat(600))) };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  };
  const result = await executeMcpToolAgent(node, { arguments: { project_id: 'p-1' } }, {
    resolveCredential: async () => 'secret', resolveHost: async () => ['93.184.216.34'], trace: () => undefined, fetchImpl,
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.output_json, undefined);
});

test('validates integer arguments and preserves structured tool errors', async () => {
  const schema = { type: 'object', additionalProperties: false, required: ['offset'], properties: { offset: { type: 'integer', minimum: 0 }, include: { type: 'boolean' } } };
  const paged = { config_json: { ...config, mcp_endpoints: { treseko: { ...config.mcp_endpoints.treseko, tools: { 'treseko.project.get': { ...config.mcp_endpoints.treseko.tools['treseko.project.get'], input_schema: schema } } } } }, universal_agent: { contract } };
  const services = { resolveCredential: async () => 'synthetic-secret', resolveHost: async () => ['93.184.216.34'], trace: () => undefined, fetchImpl: async (_url: any, init: any) => {
    const req = JSON.parse(init.body);
    if (req.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result = req.method === 'initialize' ? { protocolVersion: '2025-03-26' } : req.method === 'tools/list' ? { tools: [{ name: 'treseko.project.get', annotations: { readOnlyHint: true }, inputSchema: schema }] } : { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'REVISION_CONFLICT', token_count: 3 }) }] };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }));
  } };
  assert.equal((await executeMcpToolAgent(paged, { arguments: { offset: 1, include: true } }, services)).status, 'FAILED');
  assert.equal((await executeMcpToolAgent(paged, { arguments: { offset: 1.5 } }, services)).status, 'BLOCKED');
  assert.equal((await executeMcpToolAgent(paged, { arguments: { offset: true } }, services)).status, 'BLOCKED');
});
