import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeProviderError, normalizeProviderResponse, providerRequest } from './provider-adapters.ts';

const base = { provider: 'openai', endpoint: 'https://api.example/v1', apiKey: 'secret', timeoutMs: 1000 };
const request = { model: 'model-a', messages: [{ role: 'system', content: 'policy' }, { role: 'user', content: 'hello' }], temperature: 0.1, maxTokens: 100 };

test('OpenAI usa Responses API sin exponer la clave en el cuerpo', () => {
  const prepared = providerRequest(base, request);
  assert.equal(prepared.url, 'https://api.example/v1/responses');
  assert.equal(prepared.headers.Authorization, 'Bearer secret');
  assert.equal(JSON.stringify(prepared.body).includes('secret'), false);
});

test('Anthropic separa system y usa x-api-key', () => {
  const prepared = providerRequest({ ...base, provider: 'anthropic' }, request);
  assert.equal(prepared.url, 'https://api.example/v1/messages');
  assert.equal(prepared.headers['x-api-key'], 'secret');
  assert.equal(prepared.body.system, 'policy');
  assert.equal(prepared.body.messages.length, 1);
});

test('Gemini convierte mensajes y autentica por query', () => {
  const prepared = providerRequest({ ...base, provider: 'gemini' }, request);
  assert.match(prepared.url, /models\/model-a:generateContent\?key=secret$/);
  assert.equal(prepared.body.contents[0].role, 'user');
});

test('Azure usa api-key y OpenAI-compatible usa bearer', () => {
  const azure = providerRequest({ ...base, provider: 'azure-openai' }, request);
  assert.equal(azure.headers['api-key'], 'secret');
  assert.equal(azure.headers.Authorization, undefined);
  const compatible = providerRequest({ ...base, provider: 'openai-compatible' }, request);
  assert.equal(compatible.headers.Authorization, 'Bearer secret');
});

test('normaliza usage y texto de los tres protocolos nativos', () => {
  const openai = normalizeProviderResponse('openai-responses', { id: 'r1', output_text: '{"ok":true}', usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } });
  assert.equal(openai.content, '{"ok":true}');
  assert.equal(openai.usage.totalTokens, 5);
  const anthropic = normalizeProviderResponse('anthropic-messages', { content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 4, output_tokens: 2 } });
  assert.equal(anthropic.usage.totalTokens, 6);
  const gemini = normalizeProviderResponse('gemini-generate-content', { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } });
  assert.equal(gemini.content, '{"ok":true}');
});

test('clasifica errores sin copiar mensajes externos', () => {
  const error = normalizeProviderError({ response: { status: 429, data: { error: 'sensitive' }, headers: { 'retry-after': '2' } } });
  assert.equal(error.category, 'rate_limited');
  assert.equal(error.retryAfterMs, 2000);
  assert.equal(error.message.includes('sensitive'), false);
});
