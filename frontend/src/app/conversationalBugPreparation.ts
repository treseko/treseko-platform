type PrepareConversationalBugOptions = {
  test: any
  executionId?: string
  executionContext?: any
  snapshotId?: string | null
  note?: string | null
  fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>
  apiBase?: string
  buildInternalBugPayload: (options: any) => Record<string, any>
  loadSnapshotBugEvidence: (snapshotId?: string | null) => Promise<any>
  attachmentIds: (attachments: any[]) => string[]
  setInternalBugDraft?: (draft: Record<string, any>) => void
  setInternalBugAdditionalContext?: (rows: any[]) => void
  setInternalBugEvidence?: (attachments: any[]) => void
  setShowRedminePrompt?: (show: boolean) => void
  setShowRedmineDrawer?: (show: boolean) => void
  showFeedback?: (title: string, message: string, variant?: any) => void
  workflowContext?: any
  reportOverride?: any
}

function technicalTurnIndex(turn: any, fallback: number) {
  const explicit = Number(turn?.technical_index)
  if (Number.isInteger(explicit) && explicit >= 0) return explicit
  const visible = Number(turn?.index ?? turn?.turn_index)
  if (Number.isInteger(visible) && visible > 0) return visible - 1
  return fallback
}

function humanNoteFrom(report: any, execution: any) {
  return report?.chatbot_resultado?.human_evaluation?.notes
    || report?.ai_report?.chatbot_resultado?.human_evaluation?.notes
    || execution?.human_evaluation?.notes
    || execution?.note
    || execution?.observaciones
    || null
}

