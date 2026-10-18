import assert from "node:assert/strict";
import test from "node:test";
import { shouldReuseCaseGenerationScenarios } from "./case-generation-flow.ts";
import { caseAuthoringBatches, providerCompletionWasTruncated } from "../case-authoring-batching.ts";
import { CASE_GENERATION_NODE_GUIDANCE, caseAnalysis, caseProposalContractIssues, validCaseProposal } from "../generation-contracts.ts";

test("case planning separates incompatible outcomes and scopes each scenario to its criteria", () => {
  assert.match(CASE_GENERATION_NODE_GUIDANCE.TestDesignPlanner, /Separa escenarios cuando sus condiciones o resultados sean incompatibles/);
  assert.match(CASE_GENERATION_NODE_GUIDANCE.TestDesignPlanner, /solo los UUID de criterios que sus pasos puedan comprobar/);
  assert.match(CASE_GENERATION_NODE_GUIDANCE.TestDesignPlanner, /Evita escenarios duplicados/);
  assert.match(CASE_GENERATION_NODE_GUIDANCE.TestCaseAuthor, /sin añadir criterios vecinos/);
});

test('case authoring repairs scenario criterion references that do not match their assigned scenario', async () => {
  const { generateCaseProposalsInBatches } = await import('../case-authoring-batching.ts');
  const scenario = { local_id: 'SC-1', title: 'Pago rechazado', objective: 'No se emite tarjeta.', criterion_refs: ['criterion-a'] };
  const calls: any[] = [];
  const ai = { runWorkflowAgent: async (request: any) => {
    calls.push(request);
    const invalid = request.nodeName === 'Author';
    return { data: { propuestas: [{ local_id: 'TC-1', title: 'Pago rechazado', category: 'NEGATIVE', test_type: 'MANUAL',
      criterion_refs: [invalid ? 'criterion-b' : 'criterion-a'], steps: [{ number: 1, action: 'Rechazar pago', expected_result: 'No se emite tarjeta.' }] }] }, metrics: {} };
  } } as any;
  const result = await generateCaseProposalsInBatches({ ai, request: { nodeName: 'Author', promptTemplate: 'Author scenarios.' },
    scenarios: [scenario], memory: {}, allowedCriterionIds: new Set(['criterion-a', 'criterion-b']),
    nodeId: 'author', nodeName: 'Author', maxCompletionTokens: 4096 });
  assert.equal(calls.length, 2);
  assert.match(calls[0].promptTemplate, /en el mismo orden recibido/);
  assert.match(calls[1].promptTemplate, /SCENARIO_CRITERION_REFS_MISMATCH/);
  assert.deepEqual(result.scenarioScopes, [scenario]);
  assert.deepEqual(result.proposals[0].criterion_refs, ['criterion-a']);
});

test("case analysis does not block on internal email-validation implementation details", () => {
  assert.match(CASE_GENERATION_NODE_GUIDANCE.CaseScopeAnalyzer, /No preguntes por el algoritmo interno de validación/);
  assert.match(CASE_GENERATION_NODE_GUIDANCE.CaseScopeAnalyzer, /dato inequívocamente inválido/);
  assert.match(CASE_GENERATION_NODE_GUIDANCE.CaseScopeAnalyzer, /si se pide mostrar el estado, no preguntes por el motivo/);
});

test("case analysis closes only questions explicitly marked out of scope by the user", () => {
  const boundary = "¿Qué proveedor de correo se usa?";
  const unresolved = "¿Qué resultado confirma el pago?";
  const result = caseAnalysis({ readiness: "NEEDS_CLARIFICATION", questions: [boundary, unresolved], proposed_assumptions: [] }, {
    question_answers: [{ question: boundary, answer: "Fuera del alcance del requisito.", scope_decision: "OUT_OF_SCOPE" }],
  });
  assert.deepEqual(result.questions, [unresolved]);
  assert.equal(result.readiness, "NEEDS_CLARIFICATION");
  const resolved = caseAnalysis({ readiness: "NEEDS_CLARIFICATION", questions: [boundary], proposed_assumptions: [] }, {
    question_answers: [{ question: boundary, answer: "Fuera del alcance del requisito.", scope_decision: "OUT_OF_SCOPE" }],
  });
  assert.deepEqual(resolved.questions, []);
  assert.equal(resolved.readiness, "READY");
});

