import { useState } from 'react'
import { API_BASE } from '../../../app/constants'

type UseWorkflowRuntimeTracesParams = {
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
}

export function useWorkflowRuntimeTraces({
  fetchWithAuth,
  showFeedback,
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
      showFeedback('Trazabilidad IA', error?.message || 'No se pudieron cargar las trazas.', 'danger')
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
