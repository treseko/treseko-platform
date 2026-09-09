import type { WorkflowDefinition } from '../workflow.ts';

export function graphDispatchEnabled(definition: WorkflowDefinition): boolean {
  const mode = String(
    definition.workflow?.runtime_mode
      || definition.workflow?.decision_policy_json?.runtime_mode
      || '',
  ).toLowerCase();
  return mode === 'graph_compat' || mode === 'graph_native' || mode === 'shadow_compare';
}

export function workflowFormat(definition: WorkflowDefinition): string {
  return String(definition.workflow?.workflow_format || 'legacy_v1').toLowerCase();
}

export function isUniversalWorkflow(definition: WorkflowDefinition): boolean {
  return workflowFormat(definition) === 'universal_v2' || workflowFormat(definition) === 'universal_v3';
}

export function isGraphAuthoritativeV3(definition: WorkflowDefinition): boolean {
  return workflowFormat(definition) === 'universal_v3';
}