test('case authoring batches large scenario plans and preserves every generated case', async () => {
  const http = await import('node:http');
  const express = (await import('express')).default;
  const { registerGenerationRoutes } = await import('../generation-routes.ts');
  const scenarios = Array.from({ length: 5 }, (_, index) => ({
    local_id: `SC-${index + 1}`, title: `Scenario ${index + 1}`, category: 'POSITIVE',
    criterion_refs: ['criterion'], source_refs: ['criterion:criterion'],
  }));
  const calls: string[] = [];
  const authorScenarioCounts: number[] = [];
  const reviewerScopes: any[] = [];
  let forceTruncation = true;
  const provider = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    const prompt = payload.messages.find((message: any) => message.role === 'user').content;
    const node = prompt.match(/### NODO\n([^\n]+)/)?.[1] || '';
    calls.push(node);
    const inputText = prompt.split('### INPUT JSON\n')[1]?.split('\n### OUTPUT_SCHEMA')[0] || '{}';
    const input = JSON.parse(inputText);
    let decision: any;
    let finishReason = 'stop';
    if (node.startsWith('TestCaseAuthor')) {
      authorScenarioCounts.push(input.scenarios.length);
      if (forceTruncation && input.scenarios.length > 1) { finishReason = 'length'; forceTruncation = false; }
      decision = { propuestas: input.scenarios.map((scenario: any) => ({
        local_id: `TC-${scenario.local_id}`, title: scenario.title, category: 'POSITIVE', test_type: 'MANUAL',
        criterion_refs: scenario.criterion_refs, steps: [{ number: 1, action: 'Ejecutar el escenario', expected_result: 'El resultado esperado se observa.' }],
      })) };
    } else if (node === 'QaCaseCritic') {
      decision = { verdict: 'PASS', findings: [], grounding: [], coverage: [], source_coverage: [] };
    } else {
      const proposal = input.proposal;
      reviewerScopes.push(input.scenario_scope);
      decision = {
        verdict: 'PASS', findings: [],
        grounding: proposal.criterion_refs.map((id: string) => ({ criterion_id: id, status: 'EXPLICIT',
          evidence: [{ source_id: `criterion:${id}`, quote: 'The user can complete the requested action.' }], assumption_ids: [], reason: 'The criterion source supports this case.' })),
        coverage: proposal.criterion_refs.map((id: string) => ({ criterion_id: id, status: 'COVERED', step_numbers: [1], reason: 'Step 1 checks the observable result.' })),
        scenario_coverage: [{ scenario_id: input.scenario_scope.local_id, status: 'COVERED', step_numbers: [1], reason: 'Step 1 verifies the assigned scenario.' }],
        source_coverage: [],
      };
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(decision) }, finish_reason: finishReason }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const app = express(); app.use(express.json());
  registerGenerationRoutes(app, {
    protectedStoryEndpoint: () => true, allowedEndpoint: () => true, allowedFallbacks: () => true,
    sendPublicError: (_request: any, response: any, status: number, message: string, code: string, extra: any = {}) => response.status(status).json({ message, code, ...extra }),
    sendProviderFailure: (_request: any, response: any) => response.status(502).json({ code: 'PROVIDER_FAILURE' }),
  });
  const engine = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => engine.listening ? resolve() : engine.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(engine.address() as any).port}/generate-test-cases-sync`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phase: 'generate', context: {
        historia: { id: 'story', titulo: 'Story' },
        criterios: [{ id: 'criterion', title: 'Requested action', given: 'A user is signed in', when: 'They perform the action', then: ['The result is visible'], observable_result: 'The user can complete the requested action.' }],
        escenarios: scenarios, scenarios, wiki: [], componentes: [],
      }, provider: 'openai-compatible', llm_endpoint: `http://127.0.0.1:${(provider.address() as any).port}/v1`, model: 'controlled',
        provider_max_retries: 0, max_completion_tokens: 4096, context_window_tokens: 8192, max_cases: 5,
        workflow_definition: { workflow: { id: 'workflow', version: 1, workflow_purpose: 'test_case_generation', workflow_format: 'universal_v2', status: 'ACTIVE' },
          nodes: ['CaseScopeAnalyzer', 'TestDesignPlanner', 'TestCaseAuthor', 'QaCaseCritic', 'CoverageTraceabilityAuditor'].map((type, index) => ({ id: type, type, name: type, enabled: true, position_x: index, prompt_template: 'Keep the observable contract.' })) },
      }),
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.propuestas.length, 5);
    assert.deepEqual(result.propuestas.map((item: any) => item.local_id), scenarios.map((item) => `TC-${item.local_id}`));
    assert.deepEqual(reviewerScopes, scenarios);
    const authorCalls = calls.filter((node) => node.startsWith('TestCaseAuthor'));
    assert.equal(authorCalls.length, caseAuthoringBatches(scenarios, 4096).length + 2);
    assert.deepEqual(authorScenarioCounts, [2, 1, 1, 2, 1]);
    const batchTraces = result.workflow_traces.filter((trace: any) => trace.execution_mode === 'bounded_scenario_batch');
    assert.deepEqual(batchTraces.map((trace: any) => trace.scenario_count), [2, 1, 1, 2, 1]);
    assert.equal(batchTraces[0].status, 'OUTPUT_TRUNCATED_SPLIT');
    assert.equal(providerCompletionWasTruncated({ rawResponse: { choices: [{ finish_reason: 'length' }] } }), true);
  } finally {
    await Promise.all([new Promise<void>((resolve) => engine.close(() => resolve())), new Promise<void>((resolve) => provider.close(() => resolve()))]);
  }
});

