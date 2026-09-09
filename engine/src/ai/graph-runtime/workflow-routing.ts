import type { AgentOutput, WorkflowDefinition, WorkflowEdge, WorkflowNode } from '../workflow.ts';

export function startNode(definition: WorkflowDefinition): WorkflowNode | undefined {
  const explicit = definition.workflow?.decision_policy_json?.entry_node_id;
  if (explicit) return definition.nodes.find((node) => String(node.id) === String(explicit) && node.enabled !== false);
  const targets = new Set(definition.edges.map((edge) => String(edge.target_node_id)));
  return definition.nodes.find((node) => node.enabled !== false && !targets.has(String(node.id)))
    || definition.nodes.find((node) => node.enabled !== false);
}

export function conditionMatches(edge: WorkflowEdge, output: AgentOutput, retryCount: number): boolean {
  const condition = String(edge.condition_type || 'always').toLowerCase();
  const outputPort = String(output.decision?.universal_result?.route?.outputPort || output.decision?.route?.outputPort || '').toLowerCase();
  if (condition === 'output_port' || condition === 'decision_is') {
    const expected = String(edge.condition_json?.value || edge.condition_json?.output_port || edge.source_handle || '').toLowerCase();
    return Boolean(expected) && outputPort === expected;
  }
  if (condition === 'always') return true;
  if (condition === 'on_success') return output.status === 'SUCCESS';
  if (condition === 'on_failed') return output.status === 'FAILED';
  if (condition === 'on_blocked') return output.status === 'BLOCKED';
  if (condition === 'on_rejected') return output.status === 'FAILED' || output.decision?.approved === false || output.decision?.rejected === true;
  if (condition === 'confidence_lt') return Number(output.confidence || 0) < Number(edge.condition_json?.value ?? edge.condition_json?.threshold ?? 70);
  if (condition === 'retry_count_lt') return retryCount < Number(edge.condition_json?.max ?? edge.condition_json?.value ?? 1);
  return false;
}
