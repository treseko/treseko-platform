import { API_BASE } from '../../app/constants'

export async function executeApiSelection(context: any, tests: any[]) {
  const { mode = 'manual', canUseAutomatedExecution, selectedExecutionEnvironmentId, executionEnvironmentId, executionDatasetPreview, executionRunId, executionTests, currentExecutionRun, setExecutionLoading, managingProjectId, currentProjectId, currentBuildId, selectedExecutionDatasetId, executionDatasetId, fetchWithAuth, setCurrentExecutionRun, setSelectedTest, setExecutionMode, setExecutionModalCaseIds, setShowExecSelector, setActiveExecutionCaseIds, setViewMode, setAutomationMonitor, showFeedback } = context
  const t = typeof context.t === 'function' ? context.t : (key: string) => key
  const notify = typeof showFeedback === 'function' ? showFeedback : () => undefined
  const environmentId = executionEnvironmentId || selectedExecutionEnvironmentId
  const datasetId = executionDatasetId || selectedExecutionDatasetId || null
  if (context.executeRequest === true && tests.length === 0) {
    const error = t('ejecutarPruebas.apiNoSelectedCase')
    notify(t('ejecutarPruebas.apiExecuteError'), error, 'warning')
    return { ok: false, error }
  }
  if (mode === 'automated' && !canUseAutomatedExecution) {
    const error = t('ejecutarPruebas.apiAutomatedPermission')
    notify(t('ejecutarPruebas.manualPermissionRequired'), error, 'warning')
    return { ok: false, error }
  }
  if (!environmentId) {
    const error = t('ejecutarPruebas.apiEnvironmentRequired')
    notify(t('ejecutarPruebas.apiEnvironmentMissing'), error, 'warning')
    return { ok: false, error }
  }
  // Preparing the manual console and sending its request are different user
  // actions. Do not infer the latter from `pending`: after a response exists
  // the console is no longer pending, but "Ejecutar nuevamente" must still
  // send the request directly.
  if (mode === 'manual' && context.executeRequest !== true && context.executeNow !== true) {
    setExecutionLoading(true)
    try {
      const previews: Record<string, any> = {}
      for (const test of tests) {
        const response = await fetchWithAuth(`${API_BASE}/casos/${test.id}/dataset/resolve`, {
          method: 'POST',
          body: JSON.stringify({ build_id: currentBuildId || null, entorno_id: environmentId, dataset_id: datasetId })
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload?.detail?.message || payload?.detail || payload?.message || t('ejecutarPruebas.apiResolveDataFailed', { status: response.status }))
        previews[String(test.id)] = payload
      }
      const projectId = managingProjectId || currentProjectId
      if (!projectId) throw new Error(t('ejecutarPruebas.apiProjectMissing'))
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${projectId}/api-tests/execute`, {
        method: 'POST',
        body: JSON.stringify({ build_id: currentBuildId, entorno_id: environmentId, dataset_id: datasetId, case_ids: tests.map(test => test.id), origen: 'MANUAL', prepare_only: true }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.detail?.message || payload?.detail || payload?.message || t('ejecutarPruebas.apiPrepareRunFailed', { status: response.status }))
      const firstPreview = previews[String(tests[0]?.id)] || executionDatasetPreview || null
      setCurrentExecutionRun({ ...payload, apiExecutionResults: {
        ...payload, pending: true, origin: 'MANUAL', tests, environment_id: environmentId,
        environment_name: payload.environment_name || firstPreview?.entorno_nombre || null,
        dataset_id: payload.dataset_id || datasetId || firstPreview?.dataset_id || null,
        dataset_name: payload.dataset_name || firstPreview?.dataset_nombre || null,
        dataset_preview: firstPreview,
        dataset_previews: { ...(payload.dataset_previews || {}), ...previews },
      } })
    } catch (error: any) {
      notify(t('ejecutarPruebas.apiPrepareDataFailed'), error.message || t('ejecutarPruebas.apiReviewEnvironmentDataset'), 'danger')
      return
    } finally {
      setExecutionLoading(false)
    }
    setSelectedTest(tests[0]); setExecutionMode('manual'); setExecutionModalCaseIds(null); setShowExecSelector(false); setActiveExecutionCaseIds(tests.map(test => test.id)); setViewMode('api_exec')
    return
  }
  setExecutionLoading(true)
  try {
    const projectId = managingProjectId || currentProjectId
    if (!projectId) throw new Error(t('ejecutarPruebas.apiProjectMissing'))
    const response = await fetchWithAuth(`${API_BASE}/proyectos/${projectId}/api-tests/execute`, { method: 'POST', body: JSON.stringify({ build_id: currentBuildId, entorno_id: environmentId, dataset_id: datasetId, case_ids: tests.map(test => test.id), origen: mode === 'automated' ? 'AUTOMATIZADA' : 'MANUAL', ...(mode === 'manual' && executionRunId ? { run_id: executionRunId } : {}) }) })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload?.detail?.message || payload?.detail || payload?.message || t('configuracion.backendResponded', { status: response.status }))
    if (mode === 'automated' && payload?.status === 'BLOCKED') {
      throw new Error(payload?.message || t('ejecutarPruebas.apiNoExecutionResults'))
    }
    if (mode === 'automated' && payload?.pending && payload?.run_id) {
      const monitorRun = {
        ...payload,
        tests,
        environment_id: environmentId,
        dataset_id: datasetId,
        environment_name: payload.environment_name,
        dataset_name: payload.dataset_name,
      }
      setCurrentExecutionRun({ ...currentExecutionRun, ...monitorRun, apiExecutionResults: { ...monitorRun, pending: true, origin: 'AUTOMATIZADA', tests, executions: [] } })
      setAutomationMonitor?.({ show: true, mode: 'api', run: monitorRun, jobs: [] })
      setSelectedTest(tests[0]); setExecutionMode(mode); setExecutionModalCaseIds(null); setShowExecSelector(false); setActiveExecutionCaseIds(tests.map(test => test.id))
      return { ok: true, pending: true, run_id: payload.run_id }
    }
    if (!Array.isArray(payload?.executions) || payload.executions.length === 0) {
      throw new Error(t('ejecutarPruebas.apiNoExecutionResults'))
    }
    const previousResults = currentExecutionRun?.apiExecutionResults?.executions || currentExecutionRun?.executions || []
    const mergedResults = [...previousResults.filter((item: any) => !payload.executions?.some((next: any) => String(next.case_id) === String(item.case_id))), ...(payload.executions || [])]
    const consoleTests = executionTests?.length ? executionTests : tests
    setCurrentExecutionRun({ ...currentExecutionRun, ...payload, apiExecutionResults: { ...currentExecutionRun?.apiExecutionResults, ...payload, pending: false, origin: mode === 'automated' ? 'AUTOMATIZADA' : 'MANUAL', executions: mergedResults, tests: consoleTests, environment_id: environmentId, dataset_id: datasetId, dataset_preview: context.executionDatasetPreview || currentExecutionRun?.apiExecutionResults?.dataset_preview || null } })
    if (mode === 'automated') {
      const monitorExecutions = (payload.executions || []).map((item: any) => ({
        ...item,
        status: String(item.status || item.result?.status || '').toUpperCase() === 'PASO' ? 'PASSED' : String(item.status || item.result?.status || '').toUpperCase() === 'FALLO' ? 'FAILED' : String(item.status || item.result?.status || '').toUpperCase(),
      }))
      const monitorRun = {
        ...payload,
        run_id: payload.run_id || payload.id,
        tests: consoleTests,
        executions: monitorExecutions,
        total: payload.total ?? monitorExecutions.length,
        passed: payload.passed ?? monitorExecutions.filter((item: any) => item.status === 'PASSED').length,
        failed: payload.failed ?? monitorExecutions.filter((item: any) => item.status === 'FAILED').length,
        blocked: payload.blocked ?? monitorExecutions.filter((item: any) => item.status === 'BLOCKED').length,
        errors: payload.errors ?? monitorExecutions.filter((item: any) => item.status === 'ERROR').length,
        status: 'COMPLETED',
        pending: false,
        environment_id: environmentId,
        dataset_id: datasetId,
      }
      setAutomationMonitor?.({ show: true, mode: 'api', run: monitorRun, jobs: [] })
    }
    setSelectedTest(tests[0]); setExecutionMode(mode); setExecutionModalCaseIds(null); setShowExecSelector(false); setActiveExecutionCaseIds(tests.map(test => test.id))
    if (mode === 'manual') setViewMode('api_exec')
  } catch (error: any) {
    notify(t('ejecutarPruebas.apiExecutionFailed'), error.message || t('ejecutarPruebas.apiExecuteError'), 'danger')
    return { ok: false, error: error.message || t('ejecutarPruebas.apiExecuteError') }
  } finally { setExecutionLoading(false) }
}
