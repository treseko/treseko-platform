import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeProviderError, normalizeProviderResponse, providerRequest, workflowOutputJsonSchema } from './provider-adapters.ts';
import { COMPACT_STORY_GENERATION_SCHEMA, shouldDisableGenerationThinking, storyContractIssues } from '../generation-contracts.ts';
import { checkedSemanticReview, mergeTraceabilityRepair, missingTraceabilityIds, sourceRefsForGrounding } from '../generation-review.ts';
import { effectiveRequestTimeoutMs } from './requestRetry.ts';
import { GENERATION_PREPARATION_TIMEOUT_MS, prepareGenerationContext } from '../generation-context.ts';

const base = { provider: 'openai', endpoint: 'https://api.example/v1', apiKey: 'secret', timeoutMs: 1000 };
const request = { model: 'model-a', messages: [{ role: 'system', content: 'policy' }, { role: 'user', content: 'hello' }], temperature: 0.1, maxTokens: 100 };

test('workflow timeout is capped by provider timeout and invalid overrides preserve provider setting', () => {
  assert.equal(effectiveRequestTimeoutMs(900_000, 180_000), 180_000);
  assert.equal(effectiveRequestTimeoutMs(60_000, 180_000), 60_000);
  assert.equal(effectiveRequestTimeoutMs(900_000, 1_000), 1_000);
  assert.equal(effectiveRequestTimeoutMs(900_000, undefined), 900_000);
});

test('long-source preparation applies a bounded model timeout to every fragment', async () => {
  const timeouts: number[] = [];
  const context = { requisito: { id: 'req-long', descripcion_markdown: 'Regla funcional verificable. '.repeat(80) }, componentes: [], wiki: [] };
  const ai = {
    requestTimeoutMs: 900_000,
    runWorkflowAgent: async (args: any) => {
      timeouts.push(args.timeoutMs);
      return { data: { complete: true, rules: [], questions: [] }, metrics: {}, prompt: [] };
    },
  } as any;
  const prepared = await prepareGenerationContext(ai, context, 1024, 256);
  assert.ok(timeouts.length > 1);
  assert.ok(timeouts.every(timeout => timeout === GENERATION_PREPARATION_TIMEOUT_MS));
  assert.equal(prepared.context.source_inventory.complete, true);
});

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
  assert.deepEqual(compatible.body.response_format, { type: 'json_object' });

  const lmStudio = providerRequest({ ...base, provider: 'lm-studio' }, request);
  assert.equal(lmStudio.body.response_format.type, 'json_schema');
  assert.equal(lmStudio.body.response_format.json_schema.name, 'treseko_workflow_response');
});

test('LM Studio recibe el esquema de salida real del workflow para restringir la respuesta', () => {
  const requestWithSchema = {
    ...request,
    outputSchema: {
      verdict: 'PASS|WARN|FAIL',
      findings: [{ severity: 'WARN|FAIL', message: 'string', criterion_id: 'string or empty' }],
    },
  };
  const prepared = providerRequest({ ...base, provider: 'lm-studio' }, requestWithSchema);
  const schema = prepared.body.response_format.json_schema.schema;
  assert.equal(schema.type, 'object');
  assert.deepEqual(schema.required, ['verdict', 'findings']);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.verdict.enum, ['PASS', 'WARN', 'FAIL']);
  assert.equal(schema.properties.findings.items.additionalProperties, false);
  assert.deepEqual(schema.properties.findings.items.required, ['severity', 'message', 'criterion_id']);
  assert.equal(schema.properties.findings.items.properties.criterion_id.type, 'string');
});

test('workflow schema converter preserves native JSON Schema constraints', () => {
  const schema = workflowOutputJsonSchema({ type: 'object', properties: { count: { type: 'integer' } }, required: ['count'] });
  assert.equal(schema.properties.count.type, 'integer');
  assert.deepEqual(schema.required, ['count']);
  assert.equal(schema.additionalProperties, false);
});

