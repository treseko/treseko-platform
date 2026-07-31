import { API_BASE } from '../../app/constants'

export function createExecutionDryRunActions({
  currentProjectId,
  fetchWithAuth,
  setAutomationMonitor,
  aiDryRunInFlightRef,
  setAiDryRunRunning,
  setIaLogs,
  showFeedback,
  stringifyFeedbackMessage,
  t,
}: any) {
  const handleRunSavedAutomatedCaseFromEditor = async (draft: any = {}) => {
    const script = String(draft.script_automatizado || '')
    if (!script.trim()) {
      showFeedback(t('ejecutarPruebas.dryRunScriptRequired'), t('ejecutarPruebas.dryRunScriptRequiredMessage'), 'warning')
      return
    }
    try {
      const response = await fetchWithAuth(`${API_BASE}/automation-jobs/dry-run`, {
        method: 'POST',
        body: JSON.stringify({
          script_automatizado: script,
          framework: draft.framework || 'playwright',
          lenguaje: draft.lenguaje || 'javascript',
          proyecto_id: draft.proyecto_id || currentProjectId,
          componente_id: draft.componente_id || null,
          titulo: draft.titulo || 'Prueba temporal del editor',
          codigo: draft.codigo || 'DRY-RUN',
          datos_caso: draft.datos_caso || '',
          entorno_id: draft.entorno_id || null,
          dataset_id: draft.dataset_id || null,
          debug_mode: Boolean(draft.debug_mode),
          pasos: Array.isArray(draft.pasos) ? draft.pasos : []
        })
      })
      const result = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(stringifyFeedbackMessage(result?.detail || result?.message || t('configuracion.backendResponded', { status: response.status })))
      }
      setAutomationMonitor({
        show: true,
        mode: 'dry-run',
        run: { id: result.id, nombre: t('ejecutarPruebas.dryRunWorkerName') },
        jobs: [{
          jobId: result.id,
          caseCode: result.payload_congelado?.case_code || draft.codigo || 'DRY-RUN',
          caseTitle: result.payload_congelado?.case_title || draft.titulo || t('ejecutarPruebas.dryRunEditorName'),
          status: result.estado
        }]
      })
    } catch (error: any) {
      showFeedback(
        t('ejecutarPruebas.dryRunTitle'),
        stringifyFeedbackMessage(error?.message || error || t('ejecutarPruebas.dryRunWorkerError')),
        'danger'
      )
    }
  }

  const handleRunAiDryRunFromEditor = async (draft: any = {}) => {
    if (aiDryRunInFlightRef?.current) return
    if (aiDryRunInFlightRef) aiDryRunInFlightRef.current = true
    setAiDryRunRunning?.(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/ai-engine/dry-run/start`, {
        method: 'POST',
        body: JSON.stringify({
          proyecto_id: draft.proyecto_id || currentProjectId,
          componente_id: draft.componente_id || null,
          titulo: draft.titulo || 'Prueba temporal con IA',
          codigo: draft.codigo || 'AI-DRY-RUN',
          descripcion: draft.descripcion || '',
          precondiciones: draft.precondiciones || '',
          postcondiciones: draft.postcondiciones || '',
          datos_caso: draft.datos_caso || '',
          entorno_id: draft.entorno_id || null,
          dataset_id: draft.dataset_id || null,
          debug_mode: Boolean(draft.debug_mode),
          pasos: Array.isArray(draft.pasos) ? draft.pasos : []
        })
      })
      const result = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(stringifyFeedbackMessage(result?.detail || result?.message || `Backend respondio ${response.status}`))
      }
      setAutomationMonitor({
        show: true,
        mode: 'dry-run',
        run: { id: result.run_id, nombre: t('ejecutarPruebas.dryRunAiName') },
        jobs: [{
          jobId: result.run_id,
          progressRunId: result.run_id,
          caseCode: draft.codigo || 'AI-DRY-RUN',
          caseTitle: draft.titulo || t('ejecutarPruebas.dryRunAiName'),
          caseSteps: Array.isArray(draft.pasos) ? draft.pasos : [],
          status: 'RUNNING',
          framework: 'ia',
          language: 'agent',
          logs: t('ejecutarPruebas.dryRunConnectingAi'),
          metadata_resultado: {
            observations: result.observations,
            error_message: result.error_message,
            provider: result.metadata?.provider,
            model: result.metadata?.model,
            ai_report: result.ai_report || {},
            steps: result.steps || [],
            artifacts: result.final_screenshot_base64 ? [{
              type: 'screenshot',
              filename: 'ai-dry-run-final.png',
              content_type: 'image/png',
              base64: result.final_screenshot_base64
            }] : []
          }
        }]
      })
      setIaLogs((prev: any[]) => [...prev, {
        ts: new Date().toISOString(),
        level: 'run',
        source: 'DRY-RUN IA',
        message: `${draft.titulo || 'Prueba temporal'} -> ${result.status}`
      }])
    } catch (error: any) {
      showFeedback(
        t('ejecutarPruebas.dryRunAiTitle'),
        stringifyFeedbackMessage(error?.message || error || t('ejecutarPruebas.dryRunAiError')),
        'danger'
      )
    } finally {
      if (aiDryRunInFlightRef) aiDryRunInFlightRef.current = false
      setAiDryRunRunning?.(false)
    }
  }

  return {
    handleRunSavedAutomatedCaseFromEditor,
    handleRunAiDryRunFromEditor,
  }
}
