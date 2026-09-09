import type { WorkflowNode } from '../workflow.ts';

export function resolveLegacyNodeTimeoutMs(
  node: WorkflowNode,
  workflowTimeoutMs: number | undefined,
  workflowStartedAt: number,
): number {
  const remainingWorkflowMs = Number(workflowTimeoutMs || 0) > 0
    ? Math.max(1000, Number(workflowTimeoutMs) - (Date.now() - workflowStartedAt))
    : 0;
  const configuredTimeoutMs = Math.max(1, Number(node.timeout_sec || 60)) * 1000;
  const type = String(node.type || '').toLowerCase();

  // Preserve the historical V1/V2 exception for nodes that own long-running
  // behavior. Universal V3 never calls this path.
  if ((type === 'executor' || type === 'browser_action_agent' || type === 'contextresolver' || type === 'auditor') && configuredTimeoutMs <= 60000 && remainingWorkflowMs > 0) {
    return remainingWorkflowMs;
  }
  return remainingWorkflowMs > 0 ? Math.min(configuredTimeoutMs, remainingWorkflowMs) : configuredTimeoutMs;
}

export function withTimeout<T>(promise: Promise<T>, timeout: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeout);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}
