import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner } from 'react-bootstrap'
import { ArrowLeft, Bot, Bug, CheckCircle2, CircleAlert, Info, Send, Terminal, XCircle } from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { useI18n } from '../../i18n'
import { migrateOpeningMessageToTurn, normalizeChatbotConfig } from '../casos/chatbotConfig'
import { createBugLocalizedLabels } from '../bugs/bugPresentation'
import { ChatbotManualTestListSidebar } from './ChatbotManualTestListSidebar'
import { executionStatusLabel } from './executionPresentation'

type ChatbotManualConsolePageProps = {
  selectedTest: any
  activeExecutionTests?: any[]
  currentComponentName?: string
  currentProjectId?: string
  currentExecutionRun: any
  currentExecutionCase: any
  setCurrentExecutionCase?: (updater: any) => void
  syncExecutionCaseStatus?: (caseId: string, status: string, result?: any) => void | Promise<void>
  currentProjectEnvironments?: any[]
  selectedExecutionEnvironmentId?: string
  selectedExecutionDatasetId?: string
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  returnToExecutionList: () => void
  handleSelectTestForExecution?: (test: any) => void
  advanceToNextTest?: (completedCaseId?: string, completedStatus?: string, options?: { preferPending?: boolean }) => Promise<void>
  showFeedback: (title: string, message: string, variant?: any) => void
  relatedCaseBugs?: any[]
  relatedCaseBugsLoading?: boolean
  onRefreshRelatedBugs?: () => Promise<any> | void
  onViewRelatedBug?: (bug: any) => void
  onLinkExecutionToBug?: (bug: any, comentario?: string, chatbotContext?: any) => Promise<any>
  findOpenBugForExecutionContext?: (context: any) => Promise<any>
  requestRelatedBugDecision?: (bugs: any[], canLink: boolean, chatbotContext?: any) => Promise<'create' | 'cancel' | 'linked'>
  openConversationalBugReport?: (options?: { skipExistingBugCheck?: boolean; skipRelatedBugDecision?: boolean }) => void | Promise<void>
  reopenConversationalBugReport?: () => void
  internalBugDraft?: any
}

const formatJson = (value: any) => JSON.stringify(value ?? {}, null, 2)

const configuredTurnsFor = (test: any, result: any) => normalizeChatbotConfig(
  migrateOpeningMessageToTurn(test?.configuracion_chatbot || result?.config_snapshot?.config || {}),
).conversation?.turns || []

const expectedTurnText = (turn: any) => String(turn?.input?.text || '').trim()
const findingTypeKeys: Record<string, string> = {
  NO_RESPONSE: 'ejecutarPruebas.findingNoResponse', HTTP_FAILURE: 'ejecutarPruebas.findingHttpFailure',
  SAFETY_VIOLATION: 'ejecutarPruebas.findingSafetyViolation', TURN_EXPECTATION_MISMATCH: 'ejecutarPruebas.findingTurnMismatch',
  INVALID_RESPONSE: 'ejecutarPruebas.findingInvalidResponse', TOOL_FAILURE: 'ejecutarPruebas.findingToolFailure',
}
const localizedFindingType = (value: unknown, t: (key: any) => string) => {
  const raw = String(value || '').trim()
  const key = findingTypeKeys[raw.toUpperCase()]
  return key ? t(key) : raw
}
const expectedResultText = (expected: any, t: ReturnType<typeof useI18n>['t']) => {
  if (!expected || typeof expected !== 'object') return ''
  if (expected.semantic) return String(expected.semantic)
  if (Array.isArray(expected.must_include) && expected.must_include.length > 0) return `${t('ejecutarPruebas.mustInclude')}: ${expected.must_include.join(', ')}`
  if (Array.isArray(expected.must_not_include) && expected.must_not_include.length > 0) return `${t('ejecutarPruebas.mustNotInclude')}: ${expected.must_not_include.join(', ')}`
  return formatJson(expected)
}

