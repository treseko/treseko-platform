export const NODE_STATUS_UI_CONFIG: Record<string, {
  label: string
  dotClass: string
  badgeClass: string
  borderClass: string
}> = {
  PENDING: { label: 'Pendiente', dotClass: 'workflow-status-dot-pending', badgeClass: 'workflow-status-badge-pending', borderClass: 'workflow-status-border-pending' },
  RUNNING: { label: 'Ejecutando', dotClass: 'workflow-status-dot-running', badgeClass: 'workflow-status-badge-running', borderClass: 'workflow-status-border-running' },
  SUCCESS: { label: 'Success', dotClass: 'workflow-status-dot-success', badgeClass: 'workflow-status-badge-success', borderClass: 'workflow-status-border-success' },
  FAILED: { label: 'Failed', dotClass: 'workflow-status-dot-failed', badgeClass: 'workflow-status-badge-failed', borderClass: 'workflow-status-border-failed' },
  RETRYING: { label: 'Reintentando', dotClass: 'workflow-status-dot-retrying', badgeClass: 'workflow-status-badge-retrying', borderClass: 'workflow-status-border-retrying' },
  BLOCKED: { label: 'Bloqueado', dotClass: 'workflow-status-dot-blocked', badgeClass: 'workflow-status-badge-blocked', borderClass: 'workflow-status-border-blocked' },
  SKIPPED: { label: 'Omitido', dotClass: 'workflow-status-dot-skipped', badgeClass: 'workflow-status-badge-skipped', borderClass: 'workflow-status-border-skipped' },
}

export function getNodeStatusUiMeta(status?: string) {
  return NODE_STATUS_UI_CONFIG[String(status || 'PENDING').toUpperCase()] || NODE_STATUS_UI_CONFIG.PENDING
}
