export const getStatusColor = (status: string) => {
  switch (status?.toLowerCase()) {
    case 'passed': case 'ok': case 'paso': return 'success'
    case 'failed': case 'fallido': case 'fallo': return 'danger'
    case 'blocked': case 'bloqueado': return 'primary'
    case 'skipped': return 'warning'
    case 'ejecutando_ai': return 'info'
    default: return 'secondary'
  }
}

export const normalizeExecutionHistory = (test: any) => {
  const backendHistory = Array.isArray(test?.history) ? test.history.filter(Boolean) : []
  if (backendHistory.length > 0) return backendHistory
  if (!test?.lastResult && !test?.lastExecutedAt) return []
  return [{
    date: test.lastExecutedAt || '',
    status: test.lastResult || 'SIN_CORRER',
    executedBy: test.lastExecutedBy || '',
    duration: '',
    failedStep: null,
    evidenceUrl: null,
    evidencias: [],
    observation: null,
    versionExecuted: test.lastExecutedVersion || null
  }]
}

export const getExecutionHistoryStats = (history: any[]) => {
  const isPassed = (status: string) => ['paso', 'ok', 'passed'].includes(String(status || '').toLowerCase())
  const isFailed = (status: string) => ['fallo', 'fallido', 'failed'].includes(String(status || '').toLowerCase())
  const total = history.length
  const passed = history.filter(h => isPassed(h.status)).length
  const failed = history.filter(h => isFailed(h.status)).length
  const successRate = total > 0 ? Math.round((passed / total) * 100) : 0
  return { total, passed, failed, successRate }
}

export const mapBackendExecutionStatus = (status: string) => {
  switch (status) {
    case 'PASO': return 'passed'
    case 'FALLO': return 'failed'
    case 'BLOQUEADO': return 'blocked'
    default: return 'none'
  }
}

export const getSnapshotStatusValue = (
  snapshot: any,
  stepResults: Record<number, string>
) => stepResults[snapshot.numero_paso] || snapshot.estado_paso || 'SIN_CORRER'

export const getSnapshotReferencesByType = (snapshot: any, type: 'action' | 'expected') =>
  Array.isArray(type === 'action' ? snapshot.action_references : snapshot.expected_references)
    ? (type === 'action' ? snapshot.action_references : snapshot.expected_references)
    : []

export const countExecutionReferences = (snapshots: any[]) =>
  snapshots.reduce((total, snapshot) =>
    total + getSnapshotReferencesByType(snapshot, 'action').length + getSnapshotReferencesByType(snapshot, 'expected').length,
  0)

export const isPendingStepStatus = (status: any) =>
  !status || status === 'SIN_CORRER'

export const isConclusiveStepStatus = (status: any) =>
  status === 'FALLO' || status === 'BLOQUEADO'

export const buildExecutionCompletionPlan = (
  snapshots: any[],
  stepResults: Record<number, string>
) => {
  const items = snapshots.map((snapshot, index) => ({
    snapshot,
    index,
    status: getSnapshotStatusValue(snapshot, stepResults)
  }))
  const firstConclusive = items.find(item => isConclusiveStepStatus(item.status))
  const pendingBeforeConclusion = firstConclusive
    ? items.some(item => item.index < firstConclusive.index && isPendingStepStatus(item.status))
    : false
  const pendingWithoutConclusion = !firstConclusive && items.some(item => isPendingStepStatus(item.status))
  const finalStatus = items.some(item => item.status === 'FALLO')
    ? 'FALLO'
    : items.some(item => item.status === 'BLOQUEADO')
      ? 'BLOQUEADO'
      : 'PASO'
  const snapshotsToAutoBlock = firstConclusive
    ? items
      .filter(item => item.index > firstConclusive.index && isPendingStepStatus(item.status))
      .map(item => item.snapshot)
    : []

  return {
    canComplete: !pendingBeforeConclusion && !pendingWithoutConclusion,
    finalStatus,
    firstConclusive,
    pendingBeforeConclusion,
    pendingWithoutConclusion,
    snapshotsToAutoBlock
  }
}

export const buildBugDescription = ({
  selectedTest,
  buildName,
  executionSnapshots,
  stepResults,
  snapshotNotes,
  generalExecutionStatus,
  generalExecutionNote
}: {
  selectedTest: any
  buildName: string
  executionSnapshots: any[]
  stepResults: Record<number, string>
  snapshotNotes: Record<number, string>
  generalExecutionStatus: string
  generalExecutionNote: string
}) => {
  if (!selectedTest) return ''
  let description = `**ENTORNO DE EJECUCIÓN**\n`
  description += `- **Versión/Build**: ${buildName || 'N/A'}\n`
  description += `- **Componente**: ${selectedTest.component}\n`
  description += `- **Dataset**: ${selectedTest.data || 'N/A'}\n\n`
  if (executionSnapshots.length === 0) {
    description += `**EJECUCIÓN SIN PASOS DEFINIDOS**\n`
    description += `- **Veredicto general**: ${generalExecutionStatus}\n`
    description += `- **Observación**: ${generalExecutionNote || 'Sin observación registrada'}\n\n`
    description += `Este caso fue ejecutado como veredicto general porque no tenía pasos definidos al momento de la ejecución.\n`
    return description
  }

  description += `**PASOS EJECUTADOS**\n`
  executionSnapshots.forEach(snapshot => {
    const result = stepResults[snapshot.numero_paso] || snapshot.estado_paso || 'SIN_CORRER'
    description += `${snapshot.numero_paso}. ${snapshot.accion_congelada} -> ${result}\n`
    const note = snapshotNotes[snapshot.numero_paso] || snapshot.comentarios
    if (note) {
      description += `   Observación: ${note}\n`
    }
    if (result === 'FALLO') {
      description += `   FALLO DETECTADO AQUÍ.\n   Se esperaba: ${snapshot.resultado_esperado_congelado}\n`
    }
  })
  return description
}
