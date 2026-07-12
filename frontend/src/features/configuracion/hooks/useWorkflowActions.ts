import {
  addAiWorkflowPresetNode,
  createAiWorkflow,
  exportAiWorkflow,
  importAiWorkflow,
  postAiWorkflowAction,
  updateAiWorkflow,
} from '../api/aiWorkflowApi'
import { createWorkflowDraftFromSource } from '../mappers/workflowFlowMappers'
import type { AiAgentPreset, AiWorkflow, AiWorkflowNode } from '../types/configuracion'
import type { FetchWithAuth } from '../api/configuracionApi'
import type { Dispatch, SetStateAction } from 'react'

type UseWorkflowActionsParams = {
  fetchWithAuth: FetchWithAuth
  workflowDraft: AiWorkflow | null
  aiWorkflows: AiWorkflow[]
  selectedWorkflowNode: AiWorkflowNode | null
  canEditAi: boolean
  onOpenIaScheduler?: () => void
  setWorkflowDraft: (workflow: AiWorkflow) => void
  setAiWorkflows: Dispatch<SetStateAction<AiWorkflow[]>>
  setWorkflowLoading: (loading: boolean) => void
  syncFlowFromWorkflow: (workflow: AiWorkflow | null) => void
  loadWorkflowVersions: (workflowId: string) => Promise<void>
  loadAiWorkflows: () => Promise<void>
  selectWorkflow: (workflow: AiWorkflow) => void
  refitWorkflow: (reason: string) => void
  showFeedback: (title: string, message: string, variant?: string) => void
}

export function useWorkflowActions({
  fetchWithAuth,
  workflowDraft,
  aiWorkflows,
  selectedWorkflowNode,
  canEditAi,
  onOpenIaScheduler,
  setWorkflowDraft,
  setAiWorkflows,
  setWorkflowLoading,
  syncFlowFromWorkflow,
  loadWorkflowVersions,
  loadAiWorkflows,
  selectWorkflow,
  refitWorkflow,
  showFeedback,
}: UseWorkflowActionsParams) {
  const saveWorkflowDraft = async () => {
    if (!workflowDraft) return false
    setWorkflowLoading(true)
    try {
      const saved = await updateAiWorkflow(fetchWithAuth, workflowDraft)
      setWorkflowDraft(saved)
      setAiWorkflows(prev => prev.map(item => item.id === saved.id ? saved : item))
      syncFlowFromWorkflow(saved)
      await loadWorkflowVersions(saved.id)
      showFeedback('Workflow IA', 'Draft guardado sin publicar version.', 'success')
      return true
    } catch (error: any) {
      showFeedback('Workflow IA', error?.message || 'No se pudo guardar el workflow.', 'danger')
      return false
    } finally {
      setWorkflowLoading(false)
    }
  }

  const executeCurrentWorkflow = async () => {
    if (!onOpenIaScheduler) return
    if (canEditAi && workflowDraft) {
      const saved = await saveWorkflowDraft()
      if (!saved) return
    }
    onOpenIaScheduler()
  }

  const addPresetToWorkflow = async (preset: AiAgentPreset) => {
    if (!workflowDraft) return
    try {
      const saved = await addAiWorkflowPresetNode(fetchWithAuth, workflowDraft.id, preset, selectedWorkflowNode?.id || null)
      setWorkflowDraft(saved)
      setAiWorkflows(prev => prev.map(item => item.id === saved.id ? saved : item))
      syncFlowFromWorkflow(saved)
      await loadWorkflowVersions(saved.id)
    } catch (error: any) {
      showFeedback('Presets IA', error?.message || 'No se pudo insertar el preset.', 'danger')
    }
  }

  const createWorkflow = async () => {
    const source = workflowDraft || aiWorkflows[0]
    try {
      const created = await createAiWorkflow(fetchWithAuth, createWorkflowDraftFromSource(source))
      setAiWorkflows(prev => [created, ...prev])
      selectWorkflow(created)
    } catch (error: any) {
      showFeedback('Workflow IA', error?.message || 'No se pudo crear el workflow.', 'danger')
    }
  }

  const postWorkflowAction = async (action: 'duplicate' | 'archive' | 'restore-default') => {
    if (!workflowDraft) return
    try {
      const saved = await postAiWorkflowAction(fetchWithAuth, workflowDraft.id, action)
      await loadAiWorkflows()
      setWorkflowDraft(saved)
      syncFlowFromWorkflow(saved)
    } catch (error: any) {
      showFeedback('Workflow IA', error?.message || 'No se pudo ejecutar la accion.', 'danger')
    }
  }

  const exportWorkflow = async () => {
    if (!workflowDraft) return
    const payload = await exportAiWorkflow(fetchWithAuth, workflowDraft.id)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${workflowDraft.name.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase()}-workflow.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const importWorkflow = async (file?: File) => {
    if (!file) return
    try {
      const payload = JSON.parse(await file.text())
      const imported = await importAiWorkflow(fetchWithAuth, payload)
      setAiWorkflows(prev => [imported, ...prev])
      selectWorkflow(imported)
      refitWorkflow('import workflow')
    } catch (error: any) {
      showFeedback('Workflow IA', error?.message || 'JSON de workflow invalido.', 'danger')
    }
  }

  return {
    saveWorkflowDraft,
    executeCurrentWorkflow,
    addPresetToWorkflow,
    createWorkflow,
    postWorkflowAction,
    exportWorkflow,
    importWorkflow,
  }
}
