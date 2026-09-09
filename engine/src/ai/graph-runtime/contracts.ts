export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type GraphRuntimeMode = 'legacy' | 'graph_compat' | 'graph_native' | 'shadow_compare';
export type WorkflowNodeStatus =
  | 'SUCCESS'
  | 'FAILED'
  | 'BLOCKED'
  | 'RETRYABLE'
  | 'SKIPPED'
  | 'CANCELLED';

export interface WorkflowArtifactReference {
  readonly kind: string;
  readonly reference: string;
  readonly metadata?: JsonObject;
}

export interface WorkflowStatePatch {
  readonly op: 'set' | 'append' | 'increment' | 'remove';
  readonly path: string;
  readonly value?: JsonValue;
}

export interface WorkflowNodeResult {
  readonly status: WorkflowNodeStatus;
  readonly output_port: string;
  readonly reason_code: string;
  readonly message?: string;
  readonly data: JsonObject;
  readonly state_patch?: readonly WorkflowStatePatch[];
  readonly metrics?: Readonly<Record<string, number>>;
  readonly artifacts?: readonly WorkflowArtifactReference[];
  readonly diagnostics?: JsonObject;
}

export interface AdapterManifestEntry {
  readonly key: string;
  readonly version: string;
  readonly purposes: readonly string[];
  readonly contract_versions: readonly string[];
  readonly capabilities: readonly string[];
  readonly side_effects: 'none' | 'read' | 'write' | 'external';
  readonly retryable_reason_codes?: readonly string[];
  readonly input_schema_id?: string;
  readonly output_schema_id?: string;
  readonly deprecated?: boolean;
}

export interface WorkflowRuntimeManifest {
  readonly manifest_version: string;
  readonly adapters: readonly AdapterManifestEntry[];
}

export interface PersistedWorkflowSnapshot {
  readonly id?: string | number;
  readonly workflow_id?: string | number;
  readonly name?: string;
  readonly purpose?: string;
  readonly format?: string;
  readonly version?: string | number;
  readonly runtime_mode?: GraphRuntimeMode;
  readonly entry_node_id?: string;
  readonly nodes?: readonly unknown[];
  readonly edges?: readonly unknown[];
  readonly [key: string]: unknown;
}

export interface CompiledRetryPolicy {
  readonly max_attempts: number;
  readonly initial_backoff_ms: number;
  readonly max_backoff_ms: number;
  readonly retryable_reason_codes: readonly string[];
}

export interface CompiledWorkflowNode {
  readonly id: string;
  readonly type: string;
  readonly enabled: boolean;
  readonly native_adapter: string;
  readonly contract_version: string;
  readonly prompt: string;
  readonly prompt_hash: string;
  readonly implementation_hash: string;
  readonly timeout_ms: number;
  readonly retry_policy: CompiledRetryPolicy;
  readonly capabilities: readonly string[];
  readonly input_mapping: Readonly<Record<string, unknown>>;
  readonly output_mapping: Readonly<Record<string, unknown>>;
  readonly input_ports: readonly string[];
  readonly output_ports: readonly string[];
  readonly terminal_ports: readonly string[];
  readonly config: Readonly<Record<string, unknown>>;
}

export interface CompiledWorkflowEdge {
  readonly id: string;
  readonly source_node_id: string;
  readonly source_port?: string;
  readonly target_node_id: string;
  readonly target_port?: string;
  readonly priority: number;
  readonly max_passes?: number;
  readonly condition: unknown;
  readonly data_mapping: readonly Readonly<{ source: string; target: string }>[];
}

export interface CompiledWorkflowPlan {
  readonly workflow_id: string;
  readonly workflow_version: string;
  readonly purpose: string;
  readonly format: string;
  readonly runtime_mode: GraphRuntimeMode;
  readonly entry_node_id: string;
  readonly nodes: Readonly<Record<string, CompiledWorkflowNode>>;
  readonly edges: readonly CompiledWorkflowEdge[];
  readonly plan_hash: string;
  readonly compiled_at: string;
}

export type CompileIssueSeverity = 'error' | 'warning';
export interface CompileIssue {
  readonly severity: CompileIssueSeverity;
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly node_id?: string;
  readonly edge_id?: string;
}

export interface WorkflowCompileResult {
  readonly ok: boolean;
  readonly plan?: CompiledWorkflowPlan;
  readonly issues: readonly CompileIssue[];
}
