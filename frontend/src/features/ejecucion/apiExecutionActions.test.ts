import assert from 'node:assert/strict'
import test from 'node:test'
import { executeApiSelection } from './apiExecutionActions'

test('manual API selection closes the selector and opens a pending console', async () => {
  const events: string[] = []
  let run: any = null
  const fetchWithAuth = async () => new Response(JSON.stringify({
    entorno_nombre: 'API QA', dataset_id: 'dataset-1', dataset_nombre: 'Dataset QA',
    variables_resueltas: { customer_name: 'QA' },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  await executeApiSelection({
    mode: 'manual',
    executeNow: false,
    canUseAutomatedExecution: true,
    selectedExecutionEnvironmentId: 'environment-1',
    selectedExecutionDatasetId: 'dataset-1',
    currentProjectId: 'project-1', currentBuildId: 'build-1',
    fetchWithAuth,
    setExecutionLoading: () => undefined,
    setCurrentExecutionRun: value => { run = value },
    setSelectedTest: () => events.push('selected-test'),
    setExecutionMode: mode => events.push(`mode:${mode}`),
    setExecutionModalCaseIds: value => events.push(`modal-cases:${value}`),
    setShowExecSelector: value => events.push(`selector:${value}`),
    setActiveExecutionCaseIds: () => events.push('active-cases'),
    setViewMode: mode => events.push(`view:${mode}`),
  }, [{ id: 'case-1', title: 'Health check' }])

  assert.equal(run.apiExecutionResults.pending, true)
  assert.equal(run.apiExecutionResults.dataset_name, 'Dataset QA')
  assert.equal(run.apiExecutionResults.dataset_previews['case-1'].variables_resueltas.customer_name, 'QA')
  assert.deepEqual(events, [
    'selected-test',
    'mode:manual',
    'modal-cases:null',
    'selector:false',
    'active-cases',
    'view:api_exec',
  ])
})

test('manual API preparation reports an actionable dataset error and does not open the console', async () => {
  let feedback = ''
  let opened = false
  const fetchWithAuth = async () => new Response(JSON.stringify({ detail: 'El dataset no pertenece al ambiente seleccionado' }), { status: 400 })
  await executeApiSelection({
    mode: 'manual', executeNow: false, canUseAutomatedExecution: true,
    selectedExecutionEnvironmentId: 'environment-1', selectedExecutionDatasetId: 'dataset-1',
    currentBuildId: 'build-1', fetchWithAuth,
    setExecutionLoading: () => undefined, setCurrentExecutionRun: () => undefined,
    setSelectedTest: () => undefined, setExecutionMode: () => undefined,
    setExecutionModalCaseIds: () => undefined, setShowExecSelector: () => { opened = true },
    setActiveExecutionCaseIds: () => undefined, setViewMode: () => undefined,
    showFeedback: (_title: string, message: string) => { feedback = message },
  }, [{ id: 'case-1', title: 'Health check' }])

  assert.equal(opened, false)
  assert.match(feedback, /dataset no pertenece/i)
})

test('manual API execution does not require the automated execution permission', async () => {
  let request: any = null
  let feedback = ''
  const fetchWithAuth = async (_url: string, options: RequestInit) => {
    request = JSON.parse(String(options.body))
    return new Response(JSON.stringify({ executions: [{ case_id: 'case-1', status: 'PASO' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  await executeApiSelection({
    mode: 'manual',
    executeNow: true,
    canUseAutomatedExecution: false,
    selectedExecutionEnvironmentId: 'environment-1',
    selectedExecutionDatasetId: 'dataset-1',
    currentProjectId: 'project-1',
    currentBuildId: 'build-1',
    fetchWithAuth,
    setExecutionLoading: () => undefined,
    setCurrentExecutionRun: () => undefined,
    setSelectedTest: () => undefined,
    setExecutionMode: () => undefined,
    setExecutionModalCaseIds: () => undefined,
    setShowExecSelector: () => undefined,
    setActiveExecutionCaseIds: () => undefined,
    setViewMode: () => undefined,
    showFeedback: (_title: string, message: string) => { feedback = message },
  }, [{ id: 'case-1', title: 'Health check' }])

  assert.deepEqual(request, {
    build_id: 'build-1',
    entorno_id: 'environment-1',
    dataset_id: 'dataset-1',
    case_ids: ['case-1'],
    origen: 'MANUAL',
  })
  assert.equal(feedback, '')
})

test('manual API re-execution sends the request even when the console is no longer pending', async () => {
  let request: any = null
  let run: any = null
  const viewModes: string[] = []
  const fetchWithAuth = async (_url: string, options: RequestInit) => {
    request = JSON.parse(String(options.body))
    return new Response(JSON.stringify({ run_id: 'run-2', executions: [{ case_id: 'case-1', status: 'PASO', result: { status: 'PASSED', steps: [] } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  await executeApiSelection({
    mode: 'manual', executeRequest: true, executeNow: false, canUseAutomatedExecution: false,
    selectedExecutionEnvironmentId: 'environment-1', selectedExecutionDatasetId: 'dataset-1',
    currentProjectId: 'project-1', currentBuildId: 'build-1', fetchWithAuth,
    setExecutionLoading: () => undefined, setCurrentExecutionRun: value => { run = value },
    setSelectedTest: () => undefined, setExecutionMode: () => undefined,
    setExecutionModalCaseIds: () => undefined, setShowExecSelector: () => undefined,
    setActiveExecutionCaseIds: () => undefined, setViewMode: value => { viewModes.push(value) },
    showFeedback: () => undefined,
  }, [{ id: 'case-1', title: 'Health check' }])

  assert.deepEqual(request.case_ids, ['case-1'])
  assert.equal(request.origen, 'MANUAL')
  assert.equal(run.apiExecutionResults.pending, false)
  assert.equal(run.apiExecutionResults.run_id, 'run-2')
  assert.deepEqual(viewModes, ['api_exec'])
})

test('automated API execution opens the asynchronous monitor without waiting for all results', async () => {
  let monitor: any = null
  let run: any = null
  const viewModes: string[] = []
  const fetchWithAuth = async (_url: string, options: RequestInit) => {
    assert.equal(JSON.parse(String(options.body)).origen, 'AUTOMATIZADA')
    return new Response(JSON.stringify({
      pending: true,
      run_id: 'run-api-1',
      status: 'PENDING',
      total: 2,
      environment_name: 'API QA',
      dataset_name: 'Dataset QA',
    }), { status: 202, headers: { 'content-type': 'application/json' } })
  }
  const result = await executeApiSelection({
    mode: 'automated', executeRequest: true, canUseAutomatedExecution: true,
    selectedExecutionEnvironmentId: 'environment-1', selectedExecutionDatasetId: 'dataset-1',
    currentProjectId: 'project-1', currentBuildId: 'build-1', fetchWithAuth,
    setExecutionLoading: () => undefined, setCurrentExecutionRun: value => { run = value },
    setAutomationMonitor: value => { monitor = value }, setSelectedTest: () => undefined,
    setExecutionMode: () => undefined, setExecutionModalCaseIds: () => undefined,
    setShowExecSelector: () => undefined, setActiveExecutionCaseIds: () => undefined,
    setViewMode: value => { viewModes.push(value) },
  }, [{ id: 'case-1', title: 'Health check' }, { id: 'case-2', title: 'Products' }])

  assert.equal(result?.pending, true)
  assert.equal(run.apiExecutionResults.pending, true)
  assert.equal(run.apiExecutionResults.run_id, 'run-api-1')
  assert.equal(monitor.show, true)
  assert.equal(monitor.mode, 'api')
  assert.equal(monitor.run.total, 2)
  assert.deepEqual(viewModes, [])
})

test('automated API result opens the completed monitor instead of the manual console', async () => {
  let monitor: any = null
  const viewModes: string[] = []
  const result = await executeApiSelection({
    mode: 'automated', executeRequest: true, canUseAutomatedExecution: true,
    selectedExecutionEnvironmentId: 'environment-1', selectedExecutionDatasetId: 'dataset-1',
    currentProjectId: 'project-1', currentBuildId: 'build-1',
    fetchWithAuth: async () => new Response(JSON.stringify({
      run_id: 'run-api-complete', status: 'PASSED',
      executions: [{ case_id: 'case-1', status: 'PASO', result: { status: 'PASSED' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
    setExecutionLoading: () => undefined, setCurrentExecutionRun: () => undefined,
    setAutomationMonitor: value => { monitor = value }, setSelectedTest: () => undefined,
    setExecutionMode: () => undefined, setExecutionModalCaseIds: () => undefined,
    setShowExecSelector: () => undefined, setActiveExecutionCaseIds: () => undefined,
    setViewMode: value => { viewModes.push(value) },
  }, [{ id: 'case-1', title: 'Health check' }])

  assert.equal(result, undefined)
  assert.equal(monitor.show, true)
  assert.equal(monitor.run.status, 'COMPLETED')
  assert.equal(monitor.run.passed, 1)
  assert.deepEqual(viewModes, [])
})

test('automated API execution reports when no compatible worker is available', async () => {
  let feedback = ''
  const result = await executeApiSelection({
    mode: 'automated', executeRequest: true, canUseAutomatedExecution: true,
    selectedExecutionEnvironmentId: 'environment-1', currentProjectId: 'project-1',
    currentBuildId: 'build-1',
    fetchWithAuth: async () => new Response(JSON.stringify({
      pending: false, status: 'BLOCKED', message: 'No hay un worker API compatible conectado.',
    }), { status: 202, headers: { 'content-type': 'application/json' } }),
    setExecutionLoading: () => undefined, setCurrentExecutionRun: () => undefined,
    setAutomationMonitor: () => undefined, setSelectedTest: () => undefined,
    setExecutionMode: () => undefined, setExecutionModalCaseIds: () => undefined,
    setShowExecSelector: () => undefined, setActiveExecutionCaseIds: () => undefined,
    setViewMode: () => undefined,
    showFeedback: (_title: string, message: string) => { feedback = message },
  }, [{ id: 'case-1', title: 'Health check' }])

  assert.equal(result?.ok, false)
  assert.match(feedback, /worker API compatible/i)
})
