/**
 * Public runtime contract for the built-in workflow agents.
 *
 * A workflow stores the selected implementation key, prompt and safe strategy
 * configuration. The implementation itself stays in the engine allowlist; it
 * is never arbitrary code supplied by a workflow author.
 */
export type AgentRuntimeManifest = {
  implementation: string;
  version: number;
  sourceModule: string;
  editableStrategy: 'prompt' | 'rules' | 'sandbox_script' | 'none';
  inputs: string[];
  outputs: string[];
};

export const AGENT_RUNTIME_MANIFESTS: Record<string, AgentRuntimeManifest> = {
  CONTEXT_RESOLVER: {
    implementation: 'context-resolver/v1', version: 1,
    sourceModule: 'engine/src/index.ts#ContextResolver', editableStrategy: 'prompt',
    inputs: ['case.steps', 'context.variables', 'sharedMemory.base_url_candidate'],
    outputs: ['sharedMemory.base_url', 'sharedMemory.total_steps'],
  },
  PRE_EXECUTION_ANALYST: {
    implementation: 'pre-execution-analyst/v1', version: 1,
    sourceModule: 'engine/src/index.ts#PreExecutionAnalyst', editableStrategy: 'prompt',
    inputs: ['case.action', 'case.data', 'case.expected'],
    outputs: ['sharedMemory.execution_validation_plans'],
  },
  OBSERVER: {
    implementation: 'browser-observer/v1', version: 1,
    sourceModule: 'engine/src/automation/observation.ts#observeBrowser', editableStrategy: 'prompt',
    inputs: ['browser.page', 'sharedMemory.current_step'],
    outputs: ['sharedMemory.last_observation'],
  },
  AI_AGENT: {
    implementation: 'qa-planner/v1', version: 1,
    sourceModule: 'engine/src/automation/step-runner.ts#runQaSteps', editableStrategy: 'prompt',
    inputs: ['step.contract', 'sharedMemory.last_observation', 'sharedMemory.history'],
    outputs: ['sharedMemory.proposed_action', 'sharedMemory.last_confidence'],
  },
  QA_GUARD: {
    implementation: 'qa-security-guard/v1', version: 1,
    sourceModule: 'engine/src/automation/action-executor.ts#validateAction', editableStrategy: 'rules',
    inputs: ['sharedMemory.proposed_action', 'sharedMemory.last_observation'],
    outputs: ['sharedMemory.approved_action', 'sharedMemory.guard_reason'],
  },
  SENTINEL: {
    implementation: 'browser-executor/v1', version: 1,
    sourceModule: 'engine/src/automation/step-runner.ts#runQaSteps', editableStrategy: 'none',
    inputs: ['sharedMemory.approved_action', 'sharedMemory.current_step'],
    outputs: ['sharedMemory.last_execution', 'sharedMemory.detected_errors'],
  },
  VALIDATOR: {
    implementation: 'contract-validator/v1', version: 1,
    sourceModule: 'engine/src/automation/step-contract.ts#evaluateStepContract', editableStrategy: 'rules',
    inputs: ['step.contract', 'sharedMemory.last_execution', 'sharedMemory.last_observation'],
    outputs: ['sharedMemory.validation', 'sharedMemory.current_step'],
  },
  RECOVERY: {
    implementation: 'recovery-policy/v1', version: 1,
    sourceModule: 'engine/src/automation/step-runner.ts#deterministicRecoveryAction', editableStrategy: 'rules',
    inputs: ['sharedMemory.validation', 'sharedMemory.retry_count'],
    outputs: ['sharedMemory.recovery_decision', 'sharedMemory.retry_count'],
  },
  AUDITOR: {
    implementation: 'evidence-auditor/v1', version: 1,
    sourceModule: 'engine/src/audit/consensus.ts#resolveAuditConsensus', editableStrategy: 'prompt',
    inputs: ['evidence.bundle', 'sharedMemory.history'],
    outputs: ['sharedMemory.audit_status', 'sharedMemory.audit_evidence_refs'],
  },
  REPORTER: {
    implementation: 'execution-reporter/v1', version: 1,
    sourceModule: 'engine/src/automation/report-generator.ts#ReportGenerator', editableStrategy: 'none',
    inputs: ['sharedMemory', 'workflow.traces'],
    outputs: ['report.summary', 'report.metrics'],
  },
};

export function runtimeManifestFor(agentKey: string): AgentRuntimeManifest | undefined {
  const key = String(agentKey || '').toUpperCase();
  return AGENT_RUNTIME_MANIFESTS[key] || AGENT_RUNTIME_MANIFESTS[key.replace(/^BLOCK_/, '')];
}
