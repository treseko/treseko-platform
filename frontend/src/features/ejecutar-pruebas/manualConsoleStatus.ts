type ManualConsoleStatusParams = {
  testId: string
  selectedTestId?: string | null
  currentExecutionCase?: any
  currentRun?: any
  historicalStatus?: string | null
}

const PENDING_STATUS = 'SIN_CORRER'

/**
 * Returns the status for the current manual-run list without mixing it with
 * the case/build historical result.
 */
export function getManualConsoleCaseStatus({
  testId,
  selectedTestId,
  currentExecutionCase,
  currentRun,
  historicalStatus,
}: ManualConsoleStatusParams) {
  if (testId === selectedTestId && currentExecutionCase) {
    return currentExecutionCase.estado_resultado || PENDING_STATUS
  }

  if (currentRun?.id) {
    const statuses = currentRun.execution_statuses_by_case_id || {}
    if (Object.prototype.hasOwnProperty.call(statuses, testId)) {
      return statuses[testId] || PENDING_STATUS
    }
    return PENDING_STATUS
  }

  return historicalStatus || 'PENDIENTE'
}
