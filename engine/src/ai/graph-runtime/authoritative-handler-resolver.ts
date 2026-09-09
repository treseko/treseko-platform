import { builtInAtomicHandlerFor } from './builtin-atomic-adapters.ts';
import { hydratePersistedNodeRuntimeView } from './node-runtime-view.ts';
import { BUILTIN_ADAPTER_HANDLER_ALIASES } from './builtin-adapter-aliases.ts';
import { isV3AtomicAdapter } from './v3-adapter-policy.ts';
/**
 * Authoritative handler resolution for persisted workflows.
 *
 * For universal nodes the implementation declared by the immutable workflow
 * snapshot is the only dispatch key. Visual `type` and legacy `agent_key`
 * cannot override it. Legacy dispatch remains available only for nodes that do
 * not carry a universal contract.
 */

export class WorkflowAdapterResolutionError extends Error {
  readonly code:
    | 'MISSING_NATIVE_ADAPTER'
    | 'UNKNOWN_RUNTIME_ADAPTER'
    | 'NON_ATOMIC_V3_ADAPTER'
    | 'MISSING_LEGACY_HANDLER';
  readonly nodeId: string;
  readonly adapter?: string;

  constructor(args: {
    code: WorkflowAdapterResolutionError['code'];
    nodeId: string;
    adapter?: string;
    message: string;
  }) {
    super(args.message);
    this.name = 'WorkflowAdapterResolutionError';
    this.code = args.code;
    this.nodeId = args.nodeId;
    this.adapter = args.adapter;
  }
}

type HandlerMap<THandler> = Record<string, THandler | undefined>;

type NodeLike = {
  id?: string;
  node_id?: string;
  type?: string;
  agent_key?: string;
  universal_agent?: {
    contract?: {
      implementation?: {
        native_adapter?: string;
      };
    };
  };
  universalAgent?: {
    contract?: {
      implementation?: {
        native_adapter?: string;
        nativeAdapter?: string;
      };
    };
  };
};

