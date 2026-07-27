import type { WorkflowDefinition } from './workflow.ts';

/** Runtime allowlist. UI metadata alone never makes a workflow block executable. */
export const OPERATIONAL_AGENT_TYPES = new Set([
  'ContextResolver',
  'PreExecutionAnalyst',
  'Observer',
  'Planner',
  'SecurityGuard',
  'Executor',
  'Validator',
  'Recovery',
  'Auditor',
  'Reporter',
  'llm_agent',
  'rule_agent',
  'browser_action_agent',
  'validator_agent',
  'reporter_agent',
  'webhook_agent',
  'script_agent',
  'human_approval_agent',
  'mcp_tool_agent',
  'a2a_disabled_agent',
]);

/** Catalog key -> engine handler. The graph carries agent_key for legacy-safe snapshots. */
export const CORE_AGENT_HANDLER_REGISTRY: Record<string, string> = {
  CONTEXT_RESOLVER: 'ContextResolver',
  PRE_EXECUTION_ANALYST: 'PreExecutionAnalyst',
  OBSERVER: 'Observer',
  AI_AGENT: 'Planner',
  QA_GUARD: 'SecurityGuard',
  SENTINEL: 'Executor',
  VALIDATOR: 'Validator',
  RECOVERY: 'Recovery',
  AUDITOR: 'Auditor',
  REPORTER: 'Reporter',
};

export function validateWorkflowRuntime(definition: WorkflowDefinition): string[] {
  const errors: string[] = [];
  for (const node of definition.nodes || []) {
    if (node.enabled === false) continue;
    const expectedHandler = CORE_AGENT_HANDLER_REGISTRY[String(node.agent_key || '')];
    if (expectedHandler && node.type !== expectedHandler) {
      errors.push(`El agente ${node.name || node.id} declara ${node.agent_key} pero apunta al handler ${node.type}; se esperaba ${expectedHandler}.`);
      continue;
    }
    if (!OPERATIONAL_AGENT_TYPES.has(String(node.type || ''))) {
      errors.push(`El agente ${node.name || node.id} (${node.type || 'sin tipo'}) no tiene handler operativo en el engine.`);
    }
  }
  return errors;
}