test("case authoring requires the proposal identifier accepted by persistence", () => {
  const proposal = { local_id: "TCP-001", title: "Acceso válido", category: "POSITIVE", test_type: "MANUAL", steps: [{ number: 1, action: "Pulsar Login", expected_result: "Se muestra el catálogo" }], criterion_refs: ["criterion"] };
  const ids = new Set(["criterion"]);
  assert.equal(validCaseProposal(proposal, ids), true);
  for (const local_id of [undefined, null, "", "   ", 12, {}, "x".repeat(81)]) {
    assert.equal(validCaseProposal({ ...proposal, local_id }, ids), false, `invalid local_id: ${JSON.stringify(local_id)}`);
  }
  assert.equal(validCaseProposal({ ...proposal, local_id: "x".repeat(80) }, ids), true);
});

test("case proposal validation reports actionable contract issue codes", () => {
  const ids = new Set(["criterion"]);
  const issues = caseProposalContractIssues({ title: "Compra", category: "POSITIVE", test_type: "AUTOMATIZADA",
    steps: [{ number: 2, action: "", expected_result: "" }], criterion_refs: ["unknown"] }, ids);
  assert.deepEqual(issues, ["LOCAL_ID_REQUIRED", "STEP_1_SEQUENCE_INVALID", "STEP_1_ACTION_REQUIRED",
    "STEP_1_EXPECTED_RESULT_REQUIRED", "CRITERION_REF_UNKNOWN", "TEST_TYPE_NOT_MANUAL"]);
});

test("reuses persisted scenarios during case generation", () => {
  assert.equal(shouldReuseCaseGenerationScenarios("generate", "TestDesignPlanner", 3), true);
});

test("plans coverage when generation has no scenarios", () => {
  assert.equal(shouldReuseCaseGenerationScenarios("generate", "TestDesignPlanner", 0), false);
});

test("does not skip planning during the estimate phase", () => {
  assert.equal(shouldReuseCaseGenerationScenarios("analyze", "TestDesignPlanner", 3), false);
});
