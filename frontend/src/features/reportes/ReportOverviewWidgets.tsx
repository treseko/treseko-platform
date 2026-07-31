import type { ReactNode } from 'react'
import { Badge, Button, Card, Col, Row, Table } from 'react-bootstrap'
import { Clock, RefreshCw } from 'lucide-react'
import { formatDateTime } from '../../shared/utils/dateTime'

export function ReportOverviewWidgets(options: any): ReactNode {
  const { renderReportesWidget, t, traceabilityCoverage, traceabilityLoading, loadTraceabilityCoverage, canReadTraceability, isSectionVisible, buildContext, projectMetrics, statusVariant, qaStatus, riskVariant, formatDateTime: formatDateTimeOption, formatHours, formatSeconds, isKpiVisible, reportStats, bugMetrics, failureItems, formatInt, formatPercent, temporalMetrics } = options
  const formatDate = formatDateTimeOption || formatDateTime
  return (
    <>
          {renderReportesWidget('traceabilityCoverage', (
            <Card className="border shadow-sm rounded-3">
              <Card.Body className="py-3">
                <div className="d-flex justify-content-between align-items-center mb-2"><div><h6 className="fw-bold mb-0">{t('reportes.traceabilityCoverage')}</h6><span className="small text-muted">{t('reportes.traceabilityDescription')}</span></div><Button variant="outline-secondary" size="sm" onClick={loadTraceabilityCoverage} disabled={traceabilityLoading} title={t('reportes.updateCoverage')}><RefreshCw size={14} /></Button></div>
                {traceabilityLoading ? <span className="small text-muted">{t('reportes.loadingTraceability')}</span> : traceabilityCoverage ? <><Row className="g-2 small mb-3"><Col xs={6} md={3}><strong>{traceabilityCoverage.requisitos_total}</strong><div className="text-muted">{t('reportes.requirements')}</div></Col><Col xs={6} md={3}><strong>{traceabilityCoverage.historias_con_casos}/{traceabilityCoverage.historias_total}</strong><div className="text-muted">{t('reportes.storiesWithCases')}</div></Col><Col xs={6} md={3}><strong>{traceabilityCoverage.casos_sin_historia}</strong><div className="text-muted">{t('reportes.casesWithoutStory')}</div></Col><Col xs={6} md={3}><strong>{traceabilityCoverage.cobertura_historias_porcentaje}%</strong><div className="text-muted">{t('reportes.storyCoverage')}</div></Col></Row><div className="table-responsive"><Table size="sm" className="mb-0 align-middle"><thead><tr><th>{t('reportes.requirement')}</th><th>{t('reportes.story')}</th><th>{t('reportes.case')}</th><th>{t('reportes.lastResult')}</th></tr></thead><tbody>{traceabilityCoverage.items?.flatMap((requirement: any) => requirement.historias?.length ? requirement.historias.flatMap((story: any) => story.casos?.length ? story.casos.map((testCase: any) => <tr key={`${story.id}-${testCase.master_id}`}><td><span className="fw-bold">{requirement.codigo}</span><div className="small text-muted">{requirement.titulo}</div></td><td><span className="fw-bold">{story.codigo}</span><div className="small text-muted">{story.titulo}</div></td><td>{testCase.codigo} · {testCase.titulo}</td><td>{testCase.ultimo_resultado || t('reportes.noResult')}</td></tr>) : <tr key={story.id}><td>{requirement.codigo}</td><td>{story.codigo} · {story.titulo}</td><td className="text-muted">{t('reportes.noCases')}</td><td>-</td></tr>) : <tr key={requirement.id}><td>{requirement.codigo} · {requirement.titulo}</td><td className="text-muted">{t('reportes.noStories')}</td><td>-</td><td>-</td></tr>)}</tbody></Table></div></> : <span className="small text-muted">{t('reportes.noTraceabilityData')}</span>}
              </Card.Body>
            </Card>
          ), canReadTraceability && isSectionVisible('traceabilityCoverage'))}

          {renderReportesWidget('context', (
          <Card className="border-0 shadow-sm p-4 rounded-3 bg-white mb-4">
            <div className="d-flex flex-wrap align-items-start justify-content-between gap-3">
              <div>
                <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
                  <Badge bg="light" text="dark" className="border">{buildContext.organization || 'Organizacion N/D'}</Badge>
                  <Badge bg="light" text="dark" className="border">{buildContext.project || t('reportes.projectUnavailable')}</Badge>
                  <Badge bg="light" text="dark" className="border">{buildContext.component || 'Sin componente'}</Badge>
                  <Badge bg="primary">{buildContext.build || projectMetrics.build_name || 'Build'}</Badge>
                </div>
                <h5 className="fw-bold mb-1">{buildContext.build || projectMetrics.build_name || 'Build seleccionada'}</h5>
                <div className="small text-muted">
                  Plataforma: {buildContext.platform || 'N/D'} · Responsable: {buildContext.responsible || 'Sin responsable calculado'}
                </div>
              </div>
              <div className="text-end">
                <Badge bg={statusVariant(qaStatus.state)} className="px-3 py-2 mb-2">
                  {qaStatus.label || 'En evaluacion'}
                </Badge>
                <div>
                  <Badge bg={riskVariant(qaStatus.risk)} className="px-3 py-2">{t('reportes.riskLabel')} {qaStatus.risk || 'BAJO'}</Badge>
                </div>
              </div>
            </div>
            <Row className="g-3 mt-3">
              {[
                ['Creacion build', buildContext.build_created_at ? formatDateTime(buildContext.build_created_at) : 'N/D'],
                ['Inicio ejecucion', buildContext.execution_started_at ? formatDateTime(buildContext.execution_started_at) : 'Sin ejecuciones'],
                ['Ultima ejecucion', buildContext.last_execution_at ? formatDateTime(buildContext.last_execution_at) : 'Sin ejecuciones'],
                ['Desde creacion', formatHours(buildContext.elapsed_since_build_creation_hours)],
                ['Tiempo ejecutado', formatSeconds(buildContext.total_execution_seconds)],
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
                Motivo: {qaStatus.reasons.join(' · ')}
              </div>
            )}
          </Card>
          ))}

          {renderReportesWidget('kpis', (
          <Row className="g-3 mb-4 text-center">
            {[
              { id: 'assigned', l: t('reportes.assignedCases'), v: formatInt(projectMetrics.total_casos_asignados), c: 'dark', s: 'base total de calculo' },
              { id: 'executed', l: 'Ejecutados', v: formatInt(projectMetrics.total_ejecutados), c: 'primary', s: 'PASO + FALLO + BLOQUEADO' },
              { id: 'pending', l: 'Sin ejecutar', v: formatInt(reportStats.pendientes), c: 'secondary', s: 'asignados - ejecutados' },
              { id: 'passed', l: 'Pasados', v: formatInt(reportStats.pasados), c: 'success', s: 'ultimo resultado por caso' },
              { id: 'failed', l: 'Fallidos', v: formatInt(reportStats.fallados), c: 'danger', s: 'requieren analisis' },
              { id: 'blocked', l: 'Bloqueados', v: formatInt(reportStats.bloqueados), c: 'primary', s: 'requieren desbloqueo' },
              { id: 'coverage', l: 'Cobertura real', v: formatPercent(projectMetrics.cobertura_porcentaje), c: 'primary', s: 'ejecutados / asignados' },
              { id: 'successExecuted', l: 'Exito ejecutados', v: formatPercent(projectMetrics.exito_sobre_ejecutados_porcentaje), c: 'success', s: 'pasados / ejecutados' },
              { id: 'successTotal', l: 'Exito total', v: formatPercent(projectMetrics.exito_sobre_total_porcentaje), c: 'success', s: 'pasados / asignados' },
              { id: 'openBugs', l: 'Bugs abiertos', v: formatInt(bugMetrics.open), c: 'warning', s: `${formatInt(bugMetrics.total)} asociados` },
              { id: 'newBugs', l: 'Bugs nuevos', v: formatInt(bugMetrics.new_in_build), c: 'danger', s: 'detectados en esta build' },
              { id: 'recurrentBugs', l: 'Reincidentes', v: formatInt(bugMetrics.recurrent), c: 'danger', s: 'aparecen en mas de una referencia' },
              { id: 'failuresWithoutBug', l: 'Fallos sin bug', v: formatInt(failureItems.filter((item: any) => item?.flags?.sin_bug_asociado).length), c: 'danger', s: 'fallos/bloqueos accionables sin bug abierto' },
              { id: 'bugsWithoutEvidence', l: 'Bugs sin evidencia', v: formatInt(bugMetrics.without_evidence), c: 'warning', s: 'requieren adjunto o link' },
              { id: 'blocksWithoutReason', l: 'Bloqueos sin motivo', v: formatInt(failureItems.filter((item: any) => item?.flags?.bloqueo_sin_motivo).length), c: 'primary', s: 'sin diagnostico documentado' },
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
          ))}

          {renderReportesWidget('temporal', (
          <Row className="g-4 mb-4">
            <Col md={12}>
              <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
                <h6 className="fw-bold mb-3 text-secondary text-start d-flex align-items-center gap-2">
                  <Clock size={18} /> {t('reportes.temporalProgress')}
                </h6>
                <Row className="g-3 text-center">
                  {[
                    ['Build a primera ejec.', formatHours(temporalMetrics.build_to_first_execution_hours)],
                    ['Primera a ultima ejec.', formatHours(temporalMetrics.first_to_last_execution_hours)],
                    ['Ciclo QA total', formatHours(temporalMetrics.qa_cycle_hours)],
                    ['Promedio por caso', formatSeconds(temporalMetrics.average_seconds_per_executed_case)],
                    ['Ultima actividad', temporalMetrics.last_activity_at ? formatDateTime(temporalMetrics.last_activity_at) : 'N/D'],
                    ['Dias sin actividad', temporalMetrics.days_without_activity === null || temporalMetrics.days_without_activity === undefined ? 'N/D' : Number(temporalMetrics.days_without_activity).toFixed(1)],
                    ['Tiempo restante estimado', formatSeconds(temporalMetrics.estimated_remaining_seconds)],
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
          ))}

    </>
  )
}
