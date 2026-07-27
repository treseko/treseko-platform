import {
  createAiWorkflow,
  copyAiWorkflowAsBlocks,
  copyAiWorkflowAsUniversal,
  createAiUniversalAgent,
  exportAiUniversalWorkflowPackage,
  importAiUniversalWorkflowPackage,
  postAiWorkflowAction,
  updateAiWorkflow,
} from '../api/aiWorkflowApi'
import { createWorkflowDraftFromSource } from '../mappers/workflowFlowMappers'
import type { AiAgentPreset, AiWorkflow } from '../types/configuracion'
import type { FetchWithAuth } from '../api/configuracionApi'
import type { Dispatch, SetStateAction } from 'react'

type UseWorkflowActionsParams = {
  fetchWithAuth: FetchWithAuth
  workflowDraft: AiWorkflow | null
  aiWorkflows: AiWorkflow[]
  canEditAi: boolean
  onOpenIaScheduler?: () => void
  setWorkflowDraft: (workflow: AiWorkflow) => void
  setAiWorkflows: Dispatch<SetStateAction<AiWorkflow[]>>
  setWorkflowLoading: (loading: boolean) => void
  syncFlowFromWorkflow: (workflow: AiWorkflow | null, options?: { forceLayout?: boolean; manual?: boolean; persistPositions?: boolean; autoLayout?: boolean; reason?: string }) => void
  enqueueInsert: (preset: AiAgentPreset, position: { x: number; y: number }) => boolean
  loadWorkflowVersions: (workflowId: string) => Promise<void>
  loadAiWorkflows: () => Promise<void>
  loadAgentPresets: () => Promise<void>
  selectWorkflow: (workflow: AiWorkflow) => void
  showFeedback: (title: string, message: string, variant?: string) => void
}

export function useWorkflowActions({
  fetchWithAuth,
  workflowDraft,
  aiWorkflows,
  canEditAi,
  onOpenIaScheduler,
  setWorkflowDraft,
  setAiWorkflows,
  setWorkflowLoading,
  syncFlowFromWorkflow,
  enqueueInsert,
  loadWorkflowVersions,
  loadAiWorkflows,
  loadAgentPresets,
  selectWorkflow,
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

  const addPresetToWorkflow = async (preset: AiAgentPreset, position?: { x: number; y: number }): Promise<boolean> => {
    if (!workflowDraft || !position) return false
    return enqueueInsert(preset, position)
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

  const copyWorkflowAsBlocks = async () => {
    if (!workflowDraft) return
    try {
      const created = await copyAiWorkflowAsBlocks(fetchWithAuth, workflowDraft.id)
      setAiWorkflows(prev => [created, ...prev])
      selectWorkflow(created)
      showFeedback('Workflow por bloques', 'Se creó un borrador V2. El workflow clásico original no fue modificado.', 'success')
    } catch (error: any) {
      showFeedback('Workflow por bloques', error?.message || 'No se pudo crear la copia por bloques.', 'danger')
    }
  }

  const copyWorkflowAsUniversal = async () => {
    if (!workflowDraft) return
    try {
      const created = await copyAiWorkflowAsUniversal(fetchWithAuth, workflowDraft.id)
      setAiWorkflows(prev => [created, ...prev])
      selectWorkflow(created)
      showFeedback('Workflow universal', 'Se creó una copia universal. El workflow original no fue modificado.', 'success')
    } catch (error: any) {
      showFeedback('Workflow universal', error?.message || 'No se pudo crear la copia universal.', 'danger')
    }
  }

  const exportUniversalWorkflow = async () => {
    if (!workflowDraft) return
    try {
      const payload = await exportAiUniversalWorkflowPackage(fetchWithAuth, workflowDraft.id)
      const binary = atob(String(payload.package_base64 || ''))
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
      const link = document.createElement('a')
      link.href = url
      link.download = payload.filename || 'workflow.treseko-workflow.zip'
      link.click()
      URL.revokeObjectURL(url)
    } catch (error: any) {
      showFeedback('Workflow portable', error?.message || 'No se pudo exportar el workflow portable.', 'danger')
    }
  }

  const importUniversalWorkflow = async (file?: File) => {
    if (!file) return
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
      const imported = await importAiUniversalWorkflowPackage(fetchWithAuth, btoa(binary))
      setAiWorkflows(prev => [imported, ...prev])
      selectWorkflow(imported)
      showFeedback('Workflow portable', 'El workflow fue importado como borrador independiente.', 'success')
    } catch (error: any) {
      showFeedback('Workflow portable', error?.message || 'El archivo portable no es válido.', 'danger')
    }
  }

  const createUniversalAgent = async (payload: Record<string, any>) => {
    try {
      const created = await createAiUniversalAgent(fetchWithAuth, payload)
      await loadAgentPresets()
      showFeedback('Agente universal', `Se creó ${created.name} como borrador. Podés insertarlo en un workflow universal.`, 'success')
      return created
    } catch (error: any) {
      showFeedback('Agente universal', error?.message || 'No se pudo crear el agente.', 'danger')
      throw error
    }
  }

  return {
    saveWorkflowDraft,
    executeCurrentWorkflow,
    addPresetToWorkflow,
    createWorkflow,
    postWorkflowAction,
    copyWorkflowAsBlocks,
    copyWorkflowAsUniversal,
    exportUniversalWorkflow,
    importUniversalWorkflow,
    createUniversalAgent,
  }
}