export function ChatbotManualConsolePage({
  selectedTest,
  activeExecutionTests = [],
  currentComponentName = '',
  currentProjectId,
  currentExecutionRun,
  currentExecutionCase,
  setCurrentExecutionCase,
  syncExecutionCaseStatus,
  currentProjectEnvironments = [],
  selectedExecutionEnvironmentId,
  selectedExecutionDatasetId,
  fetchWithAuth,
  returnToExecutionList,
  handleSelectTestForExecution,
  advanceToNextTest,
  showFeedback,
  relatedCaseBugs = [],
  relatedCaseBugsLoading = false,
  onRefreshRelatedBugs,
  onViewRelatedBug,
  onLinkExecutionToBug,
  findOpenBugForExecutionContext,
  requestRelatedBugDecision,
  openConversationalBugReport,
  reopenConversationalBugReport,
  internalBugDraft,
}: ChatbotManualConsolePageProps) {
  const { t } = useI18n()
  const bugStatusLabel = createBugLocalizedLabels(t).status
  const [result, setResult] = useState<any>(currentExecutionCase?.chatbot_resultado || {})
  const [status, setStatus] = useState<'PASO' | 'FALLO' | 'BLOQUEADO'>('PASO')
  const [notes, setNotes] = useState('')
  const [sending, setSending] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [showBugPrompt, setShowBugPrompt] = useState(false)
  const [statusTouched, setStatusTouched] = useState(false)
  const [suggestionFinding, setSuggestionFinding] = useState<string | null>(null)
  const [statusByCaseId, setStatusByCaseId] = useState<Record<string, string>>({})

  useEffect(() => {
    setStatusByCaseId({})
  }, [currentExecutionRun?.id])

  useEffect(() => {
    const nextResult = currentExecutionCase?.chatbot_resultado || {}
    setResult(nextResult)
    const persistedStatus = String(nextResult?.human_evaluation?.status || nextResult?.status || currentExecutionCase?.estado_resultado || '').toUpperCase()
    const initialStatus = ['PASO', 'FALLO', 'BLOQUEADO'].includes(persistedStatus)
      ? persistedStatus
      : (['PASO', 'FALLO', 'BLOQUEADO'].includes(String(nextResult?.suggested_status).toUpperCase()) ? nextResult.suggested_status : 'PASO')
    setStatus(initialStatus)
    setNotes(nextResult?.human_evaluation?.notes || '')
    setSending(false)
    setCompleting(false)
    setShowBugPrompt(false)
    setStatusTouched(Boolean(nextResult?.human_evaluation?.status || ['PASO', 'FALLO', 'BLOQUEADO'].includes(String(currentExecutionCase?.estado_resultado || '').toUpperCase())))
    setSuggestionFinding(nextResult?.suggested_failure_type ? localizedFindingType(nextResult.suggested_failure_type, t) : null)
    const persistedStatusForSidebar = String(nextResult?.human_evaluation?.status || nextResult?.status || currentExecutionCase?.estado_resultado || '').toUpperCase()
    if (selectedTest?.id && ['PASO', 'FALLO', 'BLOQUEADO', 'REQUIERE_REVISION'].includes(persistedStatusForSidebar)) {
      setStatusByCaseId(previous => ({ ...previous, [String(selectedTest.id)]: persistedStatusForSidebar }))
    }
  }, [currentExecutionCase?.id, currentExecutionCase?.estado_resultado, currentExecutionCase?.chatbot_resultado, selectedTest?.id])

  const environment = currentProjectEnvironments.find(item => String(item.id) === String(selectedExecutionEnvironmentId || currentExecutionRun?.entorno_id))
  const dataset = (environment?.datasets || []).find((item: any) => String(item.id) === String(selectedExecutionDatasetId || currentExecutionRun?.dataset_id))
  const executionDatasetName = currentExecutionRun?.dataset_nombre
    || currentExecutionRun?.dataset_name
    || dataset?.name
    || dataset?.nombre
    || (currentExecutionRun?.dataset_id ? `${t('ejecutarPruebas.dataset')} ${currentExecutionRun.dataset_id}` : t('ejecutarPruebas.noDatasetSelected'))
  const resolvedDataset = currentExecutionRun?.datasets_resueltos?.[selectedTest?.id] || []
  const executionDataRows = useMemo(() => {
    const rows = new Map<string, string>()
    if (Array.isArray(resolvedDataset)) {
      resolvedDataset.forEach((item: any) => {
        const key = String(item?.key || '').trim()
        const value = String(item?.value ?? '').trim()
        if (!key) return
        const current = rows.get(key)
        if (!current || (/\{\{[^}]+\}\}/.test(current) && !/\{\{[^}]+\}\}/.test(value)) || !/\{\{[^}]+\}\}/.test(value)) rows.set(key, value)
      })
    }
    return Array.from(rows.entries()).filter(([, value]) => value && !/\{\{[^}]+\}\}/.test(value)).map(([key, value]) => ({ key, value }))
  }, [resolvedDataset])
  const selectedTestComponentLabel = String(selectedTest?.component || currentComponentName || '').trim() || t('ejecutarPruebas.noComponent')
  const batchTests = activeExecutionTests.length > 0 ? activeExecutionTests : (selectedTest ? [selectedTest] : [])
  const turns = Array.isArray(result?.turns) ? result.turns : []
  const configuredTurns = configuredTurnsFor(selectedTest, result)
  const currentTurnIndex = turns.length
  const nextTurn = configuredTurns[currentTurnIndex]
  const nextMessage = expectedTurnText(nextTurn)
  const configuredTurnsLabel = t('ejecutarPruebas.configuredTurns', { count: configuredTurns.length })
  const nextTurnMode = String(nextTurn?.input?.mode || 'fixed')
  const isGeneratedTurn = Boolean(nextTurn && nextTurnMode !== 'fixed')
  const allTurnsSent = configuredTurns.length > 0 && currentTurnIndex >= configuredTurns.length
  const executionStatus = String(currentExecutionCase?.estado_resultado || '').toUpperCase()
  const resultStatus = String(result?.status || '').toUpperCase()
  const effectiveExecutionStatus = ['PASO', 'FALLO', 'BLOQUEADO', 'REQUIERE_REVISION'].includes(resultStatus)
    ? resultStatus
    : executionStatus
  const isFinished = ['PASO', 'FALLO', 'BLOQUEADO', 'REQUIERE_REVISION'].includes(effectiveExecutionStatus)
  const canManageConversationalBug = ['FALLO', 'BLOQUEADO', 'REQUIERE_REVISION'].includes(effectiveExecutionStatus)
  const canFinalize = turns.length > 0 && !completing && !isFinished
  const endpoint = result?.config_snapshot?.config?.connection?.endpoint
    || result?.config_snapshot?.config?.connection?.base_url
    || result?.config_snapshot?.baseUrl
    || t('ejecutarPruebas.inheritedEnvironmentEndpoint')
  const executionLabel = useMemo(() => {
    const code = selectedTest?.code || selectedTest?.codigo || t('ejecutarPruebas.chatbotCase')
    const title = selectedTest?.title || selectedTest?.titulo || ''
    return title ? `${code} · ${title}` : code
  }, [selectedTest])
  const runId = String(currentExecutionRun?.id || '').trim()
  const runStatus = ['PASO', 'FALLO', 'BLOQUEADO', 'REQUIERE_REVISION'].includes(effectiveExecutionStatus)
    ? effectiveExecutionStatus
    : String(currentExecutionRun?.estado_run || currentExecutionRun?.status || 'EN CURSO').toUpperCase()
  const runName = currentExecutionRun?.nombre || currentExecutionRun?.name || t('ejecutarPruebas.manualChatbotBatch')
  const failedTurn = [...turns].reverse().find((turn: any) => String(turn?.status || '').toUpperCase() === 'FAILED' || turn?.failure_type)
  const technicalTurnIndex = failedTurn
    ? Number(failedTurn.technical_index ?? failedTurn.turnIndex ?? turns.indexOf(failedTurn))
    : (turns.length > 0 ? turns.length - 1 : null)
  const currentTurn = failedTurn || (technicalTurnIndex === null ? null : turns[technicalTurnIndex])
  const findingType = failedTurn?.failure_type
    || result?.suggested_failure_type
    || (status === 'BLOQUEADO' ? 'NO_RESPONSE' : Number(currentTurn?.statusCode || currentTurn?.status_code || 0) >= 400 ? 'HTTP_FAILURE' : 'INVALID_RESPONSE')
  // The case is already known to be Chatbot. Keep legacy related bugs here so
  // a bug created before tipo_contexto can still enter the classic decision.
  const conversationalBugs = relatedCaseBugs
  const hasPendingReport = Boolean(internalBugDraft?._context?.conversational && String(internalBugDraft?._context?.executionId) === String(currentExecutionCase?.id))
  const reportedBugForCurrentOccurrence = conversationalBugs.find((bug: any) =>
    String(bug?.ejecucion_id || '') === String(currentExecutionCase?.id || '')
    && Number(bug?.chatbot_turn_index) === Number(technicalTurnIndex)
    && String(bug?.chatbot_finding_type || '').toUpperCase() === String(findingType || '').toUpperCase(),
  )

  const openBugReportForCurrentExecution = async (): Promise<'opened' | 'existing' | 'cancelled' | 'linked'> => {
    if (!canManageConversationalBug) throw new Error(t('ejecutarPruebas.chatbotBugUnavailable'))
    if (!currentExecutionCase?.id || technicalTurnIndex === null) throw new Error(t('ejecutarPruebas.chatbotNoSentTurns'))
    const context = { turnIndex: technicalTurnIndex, findingType }
    const existing = await findOpenBugForExecutionContext?.({
      executionId: currentExecutionCase.id,
      chatbotTurnIndex: technicalTurnIndex,
      chatbotFindingType: findingType,
      contextType: 'CONVERSACIONAL',
    })
    const refreshedRelatedBugs = await onRefreshRelatedBugs?.()
    const bugsForDecision = Array.isArray(refreshedRelatedBugs) ? refreshedRelatedBugs : conversationalBugs
    let skipExistingBugCheck = false
    let skipRelatedBugDecision = false
    const decisionBugs = existing && !bugsForDecision.some((bug: any) => String(bug?.id) === String(existing.id))
      ? [existing, ...bugsForDecision]
      : bugsForDecision
    if (decisionBugs.length > 0 && requestRelatedBugDecision) {
      const decision = await requestRelatedBugDecision(decisionBugs, true, context)
      if (decision === 'cancel') return 'cancelled'
      if (decision === 'linked') return 'linked'
      skipExistingBugCheck = decision === 'create'
      skipRelatedBugDecision = decision === 'create'
    } else if (existing) {
      showFeedback(t('ejecutarPruebas.existingConversationalBug'), `${existing.codigo || t('ejecutarPruebas.bugFallback')} ${t('ejecutarPruebas.existingBugTracking')}`, 'info')
      return 'existing'
    }
    if (hasPendingReport && reopenConversationalBugReport) {
      reopenConversationalBugReport()
    } else if (openConversationalBugReport) {
      await openConversationalBugReport({ skipExistingBugCheck, skipRelatedBugDecision })
    } else {
      throw new Error(t('ejecutarPruebas.openConversationalBugFailed'))
    }
    return 'opened'
  }

  const sendMessage = async () => {
    if (!nextMessage || isGeneratedTurn || sending || completing || isFinished || !currentExecutionCase?.id) return
    setSending(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/ejecuciones/${currentExecutionCase.id}/chatbot/manual/turn`, {
        method: 'POST',
        body: JSON.stringify({ message: nextMessage }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.detail || t('ejecutarPruebas.backendRespondedStatus', { status: response.status }))
      const nextResult = payload?.chatbot_resultado || result
      setResult(nextResult)
      setCurrentExecutionCase?.((previous: any) => previous ? { ...previous, chatbot_resultado: nextResult } : previous)
      if (!statusTouched && nextResult?.suggested_status) {
        setStatus(nextResult.suggested_status)
        setSuggestionFinding(nextResult.suggested_failure_type ? localizedFindingType(nextResult.suggested_failure_type, t) : null)
        if (nextResult.suggested_status !== 'PASO') {
          setNotes(previous => previous || `${t('ejecutarPruebas.automaticSuggestion')}: ${executionStatusLabel(nextResult.suggested_status, t)} ${t('ejecutarPruebas.dueTo')} ${localizedFindingType(nextResult.suggested_failure_type || t('ejecutarPruebas.turnNonCompliance'), t)}.`)
        }
      }
    } catch (error: any) {
      showFeedback(t('ejecutarPruebas.sendMessageFailed'), error?.message || t('ejecutarPruebas.chatbotCommunicationError'), 'danger')
    } finally {
      setSending(false)
    }
  }

  const advanceToNextCase = async (keepCurrentIfLast = false) => {
    const currentIndex = batchTests.findIndex((test: any) => String(test.id) === String(selectedTest?.id))
    const hasNextCase = currentIndex >= 0 && currentIndex < batchTests.length - 1
    if (!hasNextCase && keepCurrentIfLast) return

    if (advanceToNextTest && selectedTest?.id) {
      await advanceToNextTest(selectedTest.id, status, { preferPending: true })
      return
    }
    const nextTest = currentIndex >= 0 ? batchTests[currentIndex + 1] : null
    if (nextTest && handleSelectTestForExecution) {
      await handleSelectTestForExecution(nextTest)
      return
    }
    returnToExecutionList()
  }

  const complete = async () => {
    if (completing || !currentExecutionCase?.id) return
    setCompleting(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/ejecuciones/${currentExecutionCase.id}/chatbot/manual/complete`, {
        method: 'POST',
        body: JSON.stringify({ status, notes: notes.trim() || null }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.detail || t('ejecutarPruebas.backendRespondedStatus', { status: response.status }))
      const finalResult = payload?.chatbot_resultado || { ...result, status }
      const persistedStatus = String(payload?.status || finalResult?.human_evaluation?.status || finalResult?.status || status).toUpperCase()
      setResult(finalResult)
      setStatusByCaseId(previous => ({ ...previous, [String(selectedTest?.id)]: persistedStatus }))
      setCurrentExecutionCase?.((previous: any) => previous ? { ...previous, estado_resultado: persistedStatus, chatbot_resultado: finalResult, observaciones: notes.trim() || `${t('ejecutarPruebas.manualChatbotEvaluationFinished')}: ${persistedStatus}.` } : previous)
      setStatus(persistedStatus as 'PASO' | 'FALLO' | 'BLOQUEADO')
      await syncExecutionCaseStatus?.(selectedTest?.id, persistedStatus, finalResult)
      if (['FALLO', 'BLOQUEADO'].includes(persistedStatus)) {
        setShowBugPrompt(true)
      } else {
        showFeedback(t('ejecutarPruebas.manualEvaluationFinished'), `${t('ejecutarPruebas.caseStatusIs')} ${executionStatusLabel(persistedStatus, t)}.`, 'success')
        await advanceToNextCase()
      }
    } catch (error: any) {
      showFeedback(t('ejecutarPruebas.finishEvaluationFailed'), error?.message || t('ejecutarPruebas.saveEvaluationError'), 'danger')
    } finally {
      setCompleting(false)
    }
  }

  return (
    <div className="manual-console-shell min-vh-100 d-flex flex-column animate__animated animate__fadeIn text-start bg-light">
      <div className="manual-console-header p-3 bg-white border-bottom d-flex justify-content-between align-items-center shadow-sm flex-shrink-0 z-1">
        <div className="d-flex align-items-center gap-3 text-dark min-w-0">
          <Button variant="light" size="sm" onClick={returnToExecutionList} disabled={sending || completing} className="border shadow-sm rounded-circle p-1" aria-label={t('ejecutarPruebas.backToExecutionList')} title={t('ejecutarPruebas.backToExecutionList')}>
            <ArrowLeft size={20} />
          </Button>
          <div className="min-w-0">
            <h5 className="m-0 fw-bold text-dark d-flex align-items-center gap-2">
            <Bot size={22} className="text-primary" /> {t('ejecutarPruebas.chatbotManualConsole')} <Badge bg="primary">{t('ejecutarPruebas.manual')}</Badge>
            </h5>
            <div className="x-small text-muted font-monospace d-flex align-items-center gap-1 mt-1 flex-wrap">
              <Terminal size={12} /> {t('ejecutarPruebas.batch')}: <span className="text-dark">{runName}</span>
              <span className="text-muted">· {t('ejecutarPruebas.id')}: {runId ? <code title={runId}>{runId.slice(0, 8)}</code> : '—'}</span>
              <span className="text-primary">· {t('ejecutarPruebas.dataset')}: {executionDatasetName}</span>
              <Badge bg={runStatus === 'PASO' ? 'success' : runStatus === 'FALLO' ? 'danger' : runStatus === 'BLOQUEADO' ? 'warning' : 'info'}>{executionStatusLabel(runStatus, t)}</Badge>
            </div>
          </div>
        </div>
        <div className="small text-muted text-end flex-shrink-0">
          <div><strong>{t('ejecutarPruebas.environment')}:</strong> {environment?.name || environment?.nombre || currentExecutionRun?.entorno || t('ejecutarPruebas.noEnvironment')}</div>
          <div><strong>{t('ejecutarPruebas.dataset')}:</strong> {executionDatasetName}</div>
        </div>
      </div>

      <Alert variant="warning" className="small rounded-0 border-0 border-bottom mb-0">
        {t('ejecutarPruebas.chatbotReadOnlyNotice')}
      </Alert>

      <Modal show={showBugPrompt} onHide={() => setShowBugPrompt(false)} centered backdrop="static">
        <Modal.Header className="border-0 bg-warning bg-opacity-10 text-dark">
          <Modal.Title className="fw-bold d-flex align-items-center gap-2">
            <CircleAlert size={22} className="text-warning" /> {t('ejecutarPruebas.chatbotStatusUpdated')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="px-4 pb-2 text-dark">
          <p className="small mb-0">
            {t('ejecutarPruebas.chatbotSavedResult')} <strong>{executionStatusLabel(status, t)}</strong>. {t('ejecutarPruebas.chatbotPendingOrReport')}
          </p>
        </Modal.Body>
        <Modal.Footer className="border-0 px-4 pb-4 d-flex justify-content-end gap-2">
          <Button variant="outline-primary" className="fw-bold rounded-pill px-4" disabled={completing} onClick={async () => { setShowBugPrompt(false); await advanceToNextCase(true) }}>
            {t('ejecutarPruebas.reportLater')}
          </Button>
          <Button variant="danger" className="fw-bold rounded-pill px-4" disabled={completing || technicalTurnIndex === null} onClick={async () => {
            setCompleting(true)
            try {
              await openBugReportForCurrentExecution()
              setShowBugPrompt(false)
            } catch (error: any) {
              showFeedback(t('ejecutarPruebas.conversationalBug'), error?.message || t('ejecutarPruebas.createBugFailed'), 'danger')
            } finally {
              setCompleting(false)
            }
          }}>
            <Bug size={16} className="me-2" /> {t('ejecutarPruebas.reportNow')}
          </Button>
        </Modal.Footer>
      </Modal>

      <div className="manual-console-main flex-grow-1 d-flex overflow-hidden">
        {batchTests.length > 0 && (
          <ChatbotManualTestListSidebar
            activeExecutionTests={batchTests}
            selectedTest={selectedTest}
            currentExecutionRun={currentExecutionRun}
            currentExecutionCase={currentExecutionCase}
            statusByCaseId={statusByCaseId}
            handleSelectTestForExecution={handleSelectTestForExecution}
          />
        )}

        <div className="manual-console-content flex-grow-1 overflow-auto p-3 p-lg-4">
          <Row className="g-3 align-items-start">
            <Col xl={3} lg={4}>
              <Card className="border-0 shadow-sm rounded-3 bg-white mb-3">
                <Card.Header className="bg-white border-bottom py-3">
                  <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2"><Info size={18} className="text-primary" /> {t('ejecutarPruebas.caseDetails')}</h6>
                </Card.Header>
                <Card.Body className="p-3">
                  <div className="mb-3">
                    <div className="x-small fw-bold text-muted text-uppercase mb-1">{t('ejecutarPruebas.case')}</div>
                    <div className="small fw-semibold text-dark">{executionLabel}</div>
                  </div>
                  <div className="mb-3">
                    <div className="x-small fw-bold text-muted text-uppercase mb-1">{t('ejecutarPruebas.affectedComponent')}</div>
                    <Badge bg="light" text="dark" className="border shadow-sm">{selectedTestComponentLabel}</Badge>
                  </div>
                  <div className="mb-3"><div className="x-small fw-bold text-muted text-uppercase mb-1">{t('ejecutarPruebas.objectiveDescription')}</div><div className="small text-dark">{selectedTest?.description || t('ejecutarPruebas.noObjective')}</div></div>
                  <div className="mb-3"><div className="x-small fw-bold text-muted text-uppercase mb-1">{t('ejecutarPruebas.preconditions')}</div><div className="small text-dark">{selectedTest?.pre || t('ejecutarPruebas.noPreconditions')}</div></div>
                  <div className="mb-3"><div className="x-small fw-bold text-muted text-uppercase mb-1">{t('ejecutarPruebas.postconditions')}</div><div className="small text-dark">{selectedTest?.post || t('ejecutarPruebas.noPostconditions')}</div></div>
                  <div>
                    <div className="x-small fw-bold text-muted text-uppercase mb-1">{t('ejecutarPruebas.executionData')}</div>
                    <div className="bg-light rounded border overflow-hidden">
                      <div className="px-2 py-1 border-bottom bg-white x-small">{t('ejecutarPruebas.environment')}: <span className="text-primary fw-semibold">{environment?.name || environment?.nombre || currentExecutionRun?.entorno || t('ejecutarPruebas.noEnvironment')}</span><span className="mx-1 text-muted">·</span>{t('ejecutarPruebas.dataset')}: <span className="text-primary fw-semibold">{executionDatasetName}</span></div>
                      {executionDataRows.length > 0 ? (
                        <div className="table-responsive"><table className="table table-sm mb-0 align-middle x-small"><tbody>{executionDataRows.map(item => <tr key={item.key}><td className="text-secondary fw-semibold font-monospace border-0 py-1 ps-2" style={{ width: '42%' }}>{item.key}</td><td className="text-primary font-monospace border-0 py-1 pe-2 text-break">{item.value}</td></tr>)}</tbody></table></div>
                      ) : <div className="p-2 x-small text-muted">{t('ejecutarPruebas.noResolvedData')}</div>}
                    </div>
                  </div>
                </Card.Body>
              </Card>
            </Col>

            <Col xl={6} lg={8}>
              <Card className="shadow-sm border-0 mb-3">
                <Card.Header className="bg-white d-flex justify-content-between align-items-center"><strong>{t('ejecutarPruebas.conversation')}</strong><span className="small text-muted">{t('ejecutarPruebas.conversationSent', { count: turns.length })} · {configuredTurnsLabel} · {t('ejecutarPruebas.session')} {result?.session_id || t('ejecutarPruebas.sessionCreatedOnSend')}</span></Card.Header>
                <Card.Body className="bg-light" style={{ minHeight: 420 }}>
                  {turns.length === 0 ? <div className="h-100 d-flex flex-column align-items-center justify-content-center text-muted py-5 text-center"><strong>{t('ejecutarPruebas.turnReady')}</strong><span className="small mt-1">{t('ejecutarPruebas.chatbotConfiguredMessageNotice')}</span></div> : <div className="d-flex flex-column gap-3">{turns.map((turn: any, index: number) => {
                    const passed = turn.status === 'PASSED'
                    const expected = configuredTurns[index]?.expected
                    return <Card key={`${turn.turnIndex || index}-${turn.timestamp || index}`} className="border shadow-sm"><Card.Header className="bg-white d-flex flex-wrap justify-content-between gap-2 align-items-center"><span className="fw-semibold">{t('ejecutarPruebas.visibleTurn')}: {index + 1} {t('ejecutarPruebas.of')} {configuredTurns.length || '—'} <span className="text-muted fw-normal">· {t('ejecutarPruebas.technicalIndex')}: {index}</span></span><span className="small text-muted">{turn.latencyMs || 0} ms · HTTP {turn.statusCode || '—'}</span></Card.Header><Card.Body><div className="mb-2"><Badge bg="secondary" className="me-2">{t('ejecutarPruebas.tester')}</Badge><span className="text-break">{turn.message}</span></div><div className="mb-2"><Badge bg={passed ? 'success' : 'danger'} className="me-2">{t('ejecutarPruebas.chatbot')}</Badge><span className="text-break">{turn.responseText || turn.error || t('ejecutarPruebas.noResponse')}</span></div>{expectedResultText(expected, t) && <div className="small text-muted mb-3"><strong>{t('ejecutarPruebas.expectedResult')}:</strong> {expectedResultText(expected, t)}</div>}<details><summary className="small text-primary" style={{ cursor: 'pointer' }}>{t('ejecutarPruebas.viewFullRequestResponse')}</summary><Row className="g-2 mt-1"><Col md={6}><pre className="small bg-dark text-light rounded p-2 mb-0" style={{ maxHeight: 220, overflow: 'auto' }}>{formatJson(turn.request)}</pre></Col><Col md={6}><pre className="small bg-dark text-light rounded p-2 mb-0" style={{ maxHeight: 220, overflow: 'auto' }}>{formatJson(turn.response)}</pre></Col></Row></details></Card.Body></Card>
                  })}</div>}
                </Card.Body>
                <Card.Footer className="bg-white"><div className="d-flex justify-content-between align-items-center gap-2 mb-2"><span className="small fw-semibold">{t('ejecutarPruebas.currentTurn')}: {Math.min(currentTurnIndex + 1, configuredTurns.length || currentTurnIndex + 1)} {t('ejecutarPruebas.of')} {configuredTurns.length || '—'}</span>{expectedResultText(nextTurn?.expected, t) && <span className="small text-muted text-end">{t('ejecutarPruebas.expectedShort')}: {expectedResultText(nextTurn.expected, t)}</span>}</div>{isGeneratedTurn && <Alert variant="info" className="small mb-2">{t('ejecutarPruebas.generatedTurnNotice')}</Alert>}{allTurnsSent && <Alert variant="success" className="small mb-2">{t('ejecutarPruebas.allTurnsSentNotice')}</Alert>}<div className="d-flex gap-2"><Form.Control value={nextMessage} readOnly disabled={sending || completing || isFinished || allTurnsSent || isGeneratedTurn} placeholder={isGeneratedTurn ? t('ejecutarPruebas.generatedMessagePlaceholder') : t('ejecutarPruebas.noFixedMessagePlaceholder')} aria-label={t('ejecutarPruebas.currentTurnMessageAria')} /><Button onClick={() => void sendMessage()} disabled={!nextMessage || sending || completing || isFinished || allTurnsSent || isGeneratedTurn}>{sending ? <Spinner size="sm" animation="border" /> : <Send size={16} />}<span className="ms-2">{t('ejecutarPruebas.sendTurn')}</span></Button></div></Card.Footer>
              </Card>
            </Col>

            <Col xl={3} lg={12}>
              <Card className="shadow-sm border-0 mb-3"><Card.Header className="bg-white"><strong>{t('ejecutarPruebas.executionContext')}</strong></Card.Header><Card.Body className="small"><div className="mb-2"><span className="text-muted d-block">{t('ejecutarPruebas.endpoint')}</span><code className="text-break">{endpoint}</code></div><div className="mb-2"><span className="text-muted d-block">{t('ejecutarPruebas.profile')}</span>{result?.profile?.name || t('ejecutarPruebas.noFixedMessageProfile')}</div><div><span className="text-muted d-block">{t('ejecutarPruebas.strategy')}</span>{isGeneratedTurn ? t('ejecutarPruebas.aiGenerated') : t('ejecutarPruebas.fixedMessage')}</div></Card.Body></Card>
              <Card className="shadow-sm border-0 mb-3"><Card.Header className="bg-white"><strong>{t('ejecutarPruebas.relatedBugs')}</strong></Card.Header><Card.Body className="small"><div className="d-flex flex-column gap-2">{relatedCaseBugsLoading ? <Spinner animation="border" size="sm" /> : conversationalBugs.length === 0 ? <span className="text-muted">{t('ejecutarPruebas.noRelatedConversationalBugs')}</span> : conversationalBugs.map((bug: any) => <div key={bug.id} className="border rounded p-2"><div className="fw-semibold">{bug.codigo} · {bug.titulo}</div><div className="text-muted">{t('ejecutarPruebas.visibleTurn')}: {bug.chatbot_turn_index != null ? Number(bug.chatbot_turn_index) + 1 : t('ejecutarPruebas.completeEvaluation')} · {bugStatusLabel(bug.estado)}</div><div className="d-flex gap-2 mt-2"><Button size="sm" variant="outline-secondary" onClick={() => onViewRelatedBug?.(bug)}>{t('ejecutarPruebas.view')}</Button><Button size="sm" variant="outline-danger" disabled={!canManageConversationalBug || technicalTurnIndex === null || !onLinkExecutionToBug} onClick={() => void onLinkExecutionToBug?.(bug, t('ejecutarPruebas.defectStillOccurs'), { turnIndex: technicalTurnIndex, findingType })}>{t('ejecutarPruebas.updateTracking')}</Button></div></div>)}{canManageConversationalBug && turns.length > 0 && (reportedBugForCurrentOccurrence ? <div className="d-flex gap-2 flex-wrap"><Button size="sm" variant="outline-danger" onClick={() => onViewRelatedBug?.(reportedBugForCurrentOccurrence)}>{t('ejecutarPruebas.reportedBug')} {reportedBugForCurrentOccurrence.codigo} · {t('ejecutarPruebas.view')}</Button><Button size="sm" variant="outline-warning" onClick={() => void openConversationalBugReport?.({ skipExistingBugCheck: true, skipRelatedBugDecision: true })} disabled={completing || sending}>{t('ejecutarPruebas.createDifferentBug')}</Button></div> : <Button size="sm" variant="danger" onClick={() => void openBugReportForCurrentExecution()} disabled={completing || sending}>{hasPendingReport ? t('ejecutarPruebas.continueReport') : t('ejecutarPruebas.createNewBug')}</Button>)}</div></Card.Body></Card>
              <Card className="shadow-sm border-0"><Card.Header className="bg-white"><strong>{t('ejecutarPruebas.manualEvaluation')}</strong></Card.Header><Card.Body><Form.Group className="mb-3"><Form.Label className="small fw-semibold">{t('ejecutarPruebas.finalResult')}</Form.Label><Form.Select value={status} onChange={event => { setStatusTouched(true); setSuggestionFinding(null); setStatus(event.target.value as any) }} disabled={completing || isFinished}><option value="PASO">{t('ejecutarPruebas.pass')} — {t('ejecutarPruebas.meetsExpectation')}</option><option value="FALLO">{t('ejecutarPruebas.fail')} — {t('ejecutarPruebas.doesNotMeetExpectation')}</option><option value="BLOQUEADO">{t('ejecutarPruebas.blocked')} — {t('ejecutarPruebas.couldNotEvaluate')}</option></Form.Select>{!statusTouched && suggestionFinding && <div className="small text-warning mt-2">{t('ejecutarPruebas.automaticSuggestion')}: {executionStatusLabel(status, t)}. {t('ejecutarPruebas.finding')}: {suggestionFinding}. {t('ejecutarPruebas.canChangeBeforeFinish')}</div>}</Form.Group><Form.Group className="mb-3"><Form.Label className="small fw-semibold">{t('ejecutarPruebas.testerNotes')}</Form.Label><Form.Control as="textarea" rows={4} value={notes} onChange={event => { setStatusTouched(true); setNotes(event.target.value) }} disabled={completing || isFinished} placeholder={t('ejecutarPruebas.notesPlaceholder')} /></Form.Group>{turns.length === 0 && <div className="small text-warning mb-2">{t('ejecutarPruebas.sendTurnBeforeFinish')}</div>}<div className="d-grid gap-2"><Button variant={status === 'PASO' ? 'success' : status === 'FALLO' ? 'danger' : 'warning'} onClick={() => void complete()} disabled={!canFinalize} title={turns.length === 0 ? t('ejecutarPruebas.sendTurnBeforeFinish') : undefined}>{completing ? <Spinner size="sm" animation="border" /> : status === 'PASO' ? <CheckCircle2 size={17} /> : status === 'FALLO' ? <XCircle size={17} /> : <CircleAlert size={17} />}<span className="ms-2">{t('ejecutarPruebas.finishEvaluation')}</span></Button></div></Card.Body></Card>
            </Col>
          </Row>
        </div>
      </div>
    </div>
  )
}
