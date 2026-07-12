import { API_BASE } from '../../app/constants'

export function createExecutionDryRunActions({
  currentProjectId,
  fetchWithAuth,
  setAutomationMonitor,
  setIaLogs,
  showFeedback,
  stringifyFeedbackMessage,
}: any) {
  const handleRunSavedAutomatedCaseFromEditor = async (draft: any = {}) => {
    const script = String(draft.script_automatizado || '')
    if (!script.trim()) {
      showFeedback('Script requerido', 'Agrega un script antes de probar con worker.', 'warning')
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
        throw new Error(stringifyFeedbackMessage(result?.detail || result?.message || `Backend respondio ${response.status}`))
      }
      setAutomationMonitor({
        show: true,
        mode: 'dry-run',
        run: { id: result.id, nombre: 'Prueba temporal con worker' },
        jobs: [{
          jobId: result.id,
          caseCode: result.payload_congelado?.case_code || draft.codigo || 'DRY-RUN',
          caseTitle: result.payload_congelado?.case_title || draft.titulo || 'Prueba temporal del editor',
          status: result.estado
        }]
      })
    } catch (error: any) {
      showFeedback(
        'Prueba temporal',
        stringifyFeedbackMessage(error?.message || error || 'No se pudo enviar la prueba temporal al worker.'),
        'danger'
      )
    }
  }

  const handleRunAiDryRunFromEditor = async (draft: any = {}) => {
    try {
      const response = await fetchWithAuth(`${API_BASE}/ai-engine/dry-run`, {
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
        run: { id: `ai-dry-run-${Date.now()}`, nombre: 'Prueba temporal con IA' },
        jobs: [{
          caseCode: draft.codigo || 'AI-DRY-RUN',
          caseTitle: draft.titulo || 'Prueba temporal con IA',
          status: result.status === 'PASO' ? 'PASSED' : result.status === 'BLOQUEADO' ? 'BLOCKED' : 'FAILED',
          framework: 'ia',
          language: 'agent',
          logs: result.logs || result.observations || result.error_message,
          duration_seconds: result.duration_seconds,
          metadata_resultado: {
            observations: result.observations,
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
        'Dry-run IA',
        stringifyFeedbackMessage(error?.message || error || 'No se pudo ejecutar la prueba temporal con IA.'),
        'danger'
      )
    }
  }

  return {
    handleRunSavedAutomatedCaseFromEditor,
    handleRunAiDryRunFromEditor,
  }
}
