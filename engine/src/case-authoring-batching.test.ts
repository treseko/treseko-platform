import assert from 'node:assert/strict';
import test from 'node:test';
import { caseAuthoringBatches, providerCompletionWasTruncated, splitCaseAuthoringBatch } from './case-authoring-batching.ts';

test('case authoring bounds output size while preserving scenario order', () => {
  const scenarios = Array.from({ length: 11 }, (_, index) => index + 1);
  assert.deepEqual(caseAuthoringBatches(scenarios, 4096), [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11]]);
  assert.deepEqual(caseAuthoringBatches(scenarios, 12000), [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11]]);
  assert.deepEqual(caseAuthoringBatches(scenarios, 512), scenarios.map((scenario) => [scenario]));
});

test('case authoring can halve a batch after a provider truncates output', () => {
  assert.deepEqual(splitCaseAuthoringBatch(['a', 'b', 'c']), [['a', 'b'], ['c']]);
  assert.equal(splitCaseAuthoringBatch(['a']), null);
});

test('detects completion limits from OpenAI, Gemini and Anthropic response contracts', () => {
  assert.equal(providerCompletionWasTruncated({ rawResponse: { choices: [{ finish_reason: 'length' }] } }), true);
  assert.equal(providerCompletionWasTruncated({ rawResponse: { candidates: [{ finishReason: 'MAX_TOKENS' }] } }), true);
  assert.equal(providerCompletionWasTruncated({ rawResponse: { stop_reason: 'max_tokens' } }), true);
  assert.equal(providerCompletionWasTruncated({ rawResponse: { choices: [{ finish_reason: 'stop' }] } }), false);
});
