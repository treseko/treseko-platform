import type { WorkflowDefinition } from './workflow.ts';

/** Compiles the declarative V2 envelope into the existing audited graph runtime. */
export function compileBlockWorkflow(definition: WorkflowDefinition): WorkflowDefinition {
  if (definition.workflow?.workflow_format !== 'block_v2') return definition;
  const nodes = definition.nodes.map((node) => ({
    ...node,
    config_json: { ...(node.config_json || {}), block_contract_version: 'treseko.block/v1' },
  }));
  for (const node of nodes) {
    if (node.enabled !== false && !String(node.agent_key || '').startsWith('BLOCK_')) {
      throw new Error(`El bloque V2 ${node.name} no declara un contrato Treseko Block v1.`);
    }
  }
  return { ...definition, nodes };
}
