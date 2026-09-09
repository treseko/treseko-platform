import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCondition, normalizeCondition, selectDeterministicEdge } from './condition-evaluator.ts';

const context = {
  result: { status: 'SUCCESS' as const, output_port: 'completed', reason_code: 'NO_MORE_STEPS', data: {} },
  state: {}, retry_count: 0, pass_count: 1, confidence: 0.92,
};

test('normalizes legacy reason into reason_code', () => {
  const condition = normalizeCondition({ status: 'SUCCESS', reason: 'NO_MORE_STEPS' });
  assert.equal(evaluateCondition(condition, context), true);
});

test('fails on ambiguous edges with the same priority', () => {
  const edges = [
    { id: 'a', priority: 1, condition: normalizeCondition(null) },
    { id: 'b', priority: 1, condition: normalizeCondition(null) },
  ];
  assert.throws(() => selectDeterministicEdge(edges, context), /AMBIGUOUS_EDGE_MATCH/);
});
