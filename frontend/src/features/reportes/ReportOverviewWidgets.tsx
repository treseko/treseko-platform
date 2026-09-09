import type { ReactNode } from 'react'
import { Badge, Button, Card, Col, Row, Table } from 'react-bootstrap'
import { Clock, RefreshCw } from 'lucide-react'
import { formatDateTime } from '../../shared/utils/dateTime'

const TRACEABILITY_PAGE_SIZE = 20

const buildTraceabilityRows = (coverage: any, noCasesLabel: string, noStoriesLabel: string) =>
  (coverage?.items || []).flatMap((requirement: any) => requirement.historias?.length
    ? requirement.historias.flatMap((story: any) => story.casos?.length
      ? story.casos.map((testCase: any) => ({
        key: `${requirement.id}-${story.id}-${testCase.master_id}`,
        requirement,
        story,
        testCase,
      }))
      : [{ key: `${requirement.id}-${story.id}`, requirement, story, testCase: null, emptyLabel: noCasesLabel }])
    : [{ key: `${requirement.id}`, requirement, story: null, testCase: null, emptyLabel: noStoriesLabel }])

export function ReportOverviewWidgets(options: any): ReactNode[] {
  const { renderReportesWidget, t, traceabilityCoverage, traceabilityLoading, loadTraceabilityCoverage, canReadTraceability, isSectionVisible, buildContext, projectMetrics, statusVariant, qaStatus, riskVariant, formatDateTime: formatDateTimeOption, formatHours, formatSeconds, isKpiVisible, reportStats, bugMetrics, failureItems, formatInt, formatPercent, temporalMetrics, traceabilityPage = 0, setTraceabilityPage } = options
  const formatDate = formatDateTimeOption || formatDateTime
  const riskLabel = (value: any) => {
    const normalized = String(value || '').toUpperCase()
    const key = normalized === 'ALTO' || normalized === 'ALTA' ? 'reportes.riskHigh' : normalized === 'MEDIO' || normalized === 'MEDIA' ? 'reportes.riskMedium' : 'reportes.riskLow'
    return ['ALTO', 'ALTA', 'MEDIO', 'MEDIA', 'BAJO', 'BAJA'].includes(normalized) ? t(key) : value ? String(value) : t('common.notAvailable')
  }
  const traceabilityRows = buildTraceabilityRows(traceabilityCoverage, t('reportes.noCases'), t('reportes.noStories'))
  const traceabilityPageCount = Math.max(1, Math.ceil(traceabilityRows.length / TRACEABILITY_PAGE_SIZE))
  const safeTraceabilityPage = Math.min(Math.max(0, traceabilityPage), traceabilityPageCount - 1)
  const visibleTraceabilityRows = traceabilityRows.slice(safeTraceabilityPage * TRACEABILITY_PAGE_SIZE, (safeTraceabilityPage + 1) * TRACEABILITY_PAGE_SIZE)
  return [
          renderReportesWidget('traceabilityCoverage', (
            <Card className="border shadow-sm rounded-3">
              <Card.Body className="py-3">
                <div className="d-flex justify-content-between align-items-center mb-2"><div><h6 className="fw-bold mb-0">{t('reportes.traceabilityCoverage')}</h6><span className="small text-muted">{t('reportes.traceabilityDescription')}</span></div><Button variant="outline-secondary" size="sm" onClick={loadTraceabilityCoverage} disabled={traceabilityLoading} title={t('reportes.updateCoverage')}><RefreshCw size={14} /></Button></div>
                {traceabilityLoading ? <span className="small text-muted">{t('reportes.loadingTraceability')}</span> : traceabilityCoverage ? <>
                  <Row className="g-2 small mb-3"><Col xs={6} md={3}><strong>{traceabilityCoverage.requisitos_total}</strong><div className="text-muted">{t('reportes.requirements')}</div></Col><Col xs={6} md={3}><strong>{traceabilityCoverage.historias_con_casos}/{traceabilityCoverage.historias_total}</strong><div className="text-muted">{t('reportes.storiesWithCases')}</div></Col><Col xs={6} md={3}><strong>{traceabilityCoverage.casos_sin_historia}</strong><div className="text-muted">{t('reportes.casesWithoutStory')}</div></Col><Col xs={6} md={3}><strong>{traceabilityCoverage.cobertura_historias_porcentaje}%</strong><div className="text-muted">{t('reportes.storyCoverage')}</div></Col></Row>
                  {traceabilityRows.length > 0 ? <>
                    <div className="d-flex justify-content-between align-items-center gap-2 mb-2 small text-muted flex-wrap">
                      <span>{t('reportes.traceabilityShowing').replace('{from}', String(safeTraceabilityPage * TRACEABILITY_PAGE_SIZE + 1)).replace('{to}', String(Math.min((safeTraceabilityPage + 1) * TRACEABILITY_PAGE_SIZE, traceabilityRows.length))).replace('{total}', String(traceabilityRows.length))}</span>
                      <span>{t('reportes.traceabilityPageLabel').replace('{current}', String(safeTraceabilityPage + 1)).replace('{total}', String(traceabilityPageCount))}</span>
                    </div>
                    <div className="table-responsive"><Table size="sm" className="mb-0 align-middle"><thead><tr><th>{t('reportes.requirement')}</th><th>{t('reportes.story')}</th><th>{t('reportes.case')}</th><th>{t('reportes.lastResult')}</th></tr></thead><tbody>{visibleTraceabilityRows.map((row: any) => <tr key={row.key}><td><span className="fw-bold">{row.requirement.codigo}</span><div className="small text-muted text-truncate" style={{ maxWidth: 260 }}>{row.requirement.titulo}</div></td><td>{row.story ? <><span className="fw-bold">{row.story.codigo}</span><div className="small text-muted text-truncate" style={{ maxWidth: 260 }}>{row.story.titulo}</div></> : <span className="text-muted">{t('reportes.noStories')}</span>}</td><td>{row.testCase ? <><span className="fw-bold">{row.testCase.codigo}</span><div className="small text-muted text-truncate" style={{ maxWidth: 280 }}>{row.testCase.titulo}</div></> : <span className="text-muted">{row.emptyLabel}</span>}</td><td>{row.testCase?.ultimo_resultado || t('reportes.noResult')}</td></tr>)}</tbody></Table></div>
                    <div className="d-flex justify-content-end gap-2 mt-3"><Button variant="outline-secondary" size="sm" disabled={safeTraceabilityPage === 0} onClick={() => setTraceabilityPage?.((page: number) => Math.max(0, page - 1))}>{t('reportes.traceabilityPrevious')}</Button><Button variant="outline-secondary" size="sm" disabled={safeTraceabilityPage >= traceabilityPageCount - 1} onClick={() => setTraceabilityPage?.((page: number) => Math.min(traceabilityPageCount - 1, page + 1))}>{t('reportes.traceabilityNext')}</Button></div>
                  </> : <span className="small text-muted">{t('reportes.noTraceabilityData')}</span>}
                </> : <span className="small text-muted">{t('reportes.noTraceabilityData')}</span>}
              </Card.Body>
            </Card>
          ), canReadTraceability && isSectionVisible('traceabilityCoverage')),

          renderReportesWidget('context', (
          <Card className="border-0 shadow-sm p-4 rounded-3 bg-white mb-4">
            <div className="d-flex flex-wrap align-items-start justify-content-between gap-3">
              <div>
                <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
                  <Badge bg="light" text="dark" className="border">{buildContext.organization || t('reportes.organizationUnavailable')}</Badge>
                  <Badge bg="light" text="dark" className="border">{buildContext.project || t('reportes.projectUnavailable')}</Badge>
                  <Badge bg="light" text="dark" className="border">{buildContext.component || t('reportes.componentUnavailable')}</Badge>
                  <Badge bg="primary">{buildContext.build || projectMetrics.build_name || t('reportes.build')}</Badge>
                </div>
                <h5 className="fw-bold mb-1">{buildContext.build || projectMetrics.build_name || t('reportes.selectedBuild')}</h5>
                <div className="small text-muted">
                  {t('reportes.platform')}: {buildContext.platform || t('common.notAvailable')} · {t('reportes.responsible')}: {buildContext.responsible || t('reportes.responsibleUnavailable')}
                </div>
              </div>
              <div className="text-end">
                <Badge bg={statusVariant(qaStatus.state)} className="px-3 py-2 mb-2">
                  {qaStatus.label || t('reportes.evaluationPending')}
                </Badge>
                <div>
                  <Badge bg={riskVariant(qaStatus.risk)} className="px-3 py-2">{t('reportes.riskLabel')} {riskLabel(qaStatus.risk || 'BAJO')}</Badge>
                </div>
              </div>
            </div>
            <Row className="g-3 mt-3">
              {[
                [t('reportes.buildCreation'), buildContext.build_created_at ? formatDateTime(buildContext.build_created_at) : t('common.notAvailable')],
                [t('reportes.executionStart'), buildContext.execution_started_at ? formatDateTime(buildContext.execution_started_at) : t('reportes.noExecutions')],
                [t('reportes.lastExecution'), buildContext.last_execution_at ? formatDateTime(buildContext.last_execution_at) : t('reportes.noExecutions')],
                [t('reportes.sinceCreation'), formatHours(buildContext.elapsed_since_build_creation_hours)],
                [t('reportes.executedTime'), formatSeconds(buildContext.total_execution_seconds)],
              ].map(([label, value]) => (
                <Col md key={label}>
                  <div className="border rounded-3 p-3 h-100">
                    <div className="x-small text-muted fw-bold text-uppercase">{label}</div>
                    <div className="fw-bold text-dark">{value}</div>
                  </div>
                </Col>
              ))}
            </Row>
            {Array.isArray(qaStatus.reasons) && qaStatus.reasons.length > 0 && (
              <div className="small text-muted mt-3">
                {t('reportes.reason')}: {qaStatus.reasons.join(' · ')}
              </div>
            )}
          </Card>
          )),

          renderReportesWidget('kpis', (
          <Row className="g-3 mb-4 text-center">
            {[
              { id: 'assigned', l: t('reportes.assignedCases'), v: formatInt(projectMetrics.total_casos_asignados), c: 'dark', s: t('reportes.assignedCasesFormula') },
              { id: 'executed', l: t('reportes.executed'), v: formatInt(projectMetrics.total_ejecutados), c: 'primary', s: t('reportes.executedFormula') },
              { id: 'pending', l: t('reportes.notExecuted'), v: formatInt(reportStats.pendientes), c: 'secondary', s: t('reportes.assignedMinusExecuted') },
              { id: 'passed', l: t('reportes.passed'), v: formatInt(reportStats.pasados), c: 'success', s: t('reportes.latestResultPerCase') },
              { id: 'failed', l: t('reportes.failed'), v: formatInt(reportStats.fallados), c: 'danger', s: t('reportes.requireAnalysis') },
              { id: 'blocked', l: t('reportes.blocked'), v: formatInt(reportStats.bloqueados), c: 'primary', s: t('reportes.requireUnblocking') },
              { id: 'coverage', l: t('reportes.actualCoverage'), v: formatPercent(projectMetrics.cobertura_porcentaje), c: 'primary', s: t('reportes.executedOverAssigned') },
              { id: 'successExecuted', l: t('reportes.executedSuccess'), v: formatPercent(projectMetrics.exito_sobre_ejecutados_porcentaje), c: 'success', s: t('reportes.passedOverExecuted') },
              { id: 'successTotal', l: t('reportes.totalSuccess'), v: formatPercent(projectMetrics.exito_sobre_total_porcentaje), c: 'success', s: t('reportes.passedOverAssigned') },
              { id: 'openBugs', l: t('reportes.openBugs'), v: formatInt(bugMetrics.open), c: 'warning', s: t('reportes.associatedCount', { count: formatInt(bugMetrics.total) }) },
              { id: 'newBugs', l: t('reportes.newBugs'), v: formatInt(bugMetrics.new_in_build), c: 'danger', s: t('reportes.detectedInBuild') },
              { id: 'recurrentBugs', l: t('reportes.recurrentBugs'), v: formatInt(bugMetrics.recurrent), c: 'danger', s: t('reportes.moreThanOneReference') },
              { id: 'failuresWithoutBug', l: t('reportes.failuresWithoutBug'), v: formatInt(failureItems.filter((item: any) => item?.flags?.sin_bug_asociado).length), c: 'danger', s: t('reportes.actionableWithoutOpenBug') },
              { id: 'bugsWithoutEvidence', l: t('reportes.bugsWithoutEvidence'), v: formatInt(bugMetrics.without_evidence), c: 'warning', s: t('reportes.requireAttachment') },
              { id: 'blocksWithoutReason', l: t('reportes.blocksWithoutReason'), v: formatInt(failureItems.filter((item: any) => item?.flags?.bloqueo_sin_motivo).length), c: 'primary', s: t('reportes.noDocumentedDiagnosis') },
            ].filter((x) => isKpiVisible(x.id)).map((x) => (
              <Col md={4} xl={2} key={x.id}>
                <Card className="border-0 shadow-sm p-3 rounded-3 bg-white h-100">
                  <small className="text-muted fw-bold text-uppercase">{x.l}</small>
                  <h4 className={`fw-bold my-1 text-${x.c}`}>{x.v}</h4>
                  <span className="text-muted x-small">{x.s}</span>
                </Card>
              </Col>
            ))}
          </Row>
          )),

          renderReportesWidget('temporal', (
          <Row className="g-4 mb-4">
            <Col md={12}>
              <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
                <h6 className="fw-bold mb-3 text-secondary text-start d-flex align-items-center gap-2">
                  <Clock size={18} /> {t('reportes.temporalProgress')}
                </h6>
                <Row className="g-3 text-center">
                  {[
                    [t('reportes.buildToFirstExec'), formatHours(temporalMetrics.build_to_first_execution_hours)],
                    [t('reportes.firstToLastExec'), formatHours(temporalMetrics.first_to_last_execution_hours)],
                    [t('reportes.qaCycle'), formatHours(temporalMetrics.qa_cycle_hours)],
                    [t('reportes.avgPerCase'), formatSeconds(temporalMetrics.average_seconds_per_executed_case)],
                    [t('reportes.lastActivity'), temporalMetrics.last_activity_at ? formatDateTime(temporalMetrics.last_activity_at) : t('common.notAvailable')],
                    [t('reportes.daysWithoutActivity'), temporalMetrics.days_without_activity === null || temporalMetrics.days_without_activity === undefined ? t('common.notAvailable') : Number(temporalMetrics.days_without_activity).toFixed(1)],
                    [t('reportes.estimatedRemaining'), formatSeconds(temporalMetrics.estimated_remaining_seconds)],
                  ].map(([label, value]) => (
                    <Col md={3} xl key={label}>
                      <div className="border rounded-3 p-3 h-100">
                        <div className="x-small text-muted fw-bold text-uppercase">{label}</div>
                        <div className="fw-bold text-dark">{value}</div>
                      </div>
                    </Col>
                  ))}
                </Row>
              </Card>
            </Col>
          </Row>
          )),

  ]
}
