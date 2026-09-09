import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveAuthoritativeWorkflowHandler,
  WorkflowAdapterResolutionError,
} from './authoritative-handler-resolver.ts';

describe('resolveAuthoritativeWorkflowHandler', () => {
  it('uses native_adapter for universal nodes even when type points elsewhere', () => {
    const expected = () => 'adapter';
    const wrong = () => 'type';
    const node = {
      id: 'planner',
      type: 'Executor',
      universal_agent: {
        contract: { implementation: { native_adapter: 'legacy-planner/v1' } },
      },
    };
    const handler = resolveAuthoritativeWorkflowHandler(node, {
      Planner: expected,
      Executor: wrong,
    });
    assert.equal((handler as () => string)(), 'adapter');
  });

  it('rejects an unknown universal adapter rather than using default success', () => {
    const node = {
      id: 'broken',
      type: 'Planner',
      universal_agent: {
        contract: { implementation: { native_adapter: 'not-registered/v99' } },
      },
    };
    assert.throws(
      () => resolveAuthoritativeWorkflowHandler(node, { Planner: (): null => null, default: (): null => null }),
      (error: unknown) => error instanceof WorkflowAdapterResolutionError
        && error.code === 'UNKNOWN_RUNTIME_ADAPTER',
    );
  });

  it('keeps legacy fallback only for nodes without a universal contract', () => {
    const expected = () => 'legacy';
    const handler = resolveAuthoritativeWorkflowHandler(
      { id: 'legacy', type: 'Planner' },
      { Planner: expected },
    );
    assert.equal((handler as () => string)(), 'legacy');
  });

  it('rejects a legacy adapter when resolution is explicitly V3 atomic', () => {
    const node = {
      id: 'legacy-in-v3',
      universal_agent: {
        contract: { implementation: { native_adapter: 'legacy-executor/v1' } },
      },
    };
    assert.throws(
      () => resolveAuthoritativeWorkflowHandler(
        node,
        { 'legacy-executor/v1': (): null => null },
        { requiredAdapter: 'legacy-executor/v1', requireV3Atomic: true },
      ),
      (error: unknown) => error instanceof WorkflowAdapterResolutionError
        && error.code === 'NON_ATOMIC_V3_ADAPTER',
    );
  });
});
