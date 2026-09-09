import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { graphRunResultFromMemory } from './graph-run-result.ts';

describe('graph run result reconstruction', () => {
  it('preserves completed and blocked steps when the workflow exits before Auditor', () => {
    const completedHistory = { action: { __type: 'click' }, execution: { ok: true } };
    const blockedHistory = { action: { __type: 'fill' }, execution: { ok: false } };
    const result = graphRunResultFromMemory({
      executed_steps: [
        { number: 1, status: 'PASO', history: [completedHistory], checkpoints: [{ step: 1 }] },
        { number: 2, status: 'BLOQUEADO', history: [blockedHistory], checkpoints: [{ step: 2 }] },
      ],
      visited_urls: ['https://example.test/', 'https://example.test/form'],
      detected_errors: ['Timeout esperando #missing'],
    }, 'Recovery finalizo el workflow');

    assert.deepEqual(result.steps.map((step) => [step.number, step.status]), [
      [1, 'PASO'],
      [2, 'BLOQUEADO'],
    ]);
    assert.deepEqual(result.history, [completedHistory, blockedHistory]);
    assert.deepEqual(result.checkpoints, [{ step: 1 }, { step: 2 }]);
    assert.deepEqual(result.errors, ['Timeout esperando #missing']);
  });

  it('uses the terminal reason only when graph memory has no detected error', () => {
    const result = graphRunResultFromMemory({ executed_steps: [] }, 'Workflow bloqueado');
    assert.deepEqual(result.errors, ['Workflow bloqueado']);
  });
});
