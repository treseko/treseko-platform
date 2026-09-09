export type WorkflowActionPermissions = {
  view: boolean
  drafts: boolean
  publish: boolean
  activate: boolean
  archive: boolean
  execute: boolean
}

type CapabilityCheck = (capability: string, level?: 'read' | 'edit') => boolean

export function resolveWorkflowActionPermissions(canAccessCapability: CapabilityCheck): WorkflowActionPermissions {
  return {
    view: canAccessCapability('motor_ia.workflow_view', 'read'),
    drafts: canAccessCapability('motor_ia.workflow_drafts', 'edit'),
    publish: canAccessCapability('motor_ia.workflow_publish', 'edit'),
    activate: canAccessCapability('motor_ia.workflow_activate', 'edit'),
    archive: canAccessCapability('motor_ia.workflow_archive', 'edit'),
    execute: canAccessCapability('motor_ia.workflow_execute', 'edit'),
  }
}

export function canEditWorkflowDraft(status: string | undefined, permissions: WorkflowActionPermissions): boolean {
  return permissions.drafts && !['ACTIVE', 'ARCHIVED'].includes(String(status || '').toUpperCase())
}
