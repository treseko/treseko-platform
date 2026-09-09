import type { AgentInput, AgentOutput, WorkflowNode } from '../workflow.ts';

export function valueAtPath(source: any, path: string): any {
  return String(path || '').split('.').filter(Boolean).reduce((current, part) => current?.[part], source);
}

export function applyNodeInputMapping(node: WorkflowNode, input: AgentInput): AgentInput {
  const mapping = node.config_json?.input_mapping || node.input_mapping;
  const edgeInputs = input.sharedMemory.universal_inputs?.[String(node.id)];
  const hasEdgeInputs = edgeInputs && typeof edgeInputs === 'object' && !Array.isArray(edgeInputs);
  if ((!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) && !hasEdgeInputs) return input;
  const source = { context: input.context, observation: input.observation, step: input.step, sharedMemory: input.sharedMemory, history: input.history };
  const mappedInputs = Object.fromEntries(
    Object.entries(mapping || {})
      .filter(([, path]) => typeof path === 'string' && path.trim())
      .map(([target, path]) => [target, valueAtPath(source, path as string)]),
  );
  return {
    ...input,
    context: { ...input.context, workflow_inputs: { ...(hasEdgeInputs ? edgeInputs : {}), ...mappedInputs } },
  };
}

export function applyNodeOutputMapping(node: WorkflowNode, output: AgentOutput): AgentOutput {
  const mapping = node.config_json?.output_mapping || node.output_mapping;
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return output;
  const source = { output, decision: output.decision, sharedMemory: output.sharedMemoryPatch || {} };
  const mappedPatch = Object.fromEntries(
    Object.entries(mapping)
      .filter(([target, path]) => typeof path === 'string' && path.trim() && !['__proto__', 'prototype', 'constructor'].includes(target))
      .map(([target, path]) => [String(target).replace(/^sharedMemory\./, ''), valueAtPath(source, path as string)]),
  );
  return { ...output, sharedMemoryPatch: { ...(output.sharedMemoryPatch || {}), ...mappedPatch } };
}
