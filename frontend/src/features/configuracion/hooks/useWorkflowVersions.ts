import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  activateAiWorkflowVersion,
  fetchWorkflowVersions,
  publishAiWorkflowVersion,
  rollbackAiWorkflowVersion,
  validateAiWorkflow,
} from '../api/aiWorkflowApi'
import type { AiWorkflow, AiWorkflowVersion } from '../types/configuracion'
import type { FetchWithAuth } from '../api/configuracionApi'
import type { TranslationKey } from '../../../i18n'

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
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
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
  t,
}: UseWorkflowVersionsParams) {
  const [workflowChangelog, setWorkflowChangelog] = useState('')
  const [workflowVersions, setWorkflowVersions] = useState<AiWorkflowVersion[]>([])
  const [selectedWorkflowVersion, setSelectedWorkflowVersion] = useState<AiWorkflowVersion | null>(null)
  const [workflowValidationIssues, setWorkflowValidationIssues] = useState<any[]>([])

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
      setWorkflowJsonError(t('configuracion.workflowChangelogRequired'))
      return
    }
    setWorkflowLoading(true)
    try {
      await publishAiWorkflowVersion(fetchWithAuth, workflowDraft.id, workflowChangelog.trim())
      setWorkflowChangelog('')
      await loadAiWorkflows()
      await loadWorkflowVersions(workflowDraft.id)
      showFeedback(t('configuracion.workflowTitle'), t('configuracion.workflowVersionPublished'), 'success')
    } catch (error: any) {
      showFeedback(t('configuracion.workflowTitle'), error?.message || t('configuracion.workflowPublishError'), 'danger')
    } finally {
      setWorkflowLoading(false)
    }
  }

  const validateWorkflow = async () => {
    if (!workflowDraft) return false
    setWorkflowLoading(true)
    try {
      const result = await validateAiWorkflow(fetchWithAuth, workflowDraft.id)
      const issues = Array.isArray(result?.issues) ? result.issues : []
      setWorkflowValidationIssues(issues)
      if (result?.valid) showFeedback(t('configuracion.workflowTitle'), issues.length ? t('configuracion.workflowValidWarnings') : t('configuracion.workflowValid'), issues.length ? 'warning' : 'success')
      else showFeedback(t('configuracion.workflowTitle'), t('configuracion.workflowBlockingErrors'), 'danger')
      return Boolean(result?.valid)
    } catch (error: any) {
      showFeedback(t('configuracion.workflowTitle'), error?.message || t('configuracion.workflowValidationError'), 'danger')
      return false
    } finally {
      setWorkflowLoading(false)
    }
  }

  const activateWorkflowVersion = async (version: AiWorkflowVersion) => {
    if (!workflowDraft) return
    try {
      const confirmRunning = window.confirm(t('configuracion.workflowActivateConfirm', { version: version.version }))
      if (!confirmRunning) return
      const saved = await activateAiWorkflowVersion(fetchWithAuth, workflowDraft.id, version.version, true)
      setWorkflowDraft(saved)
      syncFlowFromWorkflow(saved)
      await loadAiWorkflows()
      showFeedback(t('configuracion.workflowTitle'), t('configuracion.workflowVersionActivated', { version: version.version }), 'success')
    } catch (error: any) {
      showFeedback(t('configuracion.workflowTitle'), error?.message || t('configuracion.workflowActivateError'), 'danger')
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
      showFeedback(t('configuracion.workflowTitle'), t('configuracion.workflowVersionRestored', { version: version.version }), 'success')
    } catch (error: any) {
      showFeedback(t('configuracion.workflowTitle'), error?.message || t('configuracion.workflowRollbackError'), 'danger')
    }
  }

  return {
    workflowChangelog,
    setWorkflowChangelog,
    workflowVersions,
    selectedWorkflowVersion,
    workflowValidationIssues,
    loadWorkflowVersions,
    publishWorkflowVersion,
    validateWorkflow,
    activateWorkflowVersion,
    rollbackWorkflow,
  }
}
