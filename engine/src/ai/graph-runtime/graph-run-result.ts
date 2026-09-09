import type { StepRunResult, StructuredHistoryItem } from '../../automation/action-types.ts';

export type GraphRunResult = {
  steps: StepRunResult[];
  history: StructuredHistoryItem[];
  visited_urls: string[];
  checkpoints: any[];
  errors: string[];
};

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

/**
 * Rebuilds the browser run from graph-owned state. This must also be used when
 * a V3 workflow exits before Auditor/Reporter (for example through Recovery),
 * otherwise the report loses every action and its evidence.
 */
export function graphRunResultFromMemory(
  sharedMemory: Record<string, any> | undefined,
  fallbackReason?: string,
): GraphRunResult {
  const memory = sharedMemory || {};
  const steps = Array.isArray(memory.executed_steps)
    ? memory.executed_steps as StepRunResult[]
    : [];
  const errors = strings(memory.detected_errors);
  const normalizedFallback = String(fallbackReason || '').trim();
  if (!errors.length && normalizedFallback) errors.push(normalizedFallback);

  return {
    steps,
    history: steps.flatMap((step) => Array.isArray(step.history) ? step.history : []),
    visited_urls: strings(memory.visited_urls),
    checkpoints: steps.flatMap((step) => Array.isArray(step.checkpoints) ? step.checkpoints : []),
    errors,
  };
}
