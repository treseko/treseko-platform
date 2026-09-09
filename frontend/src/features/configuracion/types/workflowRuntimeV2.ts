export type WorkflowRuntimeMode = 'legacy' | 'graph_compat' | 'graph_native' | 'shadow_compare';
export type WorkflowNodeStatus = 'SUCCESS' | 'FAILED' | 'BLOCKED' | 'RETRYABLE' | 'SKIPPED' | 'CANCELLED';

export interface WorkflowPreflightIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
  node_id?: string;
  edge_id?: string;
}

export interface EffectiveWorkflowNode {
  id: string;
  type: string;
  native_adapter: string;
  contract_version: string;
  prompt_hash: string;
  implementation_hash: string;
  timeout_ms: number;
  retry_policy: {
    max_attempts: number;
    initial_backoff_ms: number;
    max_backoff_ms: number;
    retryable_reason_codes: string[];
  };
  capabilities: string[];
  output_ports: string[];
  terminal_ports: string[];
}

export interface EffectiveWorkflowPlan {
  workflow_id: string;
  workflow_version: string;
  purpose: string;
  format: string;
  runtime_mode: WorkflowRuntimeMode;
  entry_node_id: string;
  plan_hash: string;
  nodes: Record<string, EffectiveWorkflowNode>;
  edges: Array<{
    id: string;
    source_node_id: string;
    source_port?: string;
    target_node_id: string;
    priority: number;
    max_passes?: number;
    condition: unknown;
  }>;
}

export interface WorkflowPreflightResponse {
  ok: boolean;
  issues: WorkflowPreflightIssue[];
  plan?: EffectiveWorkflowPlan;
}
