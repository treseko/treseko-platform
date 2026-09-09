import type {
  AdapterManifestEntry,
  CompiledWorkflowNode,
  GraphRuntimeMode,
  JsonObject,
  WorkflowNodeResult,
  WorkflowRuntimeManifest,
} from './contracts.ts';

export interface AdapterExecutionContext {
  readonly execution_id: string;
  readonly workflow_id: string;
  readonly workflow_version: string;
  readonly plan_hash: string;
  readonly purpose: string;
  readonly runtime_mode: GraphRuntimeMode;
  readonly node: CompiledWorkflowNode;
  readonly input: JsonObject;
  readonly state: Readonly<JsonObject>;
  readonly technical_attempt: number;
  readonly graph_pass: number;
  readonly signal?: AbortSignal;
}

export interface RuntimeAdapter {
  readonly key: string;
  execute(context: AdapterExecutionContext): Promise<WorkflowNodeResult>;
}

export class UnknownRuntimeAdapterError extends Error {
  readonly adapterKey: string;
  constructor(adapterKey: string) {
    super(`Unknown runtime adapter: ${adapterKey}`);
    this.name = 'UnknownRuntimeAdapterError';
    this.adapterKey = adapterKey;
  }
}

export class RuntimeRegistry {
  private readonly adapters = new Map<string, RuntimeAdapter>();
  private readonly manifest = new Map<string, AdapterManifestEntry>();

  constructor(runtimeManifest?: WorkflowRuntimeManifest) {
    for (const entry of runtimeManifest?.adapters ?? []) {
      if (this.manifest.has(entry.key)) {
        throw new Error(`Duplicate adapter in manifest: ${entry.key}`);
      }
      this.manifest.set(entry.key, entry);
    }
  }

  register(adapter: RuntimeAdapter): void {
    if (this.adapters.has(adapter.key)) {
      throw new Error(`Runtime adapter already registered: ${adapter.key}`);
    }
    const manifestEntry = this.manifest.get(adapter.key);
    if (!manifestEntry) {
      throw new Error(`Adapter ${adapter.key} is not declared in the runtime manifest`);
    }
    if (manifestEntry.deprecated) {
      throw new Error(`Cannot register deprecated adapter: ${adapter.key}`);
    }
    this.adapters.set(adapter.key, adapter);
  }

  resolve(adapterKey: string): RuntimeAdapter {
    const adapter = this.adapters.get(adapterKey);
    if (!adapter) throw new UnknownRuntimeAdapterError(adapterKey);
    return adapter;
  }

  assertCompatible(adapterKey: string, purpose: string, contractVersion: string): AdapterManifestEntry {
    const entry = this.manifest.get(adapterKey);
    if (!entry) throw new UnknownRuntimeAdapterError(adapterKey);
    if (!entry.purposes.includes(purpose) && !entry.purposes.includes('*')) {
      throw new Error(`Adapter ${adapterKey} does not support workflow purpose ${purpose}`);
    }
    if (!entry.contract_versions.includes(contractVersion)) {
      throw new Error(`Adapter ${adapterKey} does not support contract ${contractVersion}`);
    }
    return entry;
  }

  listRegistered(): readonly string[] {
    return [...this.adapters.keys()].sort();
  }
}
