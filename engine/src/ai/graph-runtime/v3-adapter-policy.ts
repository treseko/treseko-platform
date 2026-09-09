/**
 * Closed allowlist for Universal V3.
 *
 * Every entry maps to a built-in adapter that performs exactly one graph node
 * responsibility. Legacy adapters and generic universal adapters may remain
 * available to V1/V2, but they cannot be compiled into a V3 plan.
 */
export const V3_ATOMIC_ADAPTERS = new Set([
  'qa-context-resolver/v2',
  'qa-pre-execution-analyst/v2',
  'qa-browser-observer/v2',
  'qa-action-planner/v2',
  'qa-security-guard/v2',
  'qa-browser-action-executor/v2',
  'qa-step-validator/v2',
  'qa-recovery-strategist/v2',
  'qa-final-auditor/v2',
  'qa-execution-reporter/v2',
]);

export function isV3AtomicAdapter(adapter: string): boolean {
  return V3_ATOMIC_ADAPTERS.has(String(adapter || '').trim());
}
