import type { AgentInput, AgentOutput, WorkflowNode } from './workflow.ts';

export const UNIVERSAL_AGENT_CONTRACT_VERSION = 'treseko.universal-agent/v1';

export type UniversalAgentContract = {
  contract_version: typeof UNIVERSAL_AGENT_CONTRACT_VERSION;
  key: string;
  version: string;
  implementation: { runtime_key: 'universal-agent-runtime/v1'; native_adapter: string; editable_strategy: string };
  inputs: { schema: Record<string, unknown>; mapping: Record<string, string> };
  instructions: { mode: string; objective: string; user_instructions?: string };
  capabilities: string[];
  output_contract: { schema: Record<string, unknown>; publish: Record<string, string>; required_evidence?: string[] };
  memory: { read_namespaces?: string[]; write_namespaces?: string[] };
  execution: { timeout_sec: number; max_retries: number; model: Record<string, unknown> };
  ports: { control_inputs: string[]; control_outputs: string[]; data_inputs?: Record<string, unknown>; data_outputs?: Record<string, unknown> };
  security: { allow_private_network: false; allow_filesystem: false; allow_shell: false; allow_arbitrary_code: false };
  ui: { category: string };
};

export type UniversalAgentEnvelope = {
  version_id: string;
  version: string;
  contract: UniversalAgentContract;
  contract_hash?: string;
};

const FORBIDDEN_CAPABILITIES = new Set(['agent.a2a_remote', 'script.execute']);
const ALLOWED_ADAPTERS = new Set([
  'legacy-context-resolver/v1', 'legacy-pre-execution-analyst/v1', 'legacy-observer/v1',
  'legacy-planner/v1', 'legacy-security-guard/v1', 'legacy-executor/v1',
  'legacy-validator/v1', 'legacy-recovery/v1', 'legacy-auditor/v1', 'legacy-reporter/v1',
  'universal-llm/v1', 'universal-rules/v1', 'universal-transform/v1', 'universal-browser/v1',
  'universal-validator/v1', 'universal-human-approval/v1', 'universal-http/v1',
  'universal-mcp/v1', 'universal-reporter/v1', 'universal-script-sandbox/v1', 'universal-a2a-disabled/v1',
]);

function valueAtPath(source: any, path: string): any {
  return path.split('.').filter(Boolean).reduce((current, part) => current?.[part], source);
}

function routeFor(status: AgentOutput['status']): string {
  if (status === 'SUCCESS' || status === 'SKIPPED') return 'success';
  if (status === 'BLOCKED') return 'blocked';
  return 'failed';
}

function requestedOutputPort(output: AgentOutput): string {
  return String(
    output.decision?.route?.outputPort
    || output.decision?.outputPort
    || output.decision?.action
    || '',
  ).trim().toLowerCase();
}

export function universalEnvelopeFor(node: WorkflowNode): UniversalAgentEnvelope | null {
  const candidate = (node as WorkflowNode & { universal_agent?: UniversalAgentEnvelope }).universal_agent;
  if (!candidate || !candidate.contract) return null;
  return candidate;
}

export function validateUniversalAgentContract(contract: any): asserts contract is UniversalAgentContract {
  if (!contract || typeof contract !== 'object') throw new Error('El nodo universal no contiene un contrato.');
  if (contract.contract_version !== UNIVERSAL_AGENT_CONTRACT_VERSION) throw new Error('Version de contrato universal no compatible.');
  if (contract.implementation?.runtime_key !== 'universal-agent-runtime/v1') throw new Error('Runtime universal no permitido.');
  if (!ALLOWED_ADAPTERS.has(String(contract.implementation?.native_adapter || ''))) throw new Error('Adaptador universal no registrado.');
  if (!Array.isArray(contract.capabilities) || !contract.capabilities.length) throw new Error('El contrato universal no declara capabilities.');
  if (contract.capabilities.some((capability: string) => FORBIDDEN_CAPABILITIES.has(capability))) throw new Error('El contrato solicita una capability deshabilitada.');
  if (contract.security?.allow_private_network || contract.security?.allow_filesystem || contract.security?.allow_shell || contract.security?.allow_arbitrary_code) {
    throw new Error('El contrato universal solicita una capacidad de host prohibida.');
  }
  if (!['prompt', 'rules', 'mapping', 'hybrid', 'none'].includes(String(contract.implementation?.editable_strategy || ''))) {
    throw new Error('La estrategia editable del agente universal es invalida.');
  }
}

