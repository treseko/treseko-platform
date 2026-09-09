import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { advanceValidatedGraphStep, runLlmAgent } from './custom-agents.ts';

const input = {
  executionId: 'execution-1',
  caseId: 'case-1',
  context: { qaSteps: [{ number: 1, action: 'Abrir', data: 'url=https://example.test/path' }] },
  history: [],
  sharedMemory: { current_step: 1 },
};

describe('custom LLM agents', () => {
  it('turns a flat V3 planner response into a canonical planned action', async () => {
    const ai = {
      runWorkflowAgent: async () => ({
        data: {
          status: 'SUCCESS',
          action: 'http.request',
          target_ref: 'https://example.test/path',
          method: 'GET',
          reason: 'Open the requested page',
          confidence: 95,
        },
        metrics: { latencyMs: 12 },
      }),
    } as any;
    const node = {
      id: 'planner', name: 'Planner', type: 'Planner', agent_key: 'planner', enabled: true,
      config_json: { runtime_adapter: 'qa-action-planner/v2', planner_strategy: 'llm_only' },
    };

    const result = await runLlmAgent(ai, node, input);

    assert.deepEqual(result.sharedMemoryPatch?.planned_action, {
      type: 'navigate',
      target_ref: 'https://example.test/path',
      url: 'https://example.test/path',
      reason: 'Open the requested page',
      step_number: 1,
    });
    assert.deepEqual(result.decision?.proposed_action, result.sharedMemoryPatch?.planned_action);
  });

  it('preserves a structured planner action and merges its target URL', async () => {
    const ai = {
      runWorkflowAgent: async () => ({
        data: {
          status: 'SUCCESS',
          action: 'navigate_to',
          target_url: 'https://example.test/',
          proposed_action: { type: 'navigate_to' },
        },
        metrics: {},
      }),
    } as any;
    const node = {
      id: 'planner', name: 'Planner', type: 'Planner', agent_key: 'planner', enabled: true,
      config_json: { runtime_adapter: 'qa-action-planner/v2', planner_strategy: 'llm_only' },
    };

    const result = await runLlmAgent(ai, node, {
      ...input,
      context: { qaSteps: [{ number: 1, action: 'Abrir', data: 'url=https://example.test/' }] },
    });

    assert.deepEqual(result.sharedMemoryPatch?.planned_action, {
      type: 'navigate',
      url: 'https://example.test/',
      step_number: 1,
    });
  });

  it('recovers a provider envelope only for the V3 planner', async () => {
    const ai = {
      runWorkflowAgent: async () => ({
        data: {
          status: 'SUCCESS',
          reason: 'Accion preparada',
          confidence: 92,
          outputs: { action: { type: 'navigate_to', url: 'https://example.test/v3' } },
        },
        metrics: {},
      }),
    } as any;
    const node = {
      id: 'planner', name: 'Planner', type: 'Planner', agent_key: 'planner', enabled: true,
      config_json: { runtime_adapter: 'qa-action-planner/v2', planner_strategy: 'llm_only' },
    };

    const v3Result = await runLlmAgent(ai, node, {
      ...input,
      context: {
        workflow_format: 'universal_v3',
        qaSteps: [{ number: 1, action: 'Abrir', data: 'url=https://example.test/v3' }],
      },
    });
    assert.equal(v3Result.sharedMemoryPatch?.planned_action?.type, 'navigate');
    assert.equal(v3Result.sharedMemoryPatch?.planned_action?.url, 'https://example.test/v3');

    const legacyResult = await runLlmAgent(ai, node, input);
    assert.equal(legacyResult.sharedMemoryPatch?.planned_action, undefined);
  });

  it('normalizes the nested action returned by the local LLM in V3', async () => {
    const ai = {
      runWorkflowAgent: async () => ({
        data: {
          status: 'SUCCESS',
          action: { type: 'navigate', url: 'https://the-internet.herokuapp.com/' },
          reason: 'Abrir la pagina',
          confidence: 95,
        },
        metrics: {},
      }),
    } as any;
    const result = await runLlmAgent(ai, {
      id: 'planner', name: 'Planner', type: 'Planner', agent_key: 'planner', enabled: true,
      config_json: { runtime_adapter: 'qa-action-planner/v2', planner_strategy: 'llm_only' },
    }, {
      ...input,
      context: {
        workflow_format: 'universal_v3',
        qaSteps: [{ number: 1, action: 'Abrir la pagina', data: 'url=https://the-internet.herokuapp.com/' }],
      },
    });

    assert.deepEqual(result.sharedMemoryPatch?.planned_action, {
      type: 'navigate',
      url: 'https://the-internet.herokuapp.com/',
      reason: 'Abrir la pagina',
      step_number: 1,
    });
  });

  it('uses the explicit V3 step contract when the model returns no action', async () => {
    const ai = { runWorkflowAgent: async () => ({ data: {
      status: 'SUCCESS', reason: '', confidence: 90, decision: {}, events: [], sharedMemoryPatch: {},
    }, metrics: {} }) } as any;
    const result = await runLlmAgent(ai, {
      id: 'planner', name: 'Planner', type: 'Planner', agent_key: 'planner', enabled: true,
      config_json: { runtime_adapter: 'qa-action-planner/v2', planner_strategy: 'llm_only' },
    }, {
      ...input,
      context: {
        workflow_format: 'universal_v3',
        qaSteps: [{ number: 1, action: 'Abrir la pagina', data: 'url=https://the-internet.herokuapp.com/' }],
      },
    });

    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.decision?.metrics?.implementation, 'v3-structured-step-fallback');
    assert.deepEqual(result.sharedMemoryPatch?.planned_action, {
      type: 'navigate',
      url: 'https://the-internet.herokuapp.com/',
      reason: 'Accion resuelta desde el contrato estructurado del paso.',
      step_number: 1,
    });
  });

  it('marks a one-step V3 execution complete after successful validation', () => {
    const result = advanceValidatedGraphStep({
      ...input,
      context: { qaSteps: [{ number: 1 }] },
      sharedMemory: { current_step: 1, total_steps: 1 },
    }, { status: 'SUCCESS', reason: 'valid', events: [] });

    assert.deepEqual(result.sharedMemoryPatch, {
      completed_steps: [1],
      current_step: null,
      qa_run_complete: true,
    });
  });

  it('scopes the V3 planner to the current case step', async () => {
    let receivedInput: any;
    const ai = {
      runWorkflowAgent: async (request: any) => {
        receivedInput = request.input;
        return {
          data: { status: 'SUCCESS', action: 'fill', selector: '#password', value: 'demo' },
          metrics: {},
        };
      },
    } as any;
    const node = {
      id: 'planner', name: 'Planner', type: 'Planner', agent_key: 'planner', enabled: true,
      config_json: { runtime_adapter: 'qa-action-planner/v2', planner_strategy: 'llm_only' },
    };
    const result = await runLlmAgent(ai, node, {
      ...input,
      context: {
        qaSteps: [
          { number: 1, action: 'Abrir', data: 'url=https://example.test' },
          { number: 2, action: 'Completar password', data: 'selector=#password, value=demo' },
        ],
      },
      sharedMemory: { current_step: 2 },
    });

    assert.equal(receivedInput.step.number, 2);
    assert.deepEqual(receivedInput.context.qaSteps.map((step: any) => step.number), [2]);
    assert.deepEqual(receivedInput.context.manualSteps.map((step: any) => step.number), [2]);
    assert.equal(result.sharedMemoryPatch?.planned_action?.step_number, 2);
  });

  it('uses an explicit structured step without calling the LLM', async () => {
    let calls = 0;
    const ai = {
      runWorkflowAgent: async () => {
        calls += 1;
        throw new Error('the LLM must not be called');
      },
    } as any;
    const node = {
      id: 'planner', name: 'Planner', type: 'Planner', agent_key: 'planner', enabled: true,
      config_json: { runtime_adapter: 'qa-action-planner/v2' },
    };

    const result = await runLlmAgent(ai, node, {
      ...input,
      context: {
        qaSteps: [{
          number: 1,
          action: 'Escribir el usuario.',
          data: 'selector=[data-test="username"]; value=standard_user',
          expected: 'El campo contiene standard_user.',
        }],
      },
    });

    assert.equal(calls, 0);
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.decision?.metrics?.implementation, 'structured-step-contract');
    assert.deepEqual(result.sharedMemoryPatch?.planned_action, {
      type: 'fill',
      selector: '[data-test="username"]',
      value: 'standard_user',
      reason: 'Accion resuelta desde el contrato estructurado del paso.',
      expected: 'El campo contiene standard_user.',
      step_number: 1,
    });
  });

  it('resolves navigate, select, click and observation contracts without the LLM', async () => {
    const ai = { runWorkflowAgent: async () => { throw new Error('unexpected LLM call'); } } as any;
    const node = {
      id: 'planner', name: 'Planner', type: 'Planner', agent_key: 'planner', enabled: true,
      config_json: { runtime_adapter: 'qa-action-planner/v2' },
    };
    const cases = [
      [{ number: 1, action: 'Abrir la pagina.', data: 'url=https://example.test/path' }, 'navigate'],
      [{ number: 1, action: 'Seleccionar el orden.', data: 'selector=#sort; option_value=lohi' }, 'select'],
      [{ number: 1, action: 'Presionar Login.', data: 'selector=#login-button' }, 'click'],
      [{ number: 1, action: 'Verificar el inventario.', data: 'selector=.inventory_list' }, 'no_op'],
    ] as const;

    for (const [step, expectedType] of cases) {
      const result = await runLlmAgent(ai, node, { ...input, context: { qaSteps: [step] } });
      assert.equal(result.sharedMemoryPatch?.planned_action?.type, expectedType);
    }
  });

  it('falls back to the scoped LLM planner when the step contract is ambiguous', async () => {
    let calls = 0;
    const ai = {
      runWorkflowAgent: async (request: any) => {
        calls += 1;
        assert.equal(request.input.context.qaSteps.length, 1);
        return { data: { status: 'SUCCESS', action: 'click', selector: '#details' }, metrics: {} };
      },
    } as any;
    const node = {
      id: 'planner', name: 'Planner', type: 'Planner', agent_key: 'planner', enabled: true,
      config_json: { runtime_adapter: 'qa-action-planner/v2' },
    };

    const result = await runLlmAgent(ai, node, {
      ...input,
      context: { qaSteps: [{ number: 1, action: 'Explorar el detalle disponible.' }] },
    });

    assert.equal(calls, 1);
    assert.equal(result.sharedMemoryPatch?.planned_action?.type, 'click');
    assert.equal(result.sharedMemoryPatch?.planned_action?.selector, '#details');
  });

  it('blocks a planner action that uses a selector from another step', async () => {
    const ai = {
      runWorkflowAgent: async () => ({
        data: { status: 'SUCCESS', action: 'click', selector: '[data-test="checkout"]' },
        metrics: {},
      }),
    } as any;
    const node = {
      id: 'planner', name: 'Planner', type: 'Planner', agent_key: 'planner', enabled: true,
      config_json: { runtime_adapter: 'qa-action-planner/v2' },
    };
    const result = await runLlmAgent(ai, node, {
      ...input,
      context: { qaSteps: [{ number: 1, action: 'Abrir login', data: 'selector=[data-test="login-button"]' }] },
      sharedMemory: { current_step: 1 },
    });

    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.sharedMemoryPatch?.planned_action?.selector, '[data-test="login-button"]');
    assert.equal(result.sharedMemoryPatch?.planned_action?.type, 'click');
  });

  it('uses the explicit step URL when the model proposes an unrelated click', async () => {
    const ai = {
      runWorkflowAgent: async () => ({
        data: { status: 'SUCCESS', action: 'click', target_ref: 'login-button' },
        metrics: {},
      }),
    } as any;
    const node = {
      id: 'planner', name: 'Planner', type: 'Planner', agent_key: 'planner', enabled: true,
      config_json: { runtime_adapter: 'qa-action-planner/v2', planner_strategy: 'llm_only' },
    };
    const result = await runLlmAgent(ai, node, input);

    assert.equal(result.status, 'SUCCESS');
    assert.deepEqual(result.sharedMemoryPatch?.planned_action, {
      type: 'navigate',
      target_ref: 'login-button',
      url: 'https://example.test/path',
      step_number: 1,
    });
  });

  it('normalizes type_text and injects selector and value from the current step', async () => {
    const ai = {
      runWorkflowAgent: async () => ({
        data: { status: 'SUCCESS', action: 'type_text', target_ref: 'username' },
        metrics: {},
      }),
    } as any;
    const node = {
      id: 'planner', name: 'Planner', type: 'Planner', agent_key: 'planner', enabled: true,
      config_json: { runtime_adapter: 'qa-action-planner/v2' },
    };
    const result = await runLlmAgent(ai, node, {
      ...input,
      context: { qaSteps: [{ number: 1, action: 'Escribir usuario', data: 'selector=#username; value=standard_user' }] },
    });

    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.sharedMemoryPatch?.planned_action?.type, 'fill');
    assert.equal(result.sharedMemoryPatch?.planned_action?.selector, '#username');
    assert.equal(result.sharedMemoryPatch?.planned_action?.value, 'standard_user');
  });

  it('turns an observation-only case step into a non-mutating action', async () => {
    const ai = {
      runWorkflowAgent: async () => ({
        data: { status: 'SUCCESS', action: 'click', selector: '.inventory_details' },
        metrics: {},
      }),
    } as any;
    const node = {
      id: 'planner', name: 'Planner', type: 'Planner', agent_key: 'planner', enabled: true,
      config_json: { runtime_adapter: 'qa-action-planner/v2' },
    };
    const result = await runLlmAgent(ai, node, {
      ...input,
      context: { qaSteps: [{ number: 1, action: 'Comprobar nombre y precio.', data: 'selector=.inventory_details' }] },
    });

    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.sharedMemoryPatch?.planned_action?.type, 'no_op');
    assert.equal(result.sharedMemoryPatch?.planned_action?.selector, '.inventory_details');
  });
});