test('workflow schema converter keeps numeric types and declared ranges', () => {
  const schema = workflowOutputJsonSchema({ complete: true, quality_score: 'number 0..100', retries: 'integer 1..5', latency: 'number', steps: [{ number: 1 }] });
  assert.deepEqual(schema.properties.complete, { type: 'boolean' });
  assert.deepEqual(schema.properties.quality_score, { type: 'number', minimum: 0, maximum: 100 });
  assert.deepEqual(schema.properties.retries, { type: 'integer', minimum: 1, maximum: 5 });
  assert.deepEqual(schema.properties.latency, { type: 'number' });
  assert.deepEqual(schema.properties.steps.items.properties.number, { type: 'integer' });
});

test('workflow schema converter treats business type fields as enums, not JSON Schema node types', () => {
  const schema = workflowOutputJsonSchema(COMPACT_STORY_GENERATION_SCHEMA);
  const criteria = schema.properties.propuestas.items.properties.acceptance_criteria;
  assert.equal(criteria.type, 'array');
  assert.equal(criteria.items.type, 'object');
  assert.deepEqual(criteria.items.properties.type.enum, ['FUNCTIONAL', 'SECURITY', 'ACCESSIBILITY', 'PERFORMANCE', 'TECHNICAL']);
});

test('thinking suppression sends the Ollama-compatible no-reasoning fields', () => {
  const prepared = providerRequest({ ...base, provider: 'ollama' }, { ...request, disableThinking: true });
  assert.equal(prepared.body.reasoning_effort, 'none');
  assert.deepEqual(prepared.body.chat_template_kwargs, { enable_thinking: false });
});

test('story and case generation suppress thinking only for supported local providers', () => {
  assert.equal(shouldDisableGenerationThinking('lm-studio'), true);
  assert.equal(shouldDisableGenerationThinking('ollama'), true);
  assert.equal(shouldDisableGenerationThinking('OLLAMA'), true);
  assert.equal(shouldDisableGenerationThinking('openai-compatible'), false);
  assert.equal(shouldDisableGenerationThinking('openai'), false);
  assert.equal(shouldDisableGenerationThinking('anthropic'), false);
  assert.equal(shouldDisableGenerationThinking('gemini'), false);
});

test('story contract requires each criterion to cite a known source or accepted assumption', () => {
  const proposal = (sourceRefs: string[], assumptionIds: string[] = []) => [{
    local_id: 'PROP-001', story_type: 'USER_STORY', title: 'Comprar gift card',
    actor: 'Cliente', goal: 'Comprar gift card', benefit: 'Completar compra',
    description: 'Compra con reglas trazables', source_refs: [], assumption_ids: [], quality: {},
    acceptance_criteria: [{ local_id: 'AC-001', type: 'FUNCTIONAL', title: 'Pago',
      given: 'El pago está aprobado', when: 'La compra finaliza', then: ['Se emite la gift card'],
      observable_result: 'La gift card queda emitida', source_refs: sourceRefs, assumption_ids: assumptionIds }],
  }];
  const sources = new Set(['requirement:req-1']);
  const assumptions = new Set(['ASSUMP-001']);
  assert.ok(storyContractIssues(proposal([]), sources, assumptions).some(issue => issue.includes('necesita una fuente')));
  assert.ok(storyContractIssues(proposal(['requirement:other']), sources, assumptions).some(issue => issue.includes('fuentes que no están')));
  assert.deepEqual(storyContractIssues(proposal(['requirement:req-1']), sources, assumptions), []);
  assert.deepEqual(storyContractIssues(proposal([], ['ASSUMP-001']), sources, assumptions), []);
});

