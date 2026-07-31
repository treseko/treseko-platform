import { useState } from 'react'
import { API_BASE } from '../../../app/constants'
import type { TranslationKey } from '../../../i18n'

type UseWorkflowRuntimeTracesParams = {
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

export function useWorkflowRuntimeTraces({
  fetchWithAuth,
  showFeedback,
  t,
}: UseWorkflowRuntimeTracesParams) {
  const [traceExecutionId, setTraceExecutionId] = useState('')
  const [runtimeTraces, setRuntimeTraces] = useState<any[]>([])
  const [workflowRuntimeExpanded, setWorkflowRuntimeExpanded] = useState(false)

  const loadRuntimeTraces = async () => {
    if (!traceExecutionId.trim()) return
    try {
      const response = await fetchWithAuth(`${API_BASE}/ai-engine/executions/${traceExecutionId.trim()}/traces`)
      if (!response.ok) throw new Error(await response.text())
      setRuntimeTraces(await response.json())
    } catch (error: any) {
      showFeedback(t('configuracion.aiTraceabilityTitle'), error?.message || t('configuracion.aiTracesLoadError'), 'danger')
    }
  }

  return {
    traceExecutionId,
    setTraceExecutionId,
    runtimeTraces,
    workflowRuntimeExpanded,
    setWorkflowRuntimeExpanded,
    loadRuntimeTraces,
  }
}
