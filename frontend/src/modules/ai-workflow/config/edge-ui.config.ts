export type EdgeUiMeta = {
  label: string
  color: string
  strokeWidth: number
  animated: boolean
}

export const EDGE_UI_CONFIG: Record<string, EdgeUiMeta> = {
  always: { label: '', color: '#64748B', strokeWidth: 2, animated: false },
  on_success: { label: 'success', color: '#16A34A', strokeWidth: 2.5, animated: false },
  on_failed: { label: 'failed', color: '#DC2626', strokeWidth: 2.5, animated: false },
  on_rejected: { label: 'rejected', color: '#DC2626', strokeWidth: 2.5, animated: false },
  on_blocked: { label: 'blocked', color: '#F59E0B', strokeWidth: 2.5, animated: false },
  retry_count_lt: { label: 'retry', color: '#2563EB', strokeWidth: 2.5, animated: true },
  approved: { label: 'approved', color: '#16A34A', strokeWidth: 2.5, animated: false },
  passed: { label: 'passed', color: '#16A34A', strokeWidth: 2.5, animated: false },
  failed: { label: 'failed', color: '#DC2626', strokeWidth: 2.5, animated: false },
  rejected: { label: 'rejected', color: '#DC2626', strokeWidth: 2.5, animated: false },
  blocked: { label: 'blocked', color: '#F59E0B', strokeWidth: 2.5, animated: false },
  retry: { label: 'retry', color: '#2563EB', strokeWidth: 2.5, animated: true },
  no_more_steps: { label: 'no more steps', color: '#8B5CF6', strokeWidth: 2.5, animated: false },
  report: { label: 'report', color: '#64748B', strokeWidth: 2, animated: false },
}

type EdgeLike = {
  condition_type?: string
  condition_json?: Record<string, any>
  source_node_id?: string
  target_node_id?: string
}

type NodeLike = {
  type?: string
  agent_key?: string
}

function nodeKind(node?: NodeLike): string {
  return String(node?.type || node?.agent_key || '')
}

export function getEdgeUiMeta(edge: EdgeLike, nodesById: Map<string, NodeLike>): EdgeUiMeta {
  const source = nodeKind(nodesById.get(String(edge.source_node_id || '')))
  const target = nodeKind(nodesById.get(String(edge.target_node_id || '')))
  let semanticKey = String(edge.condition_type || 'always')

  if (edge.condition_json?.reason === 'no_more_steps') semanticKey = 'no_more_steps'
  else if (source === 'SecurityGuard' && target === 'Executor') semanticKey = 'approved'
  else if (source === 'QA_GUARD' && target === 'SENTINEL') semanticKey = 'approved'
  else if (source === 'SecurityGuard' && target === 'Recovery') semanticKey = 'rejected'
  else if (source === 'QA_GUARD' && target === 'RECOVERY') semanticKey = 'rejected'
  else if (source === 'Validator' && target === 'Observer') semanticKey = 'passed'
  else if (source === 'VALIDATOR' && target === 'OBSERVER') semanticKey = 'passed'
  else if (source === 'Validator' && target === 'Recovery') semanticKey = 'failed'
  else if (source === 'VALIDATOR' && target === 'RECOVERY') semanticKey = 'failed'
  else if (source === 'Recovery' && target === 'Observer') semanticKey = 'retry'
  else if (source === 'RECOVERY' && target === 'OBSERVER') semanticKey = 'retry'
  else if (source === 'Recovery' && target === 'Auditor') semanticKey = 'blocked'
  else if (source === 'RECOVERY' && target === 'AUDITOR') semanticKey = 'blocked'
  else if (source === 'Auditor' && target === 'Reporter') semanticKey = 'report'
  else if (source === 'AUDITOR' && target === 'REPORTER') semanticKey = 'report'

  const meta = EDGE_UI_CONFIG[semanticKey] || EDGE_UI_CONFIG[String(edge.condition_type || 'always')] || EDGE_UI_CONFIG.always
  if (edge.condition_json?.label) return { ...meta, label: String(edge.condition_json.label) }
  return meta
}