export function nativeAdapterForNode(node: any): string | undefined {
  const configOverride = node.config_json?.runtime_adapter;
  const snake = node.universal_agent?.contract?.implementation?.native_adapter;
  const camel = node.universalAgent?.contract?.implementation?.native_adapter
    ?? node.universalAgent?.contract?.implementation?.nativeAdapter;
  const value = configOverride ?? snake ?? camel;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function isUniversalWorkflowNode(node: any): boolean {
  return Boolean(node.universal_agent?.contract || node.universalAgent?.contract);
}



function readRuntimePath(root: any, path: string): unknown {
  const normalized = path.replace(/^\$\.?/, '').replace(/^context\./, '');
  if (!normalized) return root;
  return normalized.split('.').reduce((value: any, segment) => {
    if (value === null || value === undefined) return undefined;
    const arrayMatch = /^([^\[]+)\[(\d+)\]$/.exec(segment);
    if (arrayMatch) return value[arrayMatch[1]]?.[Number(arrayMatch[2])];
    return value[segment];
  }, root);
}

function mappedInputFor(mapping: unknown, runtimeContext: any): Record<string, unknown> {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return {};
  const output: Record<string, unknown> = {};
  for (const [target, source] of Object.entries(mapping as Record<string, unknown>)) {
    if (typeof source === 'string') output[target] = readRuntimePath(runtimeContext, source);
    else if (source && typeof source === 'object' && typeof (source as any).path === 'string') {
      output[target] = readRuntimePath(runtimeContext, (source as any).path);
    } else output[target] = source;
  }
  return output;
}

function renderPersistedPrompt(template: unknown, runtimeContext: any): string | undefined {
  if (typeof template !== 'string' || !template) return undefined;
  return template.replace(/\{\{\s*([\w.$\[\]-]+)\s*\}\}/g, (_match, path: string) => {
    const value = readRuntimePath(runtimeContext, path);
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

function wrapWithPersistedNodeContext<THandler>(handler: THandler, node: any): THandler {
  if (typeof handler !== 'function') return handler;
  const wrapped = function(this: unknown, ...args: unknown[]) {
    const effective = node?.runtime_effective ?? {};
    const first = args[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      const mappedInput = mappedInputFor(effective.input_mapping, first);
      const renderedPrompt = renderPersistedPrompt(effective.prompt, { ...(first as any), input: mappedInput });
      const runtimeArgument = first as Record<string, any>;
      Object.assign(runtimeArgument, {
        node: runtimeArgument.node ?? node,
        workflowNode: runtimeArgument.workflowNode ?? node,
        input: Object.keys(mappedInput).length > 0
          ? { ...(runtimeArgument.input ?? {}), ...mappedInput }
          : runtimeArgument.input,
        mappedInput,
        persistedNodePrompt: renderedPrompt ?? runtimeArgument.persistedNodePrompt,
        nodePrompt: renderedPrompt ?? runtimeArgument.nodePrompt,
        workflowPrompt: renderedPrompt ?? runtimeArgument.workflowPrompt,
        nodeConfig: runtimeArgument.nodeConfig ?? effective.config,
        inputMapping: runtimeArgument.inputMapping ?? effective.input_mapping,
        outputMapping: runtimeArgument.outputMapping ?? effective.output_mapping,
        outputSchema: runtimeArgument.outputSchema ?? effective.output_schema,
      });
      args[0] = runtimeArgument;
    }
    return (handler as unknown as (...values: unknown[]) => unknown).apply(this, args);
  };
  return wrapped as unknown as THandler;
}

export function resolveAuthoritativeWorkflowHandler<THandler>(
  node: any,
  handlers: HandlerMap<THandler>,
  options: { requiredAdapter?: string; requireV3Atomic?: boolean } = {},
): THandler {
  const nodeId = String(node.id ?? node.node_id ?? '<unknown-node>');
  hydratePersistedNodeRuntimeView(node as unknown as Record<string, unknown>);

  if (isUniversalWorkflowNode(node)) {
    const adapter = options.requiredAdapter || nativeAdapterForNode(node);
    if (!adapter) {
      throw new WorkflowAdapterResolutionError({
        code: 'MISSING_NATIVE_ADAPTER',
        nodeId,
        message: `Universal workflow node ${nodeId} does not declare implementation.native_adapter`,
      });
    }
    if (options.requireV3Atomic && !isV3AtomicAdapter(adapter)) {
      throw new WorkflowAdapterResolutionError({
        code: 'NON_ATOMIC_V3_ADAPTER',
        nodeId,
        adapter,
        message: `Universal V3 node ${nodeId} requires an atomic qa-*/v2 adapter: ${adapter}`,
      });
    }

    const exactHandler = handlers[adapter];
    const aliasHandler = BUILTIN_ADAPTER_HANDLER_ALIASES[adapter]
      ?.map((key) => handlers[key])
      .find((candidate): candidate is THandler => Boolean(candidate));
    const atomicHandler = builtInAtomicHandlerFor(
      adapter,
      (exactHandler ?? aliasHandler) as unknown as ((...args: any[]) => any) | undefined,
    ) as THandler | undefined;
    const handler = atomicHandler ?? exactHandler ?? aliasHandler;
    if (!handler) {
      throw new WorkflowAdapterResolutionError({
        code: 'UNKNOWN_RUNTIME_ADAPTER',
        nodeId,
        adapter,
        message: `Runtime adapter ${adapter} is not registered for node ${nodeId}`,
      });
    }
    return wrapWithPersistedNodeContext(handler, node);
  }

  const legacyKey = node.agent_key || node.type;
  const legacyHandler = (legacyKey ? handlers[legacyKey] : undefined)
    ?? (node.type ? handlers[node.type] : undefined)
    ?? handlers.default;

  if (!legacyHandler) {
    throw new WorkflowAdapterResolutionError({
      code: 'MISSING_LEGACY_HANDLER',
      nodeId,
      adapter: legacyKey,
      message: `No legacy workflow handler is registered for node ${nodeId}`,
    });
  }
  return legacyHandler;
}
