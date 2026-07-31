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
import { useI18n } from '../../../i18n'

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
  const { t } = useI18n()
  const saveWorkflowDraft = async () => {
    if (!workflowDraft) return false
    setWorkflowLoading(true)
    try {
      const saved = await updateAiWorkflow(fetchWithAuth, workflowDraft)
      setWorkflowDraft(saved)
      setAiWorkflows(prev => prev.map(item => item.id === saved.id ? saved : item))
      syncFlowFromWorkflow(saved)
      await loadWorkflowVersions(saved.id)
      showFeedback(t('configuracion.workflowTitle'), t('configuracion.workflowDraftSaved'), 'success')
      return true
    } catch (error: any) {
      showFeedback(t('configuracion.workflowTitle'), error?.message || t('configuracion.workflowSaveError'), 'danger')
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
      showFeedback(t('configuracion.workflowTitle'), error?.message || t('configuracion.workflowCreateError'), 'danger')
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
      showFeedback(t('configuracion.workflowTitle'), error?.message || t('configuracion.workflowActionError'), 'danger')
    }
  }

  const copyWorkflowAsBlocks = async () => {
    if (!workflowDraft) return
    try {
      const created = await copyAiWorkflowAsBlocks(fetchWithAuth, workflowDraft.id)
      setAiWorkflows(prev => [created, ...prev])
      selectWorkflow(created)
      showFeedback(t('configuracion.workflowBlocksTitle'), t('configuracion.workflowBlocksCreated'), 'success')
    } catch (error: any) {
      showFeedback(t('configuracion.workflowBlocksTitle'), error?.message || t('configuracion.workflowBlocksError'), 'danger')
    }
  }

  const copyWorkflowAsUniversal = async () => {
    if (!workflowDraft) return
    try {
      const created = await copyAiWorkflowAsUniversal(fetchWithAuth, workflowDraft.id)
      setAiWorkflows(prev => [created, ...prev])
      selectWorkflow(created)
      showFeedback(t('configuracion.workflowUniversalTitle'), t('configuracion.workflowUniversalCreated'), 'success')
    } catch (error: any) {
      showFeedback(t('configuracion.workflowUniversalTitle'), error?.message || t('configuracion.workflowUniversalError'), 'danger')
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
      showFeedback(t('configuracion.workflowPortableTitle'), error?.message || t('configuracion.workflowExportError'), 'danger')
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
      showFeedback(t('configuracion.workflowPortableTitle'), t('configuracion.workflowImported'), 'success')
    } catch (error: any) {
      showFeedback(t('configuracion.workflowPortableTitle'), error?.message || t('configuracion.workflowImportError'), 'danger')
    }
  }

  const createUniversalAgent = async (payload: Record<string, any>) => {
    try {
      const created = await createAiUniversalAgent(fetchWithAuth, payload)
      await loadAgentPresets()
      showFeedback(t('configuracion.universalAgentTitle'), t('configuracion.universalAgentCreated', { name: created.name }), 'success')
      return created
    } catch (error: any) {
      showFeedback(t('configuracion.universalAgentTitle'), error?.message || t('configuracion.universalAgentError'), 'danger')
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
