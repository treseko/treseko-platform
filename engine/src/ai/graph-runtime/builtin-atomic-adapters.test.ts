import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { builtInAtomicHandlerFor } from './builtin-atomic-adapters.ts';

describe('graph-native built-in browser adapters', () => {
  it('executes one click action and returns to the graph', async () => {
    let clicks = 0;
    const page = {
      url: () => 'https://example.test/',
      title: async () => 'Example',
      evaluate: async () => ({ url: 'https://example.test/', title: 'Example', readyState: 'complete', loadingSignals: [], dialogs: [], visibleText: [], bodyText: '', elements: [], forms: [] }),
      goto: async () => undefined,
      locator: () => ({ click: async () => { clicks += 1; } }),
      screenshot: async () => Buffer.from('evidence'),
    };
    const handler = builtInAtomicHandlerFor('qa-browser-action-executor/v2');
    const result = await handler?.({
      page,
      plannedAction: { type: 'click', selector: '#save' },
      node: { output_ports: ['executed'] },
    });
    assert.equal(result?.status, 'SUCCESS');
    assert.equal(result?.reason_code, 'BROWSER_ACTION_EXECUTED');
    assert.equal(clicks, 1);
    assert.equal((result as any)?.sharedMemoryPatch?.executed_steps?.[0]?.number, 1);
    assert.equal((result as any)?.sharedMemoryPatch?.executed_steps?.[0]?.history?.[0]?.execution?.ok, true);
    assert.equal((result as any)?.sharedMemoryPatch?.executed_steps?.[0]?.screenshot_base64, Buffer.from('evidence').toString('base64'));
    assert.equal((result as any)?.sharedMemoryPatch?.planned_action, null);
  });

  it('blocks unsafe navigation protocols in code', async () => {
    let navigations = 0;
    const page = {
      url: () => 'https://example.test/',
      goto: async () => { navigations += 1; },
      locator: () => ({}),
    };
    const handler = builtInAtomicHandlerFor('qa-browser-action-executor/v2');
    const result = await handler?.({ page, action: { type: 'goto', url: 'javascript:alert(1)' } });
    assert.equal(result?.status, 'BLOCKED');
    assert.equal(result?.reason_code, 'ACTION_URL_PROTOCOL_DENIED');
    assert.equal(navigations, 0);
  });
  it('never delegates graph-native Executor to the legacy complete-test runner', async () => {
    let legacyCalls = 0;
    let clicks = 0;
    const fallback = async () => { legacyCalls += 1; return { status: 'SUCCESS' }; };
    const page = {
      url: () => 'https://example.test/',
      title: async () => 'Example',
      evaluate: async () => ({ url: 'https://example.test/', title: 'Example', readyState: 'complete', loadingSignals: [], dialogs: [], visibleText: [], bodyText: '', elements: [], forms: [] }),
      goto: async () => undefined,
      locator: () => ({ click: async () => { clicks += 1; } }),
    };
    const handler = builtInAtomicHandlerFor('qa-browser-action-executor/v2', fallback);
    const result = await handler?.({ page, action: { type: 'click', selector: '#save' } });
    assert.equal(result?.status, 'SUCCESS');
    assert.equal(clicks, 1);
    assert.equal(legacyCalls, 0);
  });

  it('does not infer an action from Playwright Page internals', async () => {
    const page = {
      _type: 'Page',
      name: 'select',
      url: () => 'https://example.test/',
      goto: async () => undefined,
      locator: () => ({}),
      select: async () => undefined,
    };
    const handler = builtInAtomicHandlerFor('qa-browser-action-executor/v2');
    const result = await handler?.({ page, sharedMemory: {} });
    assert.equal(result?.status, 'BLOCKED');
    assert.equal(result?.reason_code, 'PLANNED_ACTION_UNAVAILABLE');
  });

  it('routes a blocked fallback through the declared blocked port', async () => {
    const handler = builtInAtomicHandlerFor(
      'qa-browser-observer/v2',
      async () => ({ status: 'BLOCKED', reason: 'no_more_steps', events: [] }),
    );
    const result = await handler?.({ node: { output_ports: ['success', 'blocked'] } });
    assert.equal(result?.status, 'BLOCKED');
    assert.equal(result?.output_port, 'blocked');
  });

  it('keeps failed action evidence in the graph execution steps', async () => {
    const page = {
      url: () => 'https://example.test/',
      goto: async () => undefined,
      title: async () => 'Example',
      screenshot: async () => Buffer.from('failed-evidence'),
      locator: () => ({ click: async () => { throw new Error('Element is not clickable'); } }),
    };
    const handler = builtInAtomicHandlerFor('qa-browser-action-executor/v2');
    const result = await handler?.({
      page,
      plannedAction: { type: 'click', selector: '#missing' },
      sharedMemory: { current_step: 3 },
      qaSteps: [{ number: 3, expected: 'Se abre el detalle' }],
    });

    assert.equal(result?.status, 'FAILED');
    const failedStep = (result as any)?.sharedMemoryPatch?.executed_steps?.[0];
    assert.equal(failedStep.number, 3);
    assert.equal(failedStep.status, 'FALLO');
    assert.equal(failedStep.history[0].execution.ok, false);
    assert.equal(failedStep.screenshot_base64, Buffer.from('failed-evidence').toString('base64'));
    assert.equal((result as any)?.sharedMemoryPatch?.planned_action, null);
  });

  it('fails a technically successful action when its deterministic step contract is not met', async () => {
    const page = {
      url: () => 'https://example.test/inventory.html',
      goto: async () => undefined,
      title: async () => 'Inventory',
      screenshot: async () => Buffer.from('assertion-evidence'),
      locator: () => ({ click: async () => undefined }),
      evaluate: async () => ({
        url: 'https://example.test/inventory.html', title: 'Inventory', readyState: 'complete',
        loadingSignals: [], dialogs: [], visibleText: ['Products'], bodyText: 'Products', elements: [], forms: [],
      }),
    };
    const handler = builtInAtomicHandlerFor('qa-browser-action-executor/v2');
    const result = await handler?.({
      page,
      executionId: 'execution-assertion',
      plannedAction: { type: 'click', selector: '#sort' },
      sharedMemory: { current_step: 5 },
      qaSteps: [{ number: 5, action: 'Ordenar productos', expected: 'Se muestran Unicorn Boots y $999.99.' }],
    });

    assert.equal(result?.status, 'FAILED');
    assert.equal(result?.reason_code, 'STEP_ASSERTION_FAILED');
    assert.equal((result as any)?.sharedMemoryPatch?.executed_steps?.[0]?.status, 'FALLO');
    assert.equal((result as any)?.sharedMemoryPatch?.executed_steps?.[0]?.history?.[0]?.post_validation?.conclusive, true);
  });

  it('validates an observation-only step without clicking its evidence container', async () => {
    let clicks = 0;
    const page = {
      url: () => 'https://example.test/inventory-item.html?id=5',
      goto: async () => undefined,
      title: async () => 'Details',
      screenshot: async () => Buffer.from('observation-evidence'),
      locator: () => ({ click: async () => { clicks += 1; } }),
      evaluate: async () => ({
        url: 'https://example.test/inventory-item.html?id=5', title: 'Details', readyState: 'complete',
        loadingSignals: [], dialogs: [], visibleText: ['Sauce Labs Fleece Jacket', '$49.99'],
        bodyText: 'Sauce Labs Fleece Jacket $49.99', elements: [], forms: [],
      }),
    };
    const handler = builtInAtomicHandlerFor('qa-browser-action-executor/v2');
    const result = await handler?.({
      page,
      plannedAction: { type: 'no_op', selector: '.inventory_details' },
      sharedMemory: { current_step: 6 },
      qaSteps: [{ number: 6, action: 'Comprobar nombre y precio.', expected: 'Se muestran Sauce Labs Fleece Jacket y $7.99.' }],
    });

    assert.equal(clicks, 0);
    assert.equal(result?.status, 'FAILED');
    assert.equal(result?.reason_code, 'STEP_ASSERTION_FAILED');
  });

});
