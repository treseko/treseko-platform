import type { GraphRuntimeMode, PersistedWorkflowSnapshot } from './contracts.ts';

export interface RuntimeModeFlags {
  readonly graph_compat_enabled: boolean;
  readonly graph_native_enabled: boolean;
  readonly shadow_compare_enabled: boolean;
  readonly eligible_purposes: readonly string[];
}

export function resolveRuntimeMode(
  snapshot: PersistedWorkflowSnapshot,
  flags: RuntimeModeFlags,
): GraphRuntimeMode {
  const requested = snapshot.runtime_mode ?? 'legacy';
  const purpose = snapshot.purpose ?? 'unknown';
  if (!flags.eligible_purposes.includes(purpose)) return 'legacy';
  if (requested === 'graph_native') return flags.graph_native_enabled ? 'graph_native' : 'graph_compat';
  if (requested === 'shadow_compare') return flags.shadow_compare_enabled ? 'shadow_compare' : 'legacy';
  if (requested === 'graph_compat') return flags.graph_compat_enabled ? 'graph_compat' : 'legacy';
  return 'legacy';
}

export function mayExecuteSideEffectsTwice(mode: GraphRuntimeMode): boolean {
  // shadow_compare must use replay, an isolated browser, or adapters declared side-effect-free.
  return mode !== 'shadow_compare';
}
