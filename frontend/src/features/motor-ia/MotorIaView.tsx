import { Alert, Badge, Button, Card, Col, ListGroup, Row, Spinner } from 'react-bootstrap'
import { Cpu, LayoutList, PlugZap, Settings, X } from 'lucide-react'
import { AiExecutionReportModal } from './AiExecutionReportModal'
import { formatTime } from '../../shared/utils/dateTime'

type IaRunStatus = 'EN_ESPERA' | 'EN_EJECUCION' | 'PASO' | 'FALLO' | 'BLOQUEADO' | 'ERROR' | 'STREAM_CERRADO'

export function MotorIaView({ options }: { options: any }) {
  const { t, canEditConfig, canViewLogs, canViewStatus, canViewWorkflows, healthStatus, healthBadgeVariant, healthLabel, health, engineProcessOnline, llmOnline, healthRefreshError, lastHealthCheckedAt, checkHealth, checking, enginePayload, directEnginePayload, iaStatus, iaExecutionStreams, queueItems, visibleQueueItems, finishedQueueItemsCount, hiddenFinishedCount, runningCount, hideFinishedQueueItems, clearHiddenQueueItems, hideQueueItem, setShowQueueHelp, showQueueHelp, setActiveTab, setConfigTab, setIaQueue, setIaExecutionStreams, setIaLogs, openAiReport, markAiReportReviewed, reportState, setReportState, consoleRef, shouldAutoScrollRef, logs, formatTime, formatLogTime, formatConsoleMessage, formatMetrics, agentDisplayName, statusMeta, currentProjectIaQueue, liveActivity, hasAiEngine, setHiddenQueueItems, makeLog, agentClass, logClass, formatElapsed } = options
  return (
    <div className="p-4 h-100 d-flex flex-column animate__animated animate__fadeIn text-dark text-start">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
        <div>
          <h4 className="fw-bold text-primary m-0 d-flex align-items-center gap-2">
            <Cpu size={24} /> Motor IA
          </h4>
          <div className="small text-muted">
            Motor IA completo con proveedores, workflows, cola y trazas. Community incluye 10 ejecuciones semanales.
          </div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          {canViewStatus && (
            <Button variant="outline-primary" size="sm" className="fw-bold border-2 rounded-pill px-3 shadow-none" onClick={() => checkHealth()} disabled={checking}>
              {checking ? <><Spinner size="sm" className="me-1" /> {t('motorIa.checking')}</> : t('motorIa.verifyEngine')}
            </Button>
          )}
          {canEditConfig && hasAiEngine && (
            <Button
              variant="outline-secondary"
              size="sm"
              className="fw-bold border-2 rounded-pill px-3 shadow-none"
              onClick={() => {
                setConfigTab('ai')
                setActiveTab('configuracion')
              }}
            >
              <Settings size={14} className="me-1" /> {t('motorIa.aiConfiguration')}
            </Button>
          )}
          {canViewLogs && (
            <Button variant="outline-secondary" size="sm" className="fw-bold border-2 rounded-pill px-3 shadow-none" onClick={() => setIaLogs([makeLog('system', 'Consola limpia.')])}>
              {t('motorIa.clearConsole')}
            </Button>
          )}
        </div>
      </div>

      <Row className="g-3 mb-3 flex-grow-1 overflow-hidden motor-ia-workspace" style={{ minHeight: 0 }}>
        {canViewLogs && <Col md={8} lg={9} className="d-flex flex-column h-100">
          <Card className="border-0 shadow-sm bg-dark text-white rounded-3 flex-grow-1 d-flex flex-column overflow-hidden h-100">
            <Card.Header className="bg-black bg-opacity-50 border-0 py-2 px-3 d-flex flex-wrap align-items-center justify-content-between gap-2">
              <div className="d-flex align-items-center gap-2">
                <Badge bg="dark" className="border border-secondary text-light">{logs.length} eventos</Badge>
                {runningCount > 0 && <Badge bg="primary">{runningCount} en ejecucion</Badge>}
              </div>
              <Badge bg={runningCount > 0 || iaStatus === 'running' ? 'danger animate-pulse' : 'success'} className="x-small">
                {runningCount > 0 || iaStatus === 'running' ? 'RUNNING' : 'IDLE'}
              </Badge>
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
              {logs.map((log, index) => {
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
                          log.step ? `paso ${log.step}` : '',
                          log.attempt ? `intento ${log.attempt}` : '',
                          typeof log.confidence === 'number' ? `conf ${log.confidence}%` : '',
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
                <PlugZap size={16} /> Estado del Motor IA
              </h6>
              <Badge bg={healthBadgeVariant}>
                {healthLabel}
              </Badge>
            </div>
            <div className="x-small text-muted">
              {engineProcessOnline
                ? `Engine ${directEnginePayload?.version || enginePayload?.version || 'activo'}${llmOnline ? ' y modelo disponible.' : '; revisa el proveedor/modelo configurado.'}`
                : liveActivity
                  ? 'Hay una ejecucion activa. Verificando health del engine en segundo plano.'
                : 'Servicio interno gestionado por la aplicacion. La conexion y el puerto no se configuran desde esta pantalla.'}
            </div>
            <div className="x-small text-muted mt-1">
              Ultima verificacion: {lastHealthCheckedAt ? formatLogTime(lastHealthCheckedAt) : 'pendiente'}
            </div>
            {healthRefreshError && healthStatus !== 'error' && (
              <div className="x-small text-warning mt-1">Ultimo refresco: {healthRefreshError}</div>
            )}
            {health?.detail && <Alert variant="warning" className="py-2 px-3 mt-2 mb-0 x-small">{health.detail}</Alert>}
          </Card>}

          {canViewWorkflows && <Card className="border-0 shadow-sm rounded-3 bg-white p-3 mb-3">
            <div className="d-flex align-items-start justify-content-between gap-2 mb-3">
              <div>
                <h6 className="fw-bold text-secondary mb-1 d-flex align-items-center gap-2 text-start">
                  <LayoutList size={16} /> Cola de Ejecucion ({visibleQueueItems.length})
                </h6>
                <div className="x-small text-muted text-start">{t('motorIa.queueTemporaryHint')}</div>
              </div>
              {hiddenFinishedCount > 0 && (
                <Button variant="link" size="sm" className="x-small p-0 text-decoration-none flex-shrink-0" onClick={clearHiddenQueueItems}>
                  Mostrar ocultas
                </Button>
              )}
            </div>
            {visibleQueueItems.length > 0 ? (
              <ListGroup variant="flush" className="small">
                {visibleQueueItems.map(item => {
                  const meta = statusMeta[item.status as IaRunStatus] || statusMeta.EN_ESPERA
                  return (
                    <ListGroup.Item key={`${item.executionId || 'waiting'}-${item.caseId}`} className="px-0 py-3 bg-transparent text-dark border-light position-relative pe-4">
                      <div className="d-flex justify-content-between align-items-start gap-2">
                        <div className="min-w-0">
                          <div className="fw-bold text-dark text-truncate">
                            <span className="text-primary me-1">{item.caseCode}</span>
                            {item.caseTitle}
                          </div>
                          {item.runName && <div className="x-small text-muted text-truncate">{item.runName}</div>}
                        </div>
                        <div className="d-flex align-items-center gap-1 flex-shrink-0">
                          <Badge bg={meta.bg} text={meta.text as any}>{meta.label}</Badge>
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 text-muted lh-1"
                            title={t('motorIa.removeFromQueue')}
                            aria-label={t('motorIa.removeFromQueueAria', { code: item.caseCode })}
                            onClick={() => hideQueueItem(item)}
                          >
                            <X size={15} />
                          </Button>
                        </div>
                      </div>
                      <div className="d-flex flex-wrap gap-2 align-items-center mt-2 x-small text-muted">
                        <Badge bg="light" text="dark" className="border">{item.component}</Badge>
                        {item.startedAt && <span>Tiempo {formatElapsed(item.startedAt, item.endedAt)}</span>}
                        {item.lastStep && <span>Paso {item.lastStep}</span>}
                        {typeof item.confidence === 'number' && <span>Conf. {item.confidence}%</span>}
                        {item.consensus && <span>Consenso {item.consensus}</span>}
                      </div>
                      {item.humanReviewRequired && <Badge bg="danger" className="mt-2">{t('motorIa.humanReviewRequired')}</Badge>}
                      {item.lastMessage && <div className="x-small text-muted mt-2 text-truncate">{item.lastMessage}</div>}
                      {item.executionId && canViewStatus && (
                        <Button variant="outline-primary" size="sm" className="mt-2 rounded-pill x-small" onClick={() => openAiReport(item.executionId)}>
                          Ver reporte
                        </Button>
                      )}
                    </ListGroup.Item>
                  )
                })}
              </ListGroup>
            ) : (
              <div className="text-muted text-center x-small py-4">
                {queueItems.length > 0 ? 'Todas las ejecuciones estan ocultas en esta vista temporal.' : 'No hay casos en la cola de ejecucion.'}
              </div>
            )}
            {visibleQueueItems.length > 0 && (
              <div className="d-grid gap-2 mt-2">
                {finishedQueueItemsCount > 0 && (
                  <Button variant="outline-primary" size="sm" className="rounded-pill shadow-none" onClick={hideFinishedQueueItems}>
                    Limpiar finalizadas
                  </Button>
                )}
                <Button variant="outline-secondary" size="sm" className="rounded-pill shadow-none" onClick={() => {
                  setIaQueue((prev: string[]) => prev.filter(id => !currentProjectIaQueue.includes(id)))
                  setIaExecutionStreams([])
                  setHiddenQueueItems(new Set())
                }}>
                  Limpiar cola local
                </Button>
              </div>
            )}
            {iaExecutionStreams.length > 0 && (
              <Button variant="outline-secondary" size="sm" className="mt-2 rounded-pill shadow-none" onClick={() => setIaExecutionStreams([])}>
                Desconectar streams
              </Button>
            )}
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
              {t('motorIa.helpRunCases')} <strong>{t('motorIa.runTests')}</strong> {t('motorIa.helpSelectEngine')} <strong>IA Agent Engine</strong>.
              {t('motorIa.helpDryRun')} <strong>Dry-run IA</strong> {t('motorIa.helpFromEditor')}.
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
    </div>
  )
}