/** Builds the limited context consumed by a registered legacy/native adapter. */
export function prepareUniversalAgentExecution(node: WorkflowNode, input: AgentInput): { envelope: UniversalAgentEnvelope; input: AgentInput } {
  const envelope = universalEnvelopeFor(node);
  if (!envelope) throw new Error(`El nodo ${node.name} no referencia una version universal.`);
  validateUniversalAgentContract(envelope.contract);
  const mappings = envelope.contract.inputs?.mapping || {};
  const declaredInputs = Object.fromEntries(Object.entries(mappings).map(([target, source]) => [target, valueAtPath({ context: input.context, sharedMemory: input.sharedMemory, observation: input.observation, step: input.step }, String(source))]));
  const edgeInputs = input.sharedMemory.universal_inputs?.[node.id] || {};
  const mappedInputs = { ...declaredInputs, ...edgeInputs };
  return {
    envelope,
    input: {
      ...input,
      context: {
        ...input.context,
        universal_agent: {
          key: envelope.contract.key,
          version: envelope.version,
          native_adapter: envelope.contract.implementation.native_adapter,
          capabilities: envelope.contract.capabilities,
          instructions_mode: envelope.contract.instructions.mode,
          mapped_inputs: mappedInputs,
        },
      },
    },
  };
}

/** Normalizes adapter output and enforces the declared memory publication boundary. */
export function finalizeUniversalAgentExecution(envelope: UniversalAgentEnvelope, output: AgentOutput): AgentOutput {
  const allowed = new Set(envelope.contract.memory?.write_namespaces || []);
  const patch = output.sharedMemoryPatch || {};
  const safePatch = allowed.has('execution')
    ? patch
    : Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.has(key.split('.')[0])));
  const evidenceRefs = Array.isArray((output.decision || {}).evidence_refs) ? (output.decision || {}).evidence_refs : [];
  const requiredEvidence = envelope.contract.output_contract?.required_evidence || [];
  if (requiredEvidence.length && !evidenceRefs.length && output.status === 'SUCCESS') {
    return { ...output, status: 'BLOCKED', reason: 'El contrato universal requiere evidencia que el adaptador no produjo.', sharedMemoryPatch: safePatch, next: null };
  }
  const declaredPorts = new Set((envelope.contract.ports?.control_outputs || []).map((item) => String(item).trim().toLowerCase()));
  const requestedPort = requestedOutputPort(output);
  const defaultPort = routeFor(output.status);
  if (requestedPort && !declaredPorts.has(requestedPort)) {
    return {
      ...output,
      status: 'BLOCKED',
      reason: `El agente solicito un puerto no declarado: ${requestedPort}`,
      sharedMemoryPatch: safePatch,
      next: null,
      decision: {
        ...(output.decision || {}),
        universal_result: {
          status: 'BLOCKED',
          reason: `Puerto no declarado: ${requestedPort}`,
          confidence: Number(output.confidence || 0),
          outputs: {}, evidence_refs: evidenceRefs, metrics: output.decision?.metrics || {},
          route: { outputPort: declaredPorts.has('blocked') ? 'blocked' : defaultPort },
          implementation: envelope.contract.implementation.native_adapter,
        },
      },
    };
  }
  const outputPort = requestedPort || defaultPort;
  // Adapters historically publish their result through shared memory. Expose
  // that same safe, namespaced payload as universal outputs so data mappings
  // never depend on adapter-specific implementation details.
  const publishedOutputs = {
    ...safePatch,
    ...(output.decision?.outputs && typeof output.decision.outputs === 'object' ? output.decision.outputs : {}),
  };
  return {
    ...output,
    sharedMemoryPatch: safePatch,
    decision: {
      ...(output.decision || {}),
      universal_result: {
        status: output.status,
        reason: output.reason || '',
        confidence: Number(output.confidence || 0),
        outputs: publishedOutputs,
        evidence_refs: evidenceRefs,
        metrics: output.decision?.metrics || {},
        route: { outputPort },
        implementation: envelope.contract.implementation.native_adapter,
      },
    },
  };
}
