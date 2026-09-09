import type { AiWorkflow } from './types/configuracion'

export const WORKFLOW_EDITOR_SELECTION_KEY = 'treseko.workflow-editor.selected-id'

export function chooseWorkflowForEditor(
  workflows: AiWorkflow[],
  persistedWorkflowId?: string | null,
  activeWorkflowId?: string | null,
): AiWorkflow | null {
  return workflows.find(workflow => workflow.id === persistedWorkflowId)
    || workflows.find(workflow => workflow.id === activeWorkflowId)
    || workflows.find(workflow => workflow.status === 'ACTIVE')
    || workflows[0]
    || null
}

export function activeWorkflowsForPurpose(workflows: AiWorkflow[], purpose: string): AiWorkflow[] {
  return workflows.filter(workflow => workflow.status === 'ACTIVE' && workflow.workflow_purpose === purpose)
}

export function readWorkflowEditorSelection(): string {
  try {
    return window.localStorage.getItem(WORKFLOW_EDITOR_SELECTION_KEY) || ''
  } catch {
    return ''
  }
}

export function rememberWorkflowEditorSelection(workflowId: string): void {
  try {
    window.localStorage.setItem(WORKFLOW_EDITOR_SELECTION_KEY, workflowId)
  } catch {
    // Storage can be unavailable in privacy mode. Selection still works for
    // the current session because React retains the selected workflow.
  }
}
