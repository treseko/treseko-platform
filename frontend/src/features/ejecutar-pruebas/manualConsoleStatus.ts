type ManualConsoleStatusParams = {
  testId: string
  selectedTestId?: string | null
  currentExecutionCase?: any
  currentRun?: any
  historicalStatus?: string | null
  localStatus?: string | null
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
  localStatus,
}: ManualConsoleStatusParams) {
  const sameCaseId = (left: unknown, right: unknown) => String(left ?? '') === String(right ?? '')
  if (sameCaseId(testId, selectedTestId) && localStatus) return localStatus
  if (sameCaseId(testId, selectedTestId) && currentExecutionCase) {
    const chatbotResult = currentExecutionCase.chatbot_resultado || {}
    return chatbotResult?.human_evaluation?.status
      || chatbotResult?.status
      || currentExecutionCase.estado_resultado
      || PENDING_STATUS
  }

  if (currentRun?.id) {
    const statuses = currentRun.execution_statuses_by_case_id || {}
    const statusEntry = Object.entries(statuses).find(([caseId]) => sameCaseId(caseId, testId))
    if (statusEntry) {
      return statusEntry[1] || PENDING_STATUS
    }
    return PENDING_STATUS
  }

  return historicalStatus || 'PENDIENTE'
}
