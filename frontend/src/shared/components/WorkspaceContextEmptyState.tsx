type WorkspaceContextEmptyStateProps = {
  message: string
  detail?: string
}

export function WorkspaceContextEmptyState({ message, detail }: WorkspaceContextEmptyStateProps) {
  return (
    <div className="workspace-context-empty-state" role="status" aria-live="polite">
      <div className="fw-semibold text-dark">{message}</div>
      {detail && <div className="small text-muted mt-1">{detail}</div>}
    </div>
  )
}