function formatExpected(value: any) {
  if (value == null || value === '') return 'El chatbot debe cumplir el criterio configurado.'
  if (typeof value === 'string') return value
  if (value.semantic) return String(value.semantic)
  if (Array.isArray(value.must_include) && value.must_include.length > 0) return `Debe incluir: ${value.must_include.join(', ')}`
  if (Array.isArray(value.must_not_include) && value.must_not_include.length > 0) return `No debe incluir: ${value.must_not_include.join(', ')}`
  if (value.regex) return `Debe cumplir la expresión regular: ${value.regex}`
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function responseTextFor(turn: any) {
  return String(turn?.responseText || turn?.response_text || turn?.response?.text || turn?.error || 'Sin respuesta').trim()
}

export async function prepareConversationalBugReport(options: PrepareConversationalBugOptions) {
  const runtime = options.workflowContext || options
  const execution = options.executionContext || options
  const sourceReport = options.reportOverride || await runtime.fetchWithAuth(`${runtime.API_BASE || options.apiBase}/ejecuciones/${execution.executionId}/ai-report/`).then(async (response: Response) => response.ok ? response.json().catch(() => ({})) : {})
  const chatbotResult = sourceReport.chatbot_resultado || sourceReport.ai_report?.chatbot_resultado || {}
  const chatbotConfigSnapshot = sourceReport.chatbot_config_snapshot || sourceReport.ai_report?.chatbot_config_snapshot || chatbotResult.config_snapshot || {}
  const chatbotConfig = chatbotConfigSnapshot?.config || chatbotConfigSnapshot
  const note = humanNoteFrom(sourceReport, execution)
  const turns = Array.isArray(chatbotResult.turns) ? chatbotResult.turns : []
  if (turns.length === 0) {
    runtime.showFeedback('Bug conversacional', 'La ejecución no conserva turnos enviados para construir el reporte.', 'warning')
    return false
  }
  const failedTurnPosition = turns.findIndex((turn: any) => Number(turn.status_code || turn.statusCode || 0) >= 400 || turn.status === 'FAILED' || (turn.assertions || []).some((item: any) => item?.passed === false))
  const chatbotTurnIndex = failedTurnPosition >= 0 ? technicalTurnIndex(turns[failedTurnPosition], failedTurnPosition) : technicalTurnIndex(turns[turns.length - 1], turns.length - 1)
  const failedTurn = failedTurnPosition >= 0 ? turns[failedTurnPosition] || {} : turns[turns.length - 1] || {}
  const responseText = String(failedTurn.responseText || failedTurn.response_text || '').trim()
  const failedAssertion = (failedTurn.assertions || []).some((item: any) => item?.passed === false)
  const chatbotFindingType = ['NO_RESPONSE', 'HTTP_FAILURE', 'SAFETY_VIOLATION', 'TURN_EXPECTATION_MISMATCH', 'INVALID_RESPONSE'].includes(String(failedTurn.failure_type || '').toUpperCase())
    ? String(failedTurn.failure_type).toUpperCase()
    : Number(failedTurn.status_code || failedTurn.statusCode || 0) >= 400
      ? 'HTTP_FAILURE'
      : failedAssertion
        ? 'TURN_EXPECTATION_MISMATCH'
        : !responseText
          ? 'NO_RESPONSE'
        : 'OTHER'
  const executionStatus = String(execution.executionStatus || sourceReport.status || chatbotResult.human_evaluation?.status || chatbotResult.status || 'FALLO').toUpperCase()
  const configuredTurn = Array.isArray(chatbotConfig?.conversation?.turns)
    ? chatbotConfig.conversation.turns.find((turn: any, index: number) => technicalTurnIndex(turn, index) === chatbotTurnIndex)
    : null
  const expectedValue = [
    failedTurn.expected,
    failedTurn.expected_result,
    failedTurn.resultado_esperado,
    configuredTurn?.expected,
    configuredTurn?.expected_result,
  ].find((value: any) => value && (typeof value !== 'object' || Object.keys(value).length > 0))
  const expectedText = formatExpected(expectedValue)
  const observedText = responseTextFor(failedTurn)
  const diagnostic = `El chatbot no cumplió el criterio esperado en el turno ${chatbotTurnIndex + 1} de ${turns.length}. Categoría: ${chatbotFindingType}. Resultado de la ejecución: ${executionStatus}.`
  const observedSummary = [
    `Ejecución marcada como ${executionStatus}.`,
    `Turno ${chatbotTurnIndex + 1}: ${observedText}.`,
    `Hallazgo: ${chatbotFindingType}.`,
  ].join('\n')
  const draft = options.buildInternalBugPayload({ test: options.test, note })
  const preloadedEvidence = await options.loadSnapshotBugEvidence(execution.snapshotId || null)
  runtime.setInternalBugDraft({
    ...draft,
    descripcion: diagnostic,
    resultado_esperado: expectedText,
    resultado_obtenido: observedSummary,
    notas_qa: note || '',
    tipo_contexto: 'CONVERSACIONAL',
    chatbot_turn_index: chatbotTurnIndex,
    chatbot_finding_type: chatbotFindingType,
    titulo: `${options.test.code || options.test.codigo || 'Caso'} - ${options.test.title || options.test.titulo || 'Chatbot'}: turno ${chatbotTurnIndex + 1}`,
    _context: {
      conversational: true,
      test: options.test,
      executionId: execution.executionId,
      executionStatus,
      snapshotId: execution.snapshotId || null,
      note,
      chatbotResult,
      chatbotConfigSnapshot,
      humanEvaluation: chatbotResult.human_evaluation || {},
      chatbotTurnIndex,
      chatbotFindingType,
      forceNewBug: Boolean(execution.forceNewBug),
      preloadedAttachmentIds: options.attachmentIds(preloadedEvidence.attachments),
      backendLinkedAttachmentIds: preloadedEvidence.backendLinkedAttachmentIds,
    },
  })
  runtime.setInternalBugAdditionalContext([])
  runtime.setInternalBugEvidence(preloadedEvidence.attachments)
  runtime.setShowRedminePrompt(false)
  runtime.setShowRedmineDrawer(true)
  return true
}

export async function submitConversationalBugReport(options: any) {
  const context = options.context || {}
  return options.createInternalBugForExecution({
    test: context.test || options.selectedTest,
    executionId: context.executionId || options.currentExecutionCase?.id || null,
    snapshotId: context.snapshotId || null,
    note: context.note || options.editablePayload.notas_qa || null,
    payloadOverride: {
      ...options.editablePayload,
      tipo_contexto: 'CONVERSACIONAL',
      chatbot_turn_index: context.chatbotTurnIndex,
      chatbot_finding_type: context.chatbotFindingType,
      comentario: options.editablePayload.notas_qa || null,
      metadata_json: {
        ...(options.editablePayload.metadata_json || {}),
        additional_context: options.additionalContext,
        ...(context.forceNewBug ? { force_new_bug: true, report_decision: 'CREATE_DIFFERENT' } : {}),
      },
    },
    evidenceAttachments: options.uniqueAttachmentList(options.internalBugEvidence).filter(
      (attachment: any) => !(context.backendLinkedAttachmentIds || []).map((id: any) => String(id)).includes(String(attachment.id)),
    ),
    openTracker: false,
  })
}

export async function openConversationalBugReportForExecution(options: any) {
  const { currentExecutionCase, selectedTest, findOpenBugForExecutionContext, loadOpenBugsForCase, requestRelatedBugDecision, showFeedback, workflowContext } = options
  if (String(selectedTest?.formato_prueba || selectedTest?.format || '').toUpperCase() !== 'CONVERSACIONAL') return false
  const executionId = currentExecutionCase?.id || null
  const runtime = workflowContext || options
  const latestResponse = runtime.fetchWithAuth
    ? await runtime.fetchWithAuth(`${runtime.API_BASE || options.apiBase || ''}/ejecuciones/${currentExecutionCase?.id}/ai-report/`).catch(() => null)
    : null
  const latestReport = latestResponse?.ok ? await latestResponse.json().catch(() => ({})) : {}
  const chatbotResult = latestReport.chatbot_resultado || currentExecutionCase?.chatbot_resultado || {}
  const turns = Array.isArray(chatbotResult.turns) ? chatbotResult.turns : []
  const executionStatus = String(chatbotResult.human_evaluation?.status || chatbotResult.status || latestReport.status || currentExecutionCase?.estado_resultado || '').toUpperCase()
  if (!executionId || !['FALLO', 'BLOQUEADO', 'REQUIERE_REVISION'].includes(executionStatus)) {
    showFeedback('Bug conversacional', 'Primero finaliza la evaluación con FALLO, BLOQUEADO o REQUIERE_REVISION.', 'warning')
    return false
  }
  if (turns.length === 0) {
    showFeedback('Bug conversacional', 'La ejecución no conserva turnos enviados para construir el reporte.', 'warning')
    return false
  }
  const failedPosition = [...turns].reverse().findIndex((turn: any) => String(turn?.status || '').toUpperCase() === 'FAILED' || turn?.failure_type)
  const failedTurn = failedPosition >= 0 ? turns[turns.length - failedPosition - 1] : null
  const chatbotTurnIndex = failedTurn ? technicalTurnIndex(failedTurn, turns.indexOf(failedTurn)) : technicalTurnIndex(turns[turns.length - 1], turns.length - 1)
  const chatbotFindingType = failedTurn?.failure_type || chatbotResult.suggested_failure_type || (executionStatus === 'BLOQUEADO' ? 'NO_RESPONSE' : 'INVALID_RESPONSE')
  const existingBug = options.skipExistingBugCheck
    ? null
    : await findOpenBugForExecutionContext({ executionId, chatbotTurnIndex, chatbotFindingType, contextType: 'CONVERSACIONAL' })
  // The selected case is already known to be conversational. Include legacy
  // related bugs as well: older Chatbot bugs may not have tipo_contexto or
  // may have been stored as CLASICO before conversational bugs existed.
  const related = await loadOpenBugsForCase(selectedTest.id)
  const decisionBugs = existingBug && !related.some((bug: any) => String(bug?.id) === String(existingBug.id))
    ? [existingBug, ...related]
    : related
  let forceNewBug = Boolean(options.skipExistingBugCheck)
  if (!options.skipRelatedBugDecision && decisionBugs.length > 0 && requestRelatedBugDecision) {
    const decision = await requestRelatedBugDecision(decisionBugs, true, { turnIndex: chatbotTurnIndex, findingType: chatbotFindingType })
    if (decision === 'cancel' || decision === 'linked') return false
    forceNewBug = decision === 'create'
  } else if (existingBug) {
    showFeedback('Bug conversacional existente', `${existingBug.codigo} ya tiene seguimiento para este turno y ejecución.`, 'info')
    return false
  }
  return prepareConversationalBugReport({
    executionContext: { executionId, snapshotId: null, executionStatus, note: currentExecutionCase?.observaciones || null, forceNewBug },
    reportOverride: latestReport,
    test: selectedTest,
    buildInternalBugPayload: options.buildInternalBugPayload,
    loadSnapshotBugEvidence: options.loadSnapshotBugEvidence,
    attachmentIds: options.attachmentIds,
    showFeedback,
    workflowContext: options.workflowContext,
  })
}

export async function openConversationalBugReportFromCase(options: any) {
  const { test, context, showFeedback } = options
  if (String(test?.formato_prueba || test?.format || '').toUpperCase() !== 'CONVERSACIONAL' || !context.executionId) return false
  const status = String(context.historyItem?.status || context.historyItem?.estado_resultado || '').toUpperCase()
  if (!['FALLO', 'BLOQUEADO', 'REQUIERE_REVISION'].includes(status)) {
    showFeedback('Bug conversacional', 'Primero finaliza la evaluación con FALLO, BLOQUEADO o REQUIERE_REVISION.', 'warning')
    return true
  }
  await prepareConversationalBugReport({ executionContext: context, test, buildInternalBugPayload: options.buildInternalBugPayload, loadSnapshotBugEvidence: options.loadSnapshotBugEvidence, attachmentIds: options.attachmentIds, showFeedback, workflowContext: options.workflowContext })
  return true
}
