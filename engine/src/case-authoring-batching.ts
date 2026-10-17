import crypto from 'node:crypto';
import { caseProposalContractIssues, normalizeCaseProposalCategory } from './generation-contracts.ts';

const MAX_CASES_PER_AUTHORING_BATCH = 6;
const COMPLETION_TOKENS_PER_CASE_BUDGET = 1800;

/** Bound each structured response so long suites do not truncate at the provider token limit. */
export function caseAuthoringBatches<T>(scenarios: T[], maxCompletionTokens: number): T[][] {
  const items = Array.isArray(scenarios) ? scenarios : [];
  if (!items.length) return [];
  const tokenBudget = Number.isFinite(maxCompletionTokens) ? Math.max(1, Math.floor(maxCompletionTokens)) : 4096;
  const batchSize = Math.max(1, Math.min(MAX_CASES_PER_AUTHORING_BATCH, Math.floor(tokenBudget / COMPLETION_TOKENS_PER_CASE_BUDGET)));
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += batchSize) batches.push(items.slice(index, index + batchSize));
  return batches;
}

export function splitCaseAuthoringBatch<T>(scenarios: T[]): [T[], T[]] | null {
  if (!Array.isArray(scenarios) || scenarios.length < 2) return null;
  const middle = Math.ceil(scenarios.length / 2);
  return [scenarios.slice(0, middle), scenarios.slice(middle)];
}

