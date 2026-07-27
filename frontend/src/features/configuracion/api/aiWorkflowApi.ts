import { API_BASE } from '../../../app/constants'
import type { AiAgentPreset, AiWorkflow } from '../types/configuracion'
import type { FetchWithAuth } from './configuracionApi'

async function readJsonOrTextError(response: Response) {
  if (response.ok) return response.json()
  throw new Error(await response.text())
}

export async function fetchAiWorkflows(fetchWithAuth: FetchWithAuth) {
  const response = await fetchWithAuth(`${API_BASE}/ai-workflows/`)
  return readJsonOrTextError(response)
}

export async function fetchWorkflowVersions(fetchWithAuth: FetchWithAuth, workflowId: string) {
  const response = await fetchWithAuth(`${API_BASE}/ai-workflows/${workflowId}/versions`)
  return readJsonOrTextError(response)
}

export async function fetchAiAgentPresets(fetchWithAuth: FetchWithAuth) {
  const response = await fetchWithAuth(`${API_BASE}/ai-agent-presets/`)
  return readJsonOrTextError(response)
}

export async function fetchAiAgentDefinitions(fetchWithAuth: FetchWithAuth) {
  const response = await fetchWithAuth(`${API_BASE}/ai-agent-definitions/`)
  return readJsonOrTextError(response)
}

export async function fetchAiUniversalAgents(fetchWithAuth: FetchWithAuth) {
  const response = await fetchWithAuth(`${API_BASE}/ai-universal-agents/`)
  return readJsonOrTextError(response)
}

export async function createAiUniversalAgent(fetchWithAuth: FetchWithAuth, payload: Record<string, any>) {
  const response = await fetchWithAuth(`${API_BASE}/ai-universal-agents/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return readJsonOrTextError(response)
}

export async function updateAiWorkflow(fetchWithAuth: FetchWithAuth, workflow: AiWorkflow) {
  const response = await fetchWithAuth(`${API_BASE}/ai-workflows/${workflow.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: workflow.name,
      version: Number(workflow.version || 1),
      status: workflow.status,
      is_default: Boolean(workflow.is_default),
      workflow_format: workflow.workflow_format || 'legacy_v1',
      nodes: workflow.nodes,
      edges: workflow.edges,
    }),
  })
  return readJsonOrTextError(response)
}

export async function publishAiWorkflowVersion(fetchWithAuth: FetchWithAuth, workflowId: string, changelog: string) {
  const response = await fetchWithAuth(`${API_BASE}/ai-workflows/${workflowId}/versions`, {
    method: 'POST',
    body: JSON.stringify({ changelog }),
  })
  return readJsonOrTextError(response)
}

export async function validateAiWorkflow(fetchWithAuth: FetchWithAuth, workflowId: string) {
  const response = await fetchWithAuth(`${API_BASE}/ai-workflows/${workflowId}/validate`, { method: 'POST' })
  return readJsonOrTextError(response)
}

export async function activateAiWorkflowVersion(fetchWithAuth: FetchWithAuth, workflowId: string, version: number, confirmRunning = false) {
  const response = await fetchWithAuth(`${API_BASE}/ai-workflows/${workflowId}/versions/${version}/activate`, {
    method: 'POST',
    body: JSON.stringify({ confirm_running: confirmRunning }),
  })
  return readJsonOrTextError(response)
}

export async function rollbackAiWorkflowVersion(fetchWithAuth: FetchWithAuth, workflowId: string, version: number) {
  const response = await fetchWithAuth(`${API_BASE}/ai-workflows/${workflowId}/versions/${version}/rollback`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  return readJsonOrTextError(response)
}

export async function addAiWorkflowPresetNode(
  fetchWithAuth: FetchWithAuth,
  workflowId: string,
  preset: AiAgentPreset,
  sourceNodeId?: string | null,
  position?: { x: number; y: number },
) {
  const response = await fetchWithAuth(`${API_BASE}/ai-workflows/${workflowId}/nodes/from-preset`, {
    method: 'POST',
  body: JSON.stringify({
      ...(preset.universal_agent_version_id
        ? { universal_agent_version_id: preset.universal_agent_version_id }
        : preset.agent_definition_id ? { agent_definition_id: preset.agent_definition_id } : { preset_id: preset.id }),
      position_x: Math.round(position?.x ?? 160),
      position_y: Math.round(position?.y ?? 260),
      source_node_id: sourceNodeId || null,
      condition_type: 'always',
    }),
  })
  return readJsonOrTextError(response)
}

export async function createAiWorkflow(fetchWithAuth: FetchWithAuth, payload: Partial<AiWorkflow>) {
  const response = await fetchWithAuth(`${API_BASE}/ai-workflows/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return readJsonOrTextError(response)
}

export async function postAiWorkflowAction(fetchWithAuth: FetchWithAuth, workflowId: string, action: 'duplicate' | 'archive' | 'restore-default') {
  const response = await fetchWithAuth(`${API_BASE}/ai-workflows/${workflowId}/${action}`, { method: 'POST' })
  return readJsonOrTextError(response)
}

export async function copyAiWorkflowAsBlocks(fetchWithAuth: FetchWithAuth, workflowId: string) {
  const response = await fetchWithAuth(`${API_BASE}/ai-workflows/${workflowId}/copy-as-blocks`, { method: 'POST' })
  return readJsonOrTextError(response)
}

export async function copyAiWorkflowAsUniversal(fetchWithAuth: FetchWithAuth, workflowId: string) {
  const response = await fetchWithAuth(`${API_BASE}/ai-workflows/${workflowId}/copy-as-universal`, { method: 'POST' })
  return readJsonOrTextError(response)
}

export async function exportAiWorkflow(fetchWithAuth: FetchWithAuth, workflowId: string) {
  const response = await fetchWithAuth(`${API_BASE}/ai-workflows/${workflowId}/export`)
  return readJsonOrTextError(response)
}

export async function importAiWorkflow(fetchWithAuth: FetchWithAuth, payload: any) {
  const response = await fetchWithAuth(`${API_BASE}/ai-workflows/import`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return readJsonOrTextError(response)
}

export async function exportAiUniversalWorkflowPackage(fetchWithAuth: FetchWithAuth, workflowId: string) {
  const response = await fetchWithAuth(`${API_BASE}/ai-workflows/${workflowId}/export-universal-package`)
  return readJsonOrTextError(response)
}

export async function importAiUniversalWorkflowPackage(fetchWithAuth: FetchWithAuth, packageBase64: string) {
  const response = await fetchWithAuth(`${API_BASE}/ai-workflows/import-universal-package`, {
    method: 'POST',
    body: JSON.stringify({ package_base64: packageBase64 }),
  })
  return readJsonOrTextError(response)
}