test('semantic review retries only omitted criteria and keeps literal evidence checks', () => {
  const context = { requisito: { id: 'req-1', descripcion_markdown: 'El pago debe ser aprobado antes de emitir la tarjeta.' },
    componentes: [], wiki: [], accepted_assumption_ids: [] };
  const proposal = { acceptance_criteria: [
    { local_id: 'AC-001' }, { local_id: 'AC-002' },
  ] };
  const primary = checkedSemanticReview({ verdict: 'PASS', findings: [], grounding: [{
    criterion_id: 'AC-002', status: 'EXPLICIT', evidence: [{ source_id: 'requirement:req-1', quote: 'El pago debe ser aprobado' }],
    assumption_ids: [], reason: 'La fuente lo establece.',
  }] }, proposal, context, 'story', 'traceability');
  const missing = missingTraceabilityIds(primary, proposal, 'story');
  assert.deepEqual(missing, ['AC-001']);
  const repair = checkedSemanticReview({ verdict: 'PASS', findings: [], grounding: [{
    criterion_id: 'AC-001', status: 'EXPLICIT', evidence: [{ source_id: 'requirement:req-1', quote: 'El pago debe ser aprobado antes de emitir la tarjeta.' }],
    assumption_ids: [], reason: 'La regla está declarada textualmente.',
  }] }, proposal, context, 'story', 'traceability', missing);
  const merged = mergeTraceabilityRepair(primary, repair, missing, 'story');
  assert.equal(merged.verdict, 'PASS');
  assert.deepEqual(merged.grounding.map((item: any) => item.criterion_id).sort(), ['AC-001', 'AC-002']);

  const badRepair = checkedSemanticReview({ verdict: 'PASS', findings: [], grounding: [{
    criterion_id: 'AC-001', status: 'EXPLICIT', evidence: [{ source_id: 'requirement:req-1', quote: 'tarjeta nueva no citada' }],
    assumption_ids: [], reason: 'Cita inventada.',
  }] }, proposal, context, 'story', 'traceability', missing);
  assert.equal(mergeTraceabilityRepair(primary, badRepair, missing, 'story').verdict, 'FAIL');
});

test('unsupported criteria never expose literal but unrelated quotes as traceability', () => {
  const context = { requisito: { id: 'req-1', descripcion_markdown: 'El pedido debe mostrar el resultado del pago.' },
    componentes: [], wiki: [], accepted_assumption_ids: [] };
  const proposal = { acceptance_criteria: [{ local_id: 'AC-001' }] };
  const report = checkedSemanticReview({ verdict: 'FAIL', findings: [], grounding: [{
    criterion_id: 'AC-001', status: 'UNSUPPORTED',
    evidence: [{ source_id: 'requirement:req-1', quote: 'El pedido debe mostrar el resultado del pago.' }],
    assumption_ids: [], reason: 'La cita no respalda el comportamiento de este criterio.',
  }] }, proposal, context, 'story', 'traceability');
  assert.equal(report.evidence_validation, 'literal_fragment_integrity_only');
  const backing = report.grounding[0];
  assert.deepEqual(backing.evidence, []);
  assert.deepEqual(sourceRefsForGrounding(backing), []);
  assert.equal(report.verdict, 'FAIL');
  assert.deepEqual(sourceRefsForGrounding({ status: 'EXPLICIT', evidence: [{ source_id: 'requirement:req-1' }] }), ['requirement:req-1']);
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

test('clasifica la matriz de fallos del proveedor sin filtrar respuestas externas', () => {
  const cases = [
    [401, 'authentication_failed'],
    [403, 'permission_denied'],
    [400, 'invalid_request'],
    [429, 'rate_limited'],
    [500, 'provider_unavailable'],
    [undefined, 'network_error'],
  ] as const;
  for (const [status, category] of cases) {
    const error = normalizeProviderError(status ? { response: { status, data: { secret: 'hidden' } } } : { code: 'ECONNRESET' });
    assert.equal(error.category, category);
    assert.equal(error.message.includes('hidden'), false);
  }
  assert.equal(normalizeProviderError({ code: 'ECONNABORTED' }).category, 'timeout');
  assert.equal(normalizeProviderError({}).category, 'invalid_response');
});