/** Providers signal an output cut differently; never accept a truncated proposal as complete. */
export function providerCompletionWasTruncated(result: any): boolean {
  const raw = result?.rawResponse || result?.raw_response || {};
  const finish = String(raw?.choices?.[0]?.finish_reason || raw?.candidates?.[0]?.finishReason || raw?.stop_reason || raw?.stopReason || '').toLowerCase();
  return ['length', 'max_tokens', 'max_output_tokens', 'max_tokens_reached'].includes(finish);
}
export async function generateCaseProposalsInBatches({ ai, request, scenarios, memory, allowedCriterionIds, nodeId, nodeName, maxCompletionTokens }: any) {
  const pending = caseAuthoringBatches(scenarios, maxCompletionTokens);
  if (!pending.length) throw Object.assign(new Error('CASE_GENERATION_CONTRACT_INVALID'), { contractIssues: ['SCENARIOS_REQUIRED'], generationTraces: [] });
  const proposals: any[] = [];
  const scenarioScopes: any[] = [];
  const traces: any[] = [];
  let attemptIndex = 0;
  const record = (result: any, prompt: string, attemptStarted: number, status: string, scenarioCount: number, returnedCount: number, retryCount: number) => {
    traces.push({ node_id: nodeId, node_type: 'TestCaseAuthor', node_name: nodeName, prompt_hash: crypto.createHash('sha256').update(prompt).digest('hex'), duration_ms: Date.now() - attemptStarted, status, retry_count: retryCount, execution_mode: 'bounded_scenario_batch', batch_index: ++attemptIndex, scenario_count: scenarioCount, returned_proposal_count: returnedCount, metrics: result?.metrics || {} });
  };
  const run = async (callRequest: any, prompt: string, scenarioCount: number, retryCount: number) => {
    const started = Date.now();
    try { return { result: await ai.runWorkflowAgent(callRequest), started }; }
    catch (error: any) {
      record(null, prompt, started, 'PROVIDER_ERROR', scenarioCount, 0, retryCount);
      error.generationTraces = traces;
      throw error;
    }
  };
  const parse = (value: any) => Array.isArray(value?.propuestas) ? value.propuestas.map(normalizeCaseProposalCategory) : [];
  const validate = (values: any[]) => {
    const issues = values.flatMap((proposal: any, index: number) => caseProposalContractIssues(proposal, allowedCriterionIds).map((issue) => `PROPOSAL_${index + 1}:${issue}`));
    return issues;
  };
  for (let batchIndex = 0; batchIndex < pending.length; batchIndex += 1) {
    const batch = pending[batchIndex];
    const batchMemory = { ...memory, scenarios: batch, max_cases: batch.length, propuestas: [...proposals] };
    const batchPrompt = `${request.promptTemplate}\nEste lote contiene ${batch.length} escenarios. Devuelve exactamente un caso manual por cada escenario, en el mismo orden recibido y sin casos adicionales. Usa un local_id nuevo que no aparezca en propuestas previas. Conserva exactamente las referencias de criterio del escenario correspondiente. Evalúa y redacta solo su condición, datos y resultado observable; no copies otro escenario ni combines varios. No incluyas escenarios de otros lotes.`;
    const batchRequest = { ...request, promptTemplate: batchPrompt, input: batchMemory };
    let called = await run(batchRequest, batchPrompt, batch.length, 0);
    let result = called.result;
    let output = result.data?.decision && typeof result.data.decision === 'object' ? result.data.decision : result.data;
    if (providerCompletionWasTruncated(result)) {
      record(result, batchPrompt, called.started, 'OUTPUT_TRUNCATED_SPLIT', batch.length, parse(output).length, 0);
      const halves = splitCaseAuthoringBatch(batch);
      if (halves) { pending.splice(batchIndex, 1, ...halves); batchIndex -= 1; continue; }
      const error: any = new Error('CASE_GENERATION_OUTPUT_TRUNCATED'); error.contractIssues = ['OUTPUT_TOKEN_LIMIT_REACHED']; error.generationTraces = traces; throw error;
    }
    let values = parse(output);
    const validateBatch = (items: any[]) => {
      const issues = validate(items);
      if (items.length !== batch.length) issues.push('SCENARIO_CASE_COUNT_MISMATCH');
      items.forEach((proposal: any, index: number) => {
        const scenario: any = batch[index];
        const expectedRefs = Array.isArray(scenario?.criterion_refs) ? scenario.criterion_refs.map(String).sort() : [];
        const actualRefs = Array.isArray(proposal?.criterion_refs) ? proposal.criterion_refs.map(String).sort() : [];
        if (JSON.stringify(actualRefs) !== JSON.stringify(expectedRefs)) issues.push(`PROPOSAL_${index + 1}:SCENARIO_CRITERION_REFS_MISMATCH`);
      });
      const seen = new Set(proposals.map((proposal) => String(proposal.local_id || '')));
      items.forEach((proposal: any, index: number) => {
        const id = String(proposal?.local_id || '').trim();
        if (id && seen.has(id)) issues.push(`PROPOSAL_${index + 1}:LOCAL_ID_DUPLICATE`);
        if (id) seen.add(id);
      });
      return [...new Set(issues)];
    };
    let issues = values.length ? validateBatch(values) : ['PROPOSALS_REQUIRED'];
    let retryCount = 0;
    let prompt = batchPrompt;
    if (issues.length) {
      record(result, prompt, called.started, 'CONTRACT_REPAIR_REQUIRED', batch.length, values.length, 0);
      retryCount = 1;
      prompt = `${batchPrompt}\nLa respuesta anterior incumplió el contrato: ${issues.join(', ')}. Repara este lote una sola vez. Devuelve exactamente un caso por escenario, con local_id único, categoría permitida, test_type MANUAL, referencias de criterio de la lista y pasos consecutivos con acción y resultado observable. No inventes UUID ni criterios. Sólo JSON.`;
      called = await run({ ...batchRequest, nodeName: `${nodeName} - reparación`, promptTemplate: prompt, input: { ...batchMemory, invalid_proposals: values, contract_issues: issues } }, prompt, batch.length, retryCount);
      result = called.result;
      output = result.data?.decision && typeof result.data.decision === 'object' ? result.data.decision : result.data;
      values = parse(output);
      if (providerCompletionWasTruncated(result)) {
        record(result, prompt, called.started, 'OUTPUT_TRUNCATED_SPLIT', batch.length, values.length, retryCount);
        const halves = splitCaseAuthoringBatch(batch);
        if (halves) { pending.splice(batchIndex, 1, ...halves); batchIndex -= 1; continue; }
        const error: any = new Error('CASE_GENERATION_OUTPUT_TRUNCATED'); error.contractIssues = ['OUTPUT_TOKEN_LIMIT_REACHED']; error.generationTraces = traces; throw error;
      }
      issues = values.length ? validateBatch(values) : ['PROPOSALS_REQUIRED'];
    }
    if (issues.length) {
      record(result, prompt, called.started, 'INVALID_CONTRACT', batch.length, values.length, retryCount);
      const error: any = new Error('CASE_GENERATION_CONTRACT_INVALID'); error.contractIssues = issues.slice(0, 40); error.generationTraces = traces; throw error;
    }
    proposals.push(...values);
    scenarioScopes.push(...batch);
    record(result, prompt, called.started, result.data?.status || 'SUCCESS', batch.length, values.length, retryCount);
  }
  return { proposals, scenarioScopes, traces };
}
