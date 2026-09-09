import { useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Dropdown, ListGroup, Row } from 'react-bootstrap'
import { Clock3, Cpu, History, LayoutList, MoreVertical, PlugZap, Trash2, X } from 'lucide-react'
import { Modal } from 'react-bootstrap'
import { AiExecutionReportModal } from './AiExecutionReportModal'
import { formatQueueMessage, selectConsoleLogs } from './motorIaUtils'

import type { IaRunStatus } from './motorIaTypes'

export function MotorIaView({ options }: { options: any }) {
  const { t, canViewLogs, canViewStatus, canViewWorkflows, healthStatus, healthBadgeVariant, healthLabel, health, engineProcessOnline, llmOnline, healthRefreshError, lastHealthCheckedAt, enginePayload, directEnginePayload, iaStatus, iaExecutionStreams, queueItems, visibleQueueItems, latestQueueItem, finishedQueueItemsCount, hiddenFinishedCount, runningCount, hideFinishedQueueItems, clearHiddenQueueItems, hideQueueItem, setShowQueueHelp, showQueueHelp, setIaQueue, setIaExecutionStreams, setIaLogs, openAiReport, markAiReportReviewed, reportState, setReportState, consoleRef, shouldAutoScrollRef, logs, formatLogTime, formatConsoleMessage, formatMetrics, agentDisplayName, statusMeta, currentProjectIaQueue, liveActivity, setHiddenQueueItems, makeLog, agentClass, logClass, formatElapsed, aiHistory, aiHistoryLoading, aiHistoryError, loadAiHistory } = options
  const [showAllRecentEvents, setShowAllRecentEvents] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const visibleConsoleLogs = useMemo(
    () => selectConsoleLogs(logs, latestQueueItem, showAllRecentEvents),
    [latestQueueItem, logs, showAllRecentEvents]
  )
  const finishedStatuses = new Set(['PASO', 'FALLO', 'BLOQUEADO', 'ERROR', 'STREAM_CERRADO', 'TIMEOUT', 'SKIPPED', 'CANCELLED', 'REQUIERE_REVISION'])
  const getStatusMeta = (status?: string) => statusMeta[status as IaRunStatus] || {
    label: status || t('motorIa.unknown'),
    bg: 'secondary',
  }
  const latestMeta = latestQueueItem
    ? getStatusMeta(latestQueueItem.status)
    : null
  return (
    <div className="p-4 h-100 d-flex flex-column animate__animated animate__fadeIn text-dark text-start motor-ia-page">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4 motor-ia-header">
        <div className="motor-ia-header-copy">
          <h4 className="fw-bold text-primary m-0 d-flex align-items-center gap-2">
            <Cpu size={24} /> {t('motorIa.pageTitle')}
          </h4>
          <div className="small text-muted">
            {t('motorIa.pageDescription')}
          </div>
        </div>
      </div>

      <Row className="g-3 mb-3 flex-grow-1 overflow-hidden motor-ia-workspace" style={{ minHeight: 0 }}>
        {canViewLogs && <Col md={8} lg={9} className="d-flex flex-column h-100">
          <Card className="border-0 shadow-sm bg-dark text-white rounded-3 flex-grow-1 d-flex flex-column overflow-hidden h-100 motor-ia-console-card">
            <Card.Header className="bg-black bg-opacity-50 border-0 py-2 px-3 d-flex flex-column align-items-stretch gap-2">
              <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 motor-ia-console-toolbar">
                <div className="d-flex flex-wrap align-items-center gap-2">
                  <Badge bg="dark" className="border border-secondary text-light">
                    {t('motorIa.eventCount', { visible: visibleConsoleLogs.length, total: logs.length })}
                  </Badge>
                  {runningCount > 0 && <Badge bg="primary">{t('motorIa.runningCount', { count: runningCount })}</Badge>}
                  <Button
                    variant="outline-light"
                    size="sm"
                    className="x-small py-0 px-2 shadow-none"
                    aria-pressed={showAllRecentEvents}
                    onClick={() => setShowAllRecentEvents(current => !current)}
                  >
                    {showAllRecentEvents ? t('motorIa.onlyLatestExecution') : t('motorIa.allRecentEvents')}
                  </Button>
                </div>
                <div className="d-flex flex-wrap align-items-center justify-content-end gap-2 motor-ia-console-actions">
                  {canViewLogs && (
                    <Button variant="outline-light" size="sm" className="x-small py-1 px-2 shadow-none" onClick={() => {
                      setIaLogs([makeLog('system', t('motorIa.consoleClearedLog'))])
                      hideFinishedQueueItems()
                    }} title={t('motorIa.clearConsoleTitle')}>
                      <Trash2 size={13} className="me-1" />{t('motorIa.clearConsole')}
                    </Button>
                  )}
                  {canViewStatus && (
                    <Button variant="outline-light" size="sm" className="x-small py-1 px-2 shadow-none" onClick={() => setShowHistory(true)}>
                      <History size={13} className="me-1" />{t('motorIa.historyTitle')}
                    </Button>
                  )}
                  <Badge bg={runningCount > 0 || iaStatus === 'running' ? 'danger animate-pulse' : 'success'} className="x-small">
                    {runningCount > 0 || iaStatus === 'running' ? t('motorIa.stateRunning') : t('motorIa.stateIdle')}
                  </Badge>
                </div>
              </div>
              {latestQueueItem && latestMeta && (
                <div className="motor-ia-latest-execution d-flex flex-wrap align-items-center gap-2 x-small" aria-live="polite">
                  <Clock3 size={13} aria-hidden="true" />
                  <span className="text-secondary">{t('motorIa.latestExecution')}</span>
                  <strong className="text-info text-truncate">{latestQueueItem.caseCode} · {latestQueueItem.caseTitle}</strong>
                  <Badge bg={latestMeta.bg} text={latestMeta.text as any}>{latestMeta.label}</Badge>
                  {(latestQueueItem.endedAt || latestQueueItem.startedAt) && (
                    <span className="text-secondary">{formatLogTime(latestQueueItem.endedAt || latestQueueItem.startedAt)}</span>
                  )}
                </div>
              )}
            </Card.Header>
            <Card.Body
              ref={consoleRef}
              className="p-3 bg-black flex-grow-1 overflow-auto font-monospace small text-start"
              style={{ minHeight: 0 }}
              onScroll={(event) => {
                const element = event.currentTarget
                shouldAutoScrollRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32
              }}
            >
              {visibleConsoleLogs.map((log, index) => {
                const agentLabel = agentDisplayName(t, log.agent || log.source)
                return (
                  <div key={`${log.ts}-${index}`} className="text-light mb-1">
                    <span className="text-muted">[{formatLogTime(log.ts)}]</span>{' '}
                    {(log.agent || log.source) && (
                      <span className={agentClass(log.agent || log.source)} title={log.agent || log.source}>
                        [{agentLabel}]
                      </span>
                    )}{' '}
                    {log.caseCode && <span className="text-info">{log.caseCode}</span>}{' '}
                    <span className={logClass(log.level)}>{formatConsoleMessage(t, log)}</span>
                    {(log.step || log.attempt || typeof log.confidence === 'number' || formatMetrics(t, log.metrics)) && (
                      <span className="text-muted">
                        {' '}({[
                          log.step ? `${t('motorIa.stepShort')} ${log.step}` : '',
                          log.attempt ? `${t('motorIa.attemptShort')} ${log.attempt}` : '',
                          typeof log.confidence === 'number' ? `${t('motorIa.confidenceShort')} ${log.confidence}%` : '',
                          formatMetrics(t, log.metrics),
                        ].filter(Boolean).join(' · ')})
                      </span>
                    )}
                  </div>
                )
              })}
            </Card.Body>
          </Card>
        </Col>}

        <Col md={canViewLogs ? 4 : 12} lg={canViewLogs ? 3 : 12} className="d-flex flex-column h-100 overflow-auto motor-ia-side-panel">
          {canViewStatus && <Card className="border-0 shadow-sm rounded-3 bg-white p-3 mb-3 text-start">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <h6 className="fw-bold text-secondary m-0 d-flex align-items-center gap-2">
                <PlugZap size={16} /> {t('motorIa.engineStatus')}
              </h6>
              <Badge bg={healthBadgeVariant}>
                {healthLabel}
              </Badge>
            </div>
            <div className="x-small text-muted">
              {engineProcessOnline
                ? t(llmOnline ? 'motorIa.engineOnlineWithModel' : 'motorIa.engineOnlineReviewModel', { version: directEnginePayload?.version || enginePayload?.version || t('motorIa.engineActive') })
                : liveActivity
                  ? t('motorIa.engineActiveChecking')
                : t('motorIa.engineManagedService')}
            </div>
            <div className="x-small text-muted mt-1">
              {t('motorIa.lastHealthCheck', { value: lastHealthCheckedAt ? formatLogTime(lastHealthCheckedAt) : t('motorIa.pending') })}
            </div>
            {healthRefreshError && healthStatus !== 'error' && (
              <div className="x-small text-warning mt-1">{t('motorIa.lastRefresh', { error: healthRefreshError })}</div>
            )}
            {health?.detail && <Alert variant="warning" className="py-2 px-3 mt-2 mb-0 x-small">{health.detail}</Alert>}
          </Card>}

          {canViewWorkflows && <Card className="motor-ia-queue-card border-0 shadow-sm rounded-3 bg-white mb-3 d-flex flex-column flex-grow-1 overflow-hidden">
            <div className="d-flex align-items-start justify-content-between gap-2 p-3 pb-2 flex-shrink-0">
              <div>
                <h6 className="fw-bold text-secondary mb-1 d-flex align-items-center gap-2 text-start">
                  <LayoutList size={16} /> {t('motorIa.queueTitle')} ({visibleQueueItems.length})
                </h6>
                <div className="x-small text-muted text-start">{t('motorIa.queueTemporaryHint')}</div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-shrink-0">
                {hiddenFinishedCount > 0 && (
                  <Button variant="link" size="sm" className="x-small p-0 text-decoration-none" onClick={clearHiddenQueueItems}>
                    {t('motorIa.showHidden')}
                  </Button>
                )}
                <Dropdown align="end">
                  <Dropdown.Toggle variant="outline-secondary" size="sm" className="motor-ia-queue-menu-toggle shadow-none" aria-label={t('motorIa.queueTitle')}>
                    <MoreVertical size={17} aria-hidden="true" />
                  </Dropdown.Toggle>
                  <Dropdown.Menu className="shadow border motor-ia-queue-menu">
                    <Dropdown.Item as="button" disabled={finishedQueueItemsCount === 0} onClick={hideFinishedQueueItems}>
                      {t('motorIa.hideFinished')}
                    </Dropdown.Item>
                    <Dropdown.Item as="button" disabled={visibleQueueItems.length === 0 && currentProjectIaQueue.length === 0} onClick={() => {
                      setIaQueue((prev: string[]) => prev.filter(id => !currentProjectIaQueue.includes(id)))
                      setIaExecutionStreams([])
                      setHiddenQueueItems(new Set())
                    }}>
                      {t('motorIa.clearLocalQueue')}
                    </Dropdown.Item>
                    <Dropdown.Item as="button" disabled={iaExecutionStreams.length === 0} onClick={() => setIaExecutionStreams([])}>
                      {t('motorIa.disconnectStreams')}
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown>
              </div>
            </div>
            <div className="motor-ia-queue-list flex-grow-1 overflow-auto px-3" tabIndex={0} aria-label={t('motorIa.recentExecutionsAria')}>
              {visibleQueueItems.length > 0 ? (
                <ListGroup variant="flush" className="small">
                {visibleQueueItems.map(item => {
                  const meta = getStatusMeta(item.status)
                  const isLatest = item === latestQueueItem
                  return (
                    <ListGroup.Item key={item.jobId || `${item.executionId || 'waiting'}-${item.caseId}`} className="px-0 py-3 bg-transparent text-dark border-light position-relative pe-4">
                      <div className="d-flex justify-content-between align-items-start gap-2">
                        <div className="min-w-0">
                          <div className="fw-bold text-dark text-truncate">
                            <span className="text-primary me-1">{item.caseCode}</span>
                            {item.caseTitle}
                          </div>
                          {item.runName && <div className="x-small text-muted text-truncate">{item.runName}</div>}
                        </div>
                        <div className="d-flex align-items-center gap-1 flex-shrink-0">
                          {isLatest && <Badge bg="info" text="dark">{t('motorIa.latest')}</Badge>}
                          <Badge bg={meta.bg} text={meta.text as any}>{meta.label}</Badge>
                          {!finishedStatuses.has(item.status) && <Button
                              variant="link"
                              size="sm"
                              className="p-0 text-muted lh-1"
                              title={t('motorIa.removeFromQueue')}
                              aria-label={t('motorIa.removeFromQueueAria', { code: item.caseCode })}
                              onClick={() => hideQueueItem(item)}
                            >
                              <X size={15} />
                            </Button>}
                        </div>
                      </div>
                      <div className="d-flex flex-wrap gap-2 align-items-center mt-2 x-small text-muted">
                        <Badge bg="light" text="dark" className="border">{item.component}</Badge>
                        {item.startedAt && <span>{t('motorIa.elapsedTime', { value: formatElapsed(item.startedAt, item.endedAt) })}</span>}
                        {item.lastStep && <span>{t('motorIa.stepLabel', { value: item.lastStep })}</span>}
                        {typeof item.confidence === 'number' && <span>{t('motorIa.confidenceLabel', { value: item.confidence })}</span>}
                        {item.consensus && <span>{t('motorIa.consensusLabel', { value: item.consensus })}</span>}
                      </div>
                      {item.humanReviewRequired && <Badge bg="danger" className="mt-2">{t('motorIa.humanReviewRequired')}</Badge>}
                      {item.lastMessage && <div className="x-small text-muted mt-2 text-truncate">{formatQueueMessage(t, item.lastMessage)}</div>}
                      {item.executionId && canViewStatus && (
                        <Button variant="outline-primary" size="sm" className="mt-2 rounded-pill x-small" onClick={() => openAiReport(item.executionId)}>
                          {t('motorIa.viewReport')}
                        </Button>
                      )}
                    </ListGroup.Item>
                  )
                })}
                </ListGroup>
              ) : (
                <div className="motor-ia-queue-empty text-muted text-center x-small d-flex align-items-end justify-content-center h-100 pb-4">
                  {queueItems.length > 0 ? t('motorIa.allQueueItemsHidden') : t('motorIa.queueEmpty')}
                </div>
              )}
            </div>
          </Card>}

          {showQueueHelp && (
            <Alert variant="info" className="small position-relative pe-4">
              <Button
                variant="link"
                size="sm"
                className="position-absolute top-0 end-0 p-2 text-info"
                title={t('motorIa.hideHelp')}
                aria-label={t('motorIa.hideHelpAria')}
                onClick={() => setShowQueueHelp(false)}
              >
                <X size={14} />
              </Button>
              {t('motorIa.helpRunCases')} <strong>{t('motorIa.runTests')}</strong> {t('motorIa.helpSelectEngine')} <strong>{t('motorIa.engineName')}</strong>.
              {t('motorIa.helpDryRun')} <strong>{t('motorIa.dryRun')}</strong> {t('motorIa.helpFromEditor')}.
            </Alert>
          )}
        </Col>
      </Row>
      <AiExecutionReportModal
        show={reportState.show}
        loading={reportState.loading}
        error={reportState.error}
        report={reportState.report}
        onHide={() => setReportState({ show: false, loading: false, error: '', report: null })}
        onMarkReviewed={markAiReportReviewed}
      />
      <Modal show={showHistory} onHide={() => setShowHistory(false)} size="lg" centered scrollable>
        <Modal.Header closeButton>
          <Modal.Title className="d-flex align-items-center gap-2"><History size={20} /> {t('motorIa.historyTitle')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="d-flex justify-content-between align-items-center gap-2 mb-3">
            <div className="small text-muted">{t('motorIa.historyDescription')}</div>
            <Button variant="outline-primary" size="sm" onClick={() => void loadAiHistory()} disabled={aiHistoryLoading}>
              {aiHistoryLoading ? t('motorIa.historyLoading') : t('motorIa.historyRefresh')}
            </Button>
          </div>
          {aiHistoryError && <Alert variant="warning" className="small">{aiHistoryError}</Alert>}
          {!aiHistoryLoading && aiHistory.length === 0 && !aiHistoryError && (
            <div className="text-muted text-center py-4">{t('motorIa.historyEmpty')}</div>
          )}
          <ListGroup variant="flush">
            {aiHistory.map((item: any) => {
              const meta = getStatusMeta(item.status)
              return (
                <ListGroup.Item key={item.execution_id} className="px-0 py-3">
                  <div className="d-flex justify-content-between align-items-start gap-3">
                    <div className="min-w-0">
                      <div className="fw-bold"><span className="text-primary me-1">{item.case_code}</span>{item.case_title}</div>
                      <div className="small text-muted">{item.run_name || t('motorIa.historyRunUnavailable')} · {item.executed_at ? formatLogTime(item.executed_at) : t('motorIa.pending')}</div>
                      <div className="d-flex flex-wrap gap-2 mt-2 x-small text-muted">
                        <Badge bg={meta.bg} text={meta.text as any}>{meta.label}</Badge>
                        <span>{t('motorIa.historyTraceCount', { count: item.workflow_trace_count || 0 })}</span>
                        <span>{t('motorIa.historyEventCount', { count: item.agent_event_count || 0 })}</span>
                        {typeof item.confidence === 'number' && <span>{t('motorIa.confidenceLabel', { value: item.confidence })}</span>}
                      </div>
                    </div>
                    <Button variant="outline-primary" size="sm" className="flex-shrink-0" onClick={() => openAiReport(item.execution_id)}>
                      {t('motorIa.viewReport')}
                    </Button>
                  </div>
                </ListGroup.Item>
              )
            })}
          </ListGroup>
        </Modal.Body>
      </Modal>
    </div>
  )
}
