import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  activateAiWorkflowVersion,
  fetchWorkflowVersions,
  publishAiWorkflowVersion,
  rollbackAiWorkflowVersion,
} from '../api/aiWorkflowApi'
import type { AiWorkflow, AiWorkflowVersion } from '../types/configuracion'
import type { FetchWithAuth } from '../api/configuracionApi'

type UseWorkflowVersionsParams = {
  fetchWithAuth: FetchWithAuth
  workflowDraft: AiWorkflow | null
  setWorkflowDraft: (workflow: AiWorkflow) => void
  setAiWorkflows: Dispatch<SetStateAction<AiWorkflow[]>>
  setWorkflowLoading: (loading: boolean) => void
  setWorkflowJsonError: (error: string) => void
  syncFlowFromWorkflow: (workflow: AiWorkflow | null) => void
  loadAiWorkflows: () => Promise<void>
  showFeedback: (title: string, message: string, variant?: string) => void
}

export function useWorkflowVersions({
  fetchWithAuth,
  workflowDraft,
  setWorkflowDraft,
  setAiWorkflows,
  setWorkflowLoading,
  setWorkflowJsonError,
  syncFlowFromWorkflow,
  loadAiWorkflows,
  showFeedback,
}: UseWorkflowVersionsParams) {
  const [workflowChangelog, setWorkflowChangelog] = useState('')
  const [workflowVersions, setWorkflowVersions] = useState<AiWorkflowVersion[]>([])
  const [selectedWorkflowVersion, setSelectedWorkflowVersion] = useState<AiWorkflowVersion | null>(null)

  const loadWorkflowVersions = async (workflowId: string) => {
    try {
      const versions = await fetchWorkflowVersions(fetchWithAuth, workflowId)
      setWorkflowVersions(versions)
      setSelectedWorkflowVersion(versions[0] || null)
    } catch {
      setWorkflowVersions([])
      setSelectedWorkflowVersion(null)
    }
  }

  const publishWorkflowVersion = async () => {
    if (!workflowDraft) return
    if (!workflowChangelog.trim()) {
      setWorkflowJsonError('El changelog es obligatorio para publicar una version.')
      return
    }
    setWorkflowLoading(true)
    try {
      await publishAiWorkflowVersion(fetchWithAuth, workflowDraft.id, workflowChangelog.trim())
      setWorkflowChangelog('')
      await loadAiWorkflows()
      await loadWorkflowVersions(workflowDraft.id)
      showFeedback('Workflow IA', 'Version publicada.', 'success')
    } catch (error: any) {
      showFeedback('Workflow IA', error?.message || 'No se pudo publicar la version.', 'danger')
    } finally {
      setWorkflowLoading(false)
    }
  }

  const activateWorkflowVersion = async (version: AiWorkflowVersion) => {
    if (!workflowDraft) return
    try {
      const saved = await activateAiWorkflowVersion(fetchWithAuth, workflowDraft.id, version.version)
      setWorkflowDraft(saved)
      syncFlowFromWorkflow(saved)
      await loadAiWorkflows()
      showFeedback('Workflow IA', `Version ${version.version} activada.`, 'success')
    } catch (error: any) {
      showFeedback('Workflow IA', error?.message || 'No se pudo activar la version.', 'danger')
    }
  }

  const rollbackWorkflow = async (version: AiWorkflowVersion) => {
    if (!workflowDraft) return
    try {
      const saved = await rollbackAiWorkflowVersion(fetchWithAuth, workflowDraft.id, version.version)
      setWorkflowDraft(saved)
      setAiWorkflows(prev => prev.map(item => item.id === saved.id ? saved : item))
      syncFlowFromWorkflow(saved)
      setWorkflowChangelog('')
      await loadWorkflowVersions(saved.id)
      await loadAiWorkflows()
      showFeedback('Workflow IA', `Version ${version.version} restaurada como draft.`, 'success')
    } catch (error: any) {
      showFeedback('Workflow IA', error?.message || 'No se pudo aplicar rollback.', 'danger')
    }
  }

  return {
    workflowChangelog,
    setWorkflowChangelog,
    workflowVersions,
    selectedWorkflowVersion,
    loadWorkflowVersions,
    publishWorkflowVersion,
    activateWorkflowVersion,
    rollbackWorkflow,
  }
}
