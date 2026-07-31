import type { ReactNode } from 'react'
import { Badge, Button, Card, Col, Form, Image as _UnusedImage, Row, Table } from 'react-bootstrap'
import { Bug, Image as ImageIcon } from 'lucide-react'
import { formatBugPriorityOption } from '../bugs/bugPresentation'
import { BugBuildHistoryMetrics } from './BugBuildHistoryMetrics'

export function ReportDetailWidgets(options: any): ReactNode {
  const { renderReportesWidget, t, setDetailFilters, detailFilters, suiteFilterOptions, priorityFilterOptions, uniqueOptions, allReportBugs, failureItems, ownerFilterOptions, formatInt, formatHours, formatPercent, bugTraceability, bugMetrics, filteredReportBugs, filteredFailures, filteredEvidenceItems, isColumnVisible, visibleColumnCount, riskVariant, onOpenBugTracker, showFeedback, evidenceSummary } = options
  return (
    <>
          {renderReportesWidget('filters', (
          <Card className="border-0 shadow-sm p-4 rounded-3 bg-white mb-4">
            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
              <div>
                <h6 className="fw-bold mb-1 text-secondary">{t('reportes.detailFilters')}</h6>
                <div className="small text-muted">{t('reportes.detailFiltersDescription')}</div>
              </div>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => setDetailFilters({ suite: '', priority: '', status: '', owner: '', executionMode: '', bug: 'open', evidence: '' })}
              >
                Limpiar filtros
              </Button>
            </div>
            <Row className="g-2">
              <Col md={3}>
                <Form.Select size="sm" value={detailFilters.suite} onChange={(event) => setDetailFilters((current) => ({ ...current, suite: event.target.value }))}>
                  <option value="">{t('reportes.allSuites')}</option>
                  {suiteFilterOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Select size="sm" value={detailFilters.priority} onChange={(event) => setDetailFilters((current) => ({ ...current, priority: event.target.value }))}>
                  <option value="">{t('reportes.allPriorities')}</option>
                  {priorityFilterOptions.map((value) => <option key={value} value={value}>{formatBugPriorityOption(value)}</option>)}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Select size="sm" value={detailFilters.status} onChange={(event) => setDetailFilters((current) => ({ ...current, status: event.target.value }))}>
                  <option value="">{t('reportes.allStatuses')}</option>
                  {uniqueOptions([...allReportBugs, ...failureItems], (item) => item.estado).map((value) => <option key={value} value={value}>{value}</option>)}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Select size="sm" value={detailFilters.owner} onChange={(event) => setDetailFilters((current) => ({ ...current, owner: event.target.value }))}>
                  <option value="">{t('reportes.allAssignees')}</option>
                  {ownerFilterOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Select size="sm" value={detailFilters.executionMode} onChange={(event) => setDetailFilters((current) => ({ ...current, executionMode: event.target.value }))}>
                  <option value="">{t('reportes.allModes')}</option>
                  {uniqueOptions([...allReportBugs, ...failureItems], (item) => item.execution_mode).map((value) => <option key={value} value={value}>{value}</option>)}
                </Form.Select>
              </Col>
              <Col md={1}>
                <Form.Select size="sm" value={detailFilters.bug} onChange={(event) => setDetailFilters((current) => ({ ...current, bug: event.target.value }))}>
                  <option value="open">{t('reportes.openBugs')}</option>
                  <option value="closed">{t('reportes.closedBugs')}</option>
                  <option value="">{t('reportes.all')}</option>
                  <option value="with">{t('reportes.failuresWithBug')}</option>
                  <option value="without">{t('reportes.failuresWithoutBug')}</option>
                </Form.Select>
              </Col>
              <Col md={1}>
                <Form.Select size="sm" value={detailFilters.evidence} onChange={(event) => setDetailFilters((current) => ({ ...current, evidence: event.target.value }))}>
                  <option value="">{t('reportes.evidence')}</option>
                  <option value="with">{t('reportes.withEvidence')}</option>
                  <option value="without">{t('reportes.withoutEvidence')}</option>
                </Form.Select>
              </Col>
            </Row>
          </Card>
          ))}

          {renderReportesWidget('bugTraceability', (
              <Card className="border-0 shadow-sm p-4 rounded-3 bg-white h-100">
                <h6 className="fw-bold mb-3 text-secondary text-start d-flex align-items-center gap-2">
                  <Bug size={18} /> {t('reportes.bugTraceability')}
                </h6>
                <Row className="g-2 text-center">
                  {[
                    ['MTTR', formatHours(bugTraceability.mttr_hours)],
                    ['Prom. abierto', formatHours(bugTraceability.avg_bug_open_hours)],
                    ['1er comentario', formatHours(bugTraceability.avg_first_comment_hours)],
                    ['Reabiertos', formatPercent(bugTraceability.reopened_percent)],
                    ['Con evidencia', formatPercent(bugTraceability.with_evidence_percent)],
                    ['Fallos con bug', formatPercent(bugTraceability.failures_with_bug_percent)],
                    ['Vencidos SLA', formatInt(bugTraceability.bugs_overdue_sla)],
                    ['Sin responsable', formatInt(bugMetrics.without_responsible)],
                  ].map(([label, value]) => (
                    <Col xs={6} key={label}>
                      <div className="border rounded-3 p-2 h-100">
                        <div className="x-small text-muted fw-bold text-uppercase">{label}</div>
                        <div className="fw-bold">{value}</div>
                      </div>
                    </Col>
                  ))}
                  <BugBuildHistoryMetrics metrics={bugMetrics} formatInt={formatInt} formatPercent={formatPercent} />
                </Row>
              </Card>
          ))}

          {renderReportesWidget('bugs', (
              <Card className="border-0 shadow-sm p-4 rounded-3 bg-white h-100">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h6 className="fw-bold text-secondary text-start d-flex align-items-center gap-2 m-0">
                    <Bug size={18} /> {t('reportes.buildBugs')}
                  </h6>
                  <Badge bg="light" text="dark" className="border">{formatInt(filteredReportBugs.length)} registros</Badge>
                </div>
                <Table hover responsive className="mb-0 align-middle">
                  <thead>
                    <tr>
                      {isColumnVisible('bugs', 'bug') && <th>{t('reportes.bug')}</th>}
                      {isColumnVisible('bugs', 'caseSuite') && <th>{t('reportes.caseSuite')}</th>}
                      {isColumnVisible('bugs', 'severity') && <th>{t('reportes.severity')}</th>}
                      {isColumnVisible('bugs', 'status') && <th>{t('reportes.status')}</th>}
                      {isColumnVisible('bugs', 'time') && <th>{t('reportes.time')}</th>}
                      {isColumnVisible('bugs', 'evidence') && <th>{t('reportes.evidence')}</th>}
                      {isColumnVisible('bugs', 'action') && <th className="text-end">{t('reportes.action')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReportBugs.slice(0, 8).map((bug: any) => (
                      <tr key={bug.id}>
                        {isColumnVisible('bugs', 'bug') && (
                        <td>
                          <div className="fw-bold">{bug.codigo}</div>
                          <div className="x-small text-muted text-truncate" style={{ maxWidth: 220 }}>{bug.titulo}</div>
                        </td>
                        )}
                        {isColumnVisible('bugs', 'caseSuite') && (
                        <td>
                          <div className="fw-semibold x-small">{bug.case_code || 'Sin caso'}</div>
                          <div className="x-small text-muted text-truncate" style={{ maxWidth: 220 }}>{bug.suite || 'Sin suite'}</div>
                        </td>
                        )}
                        {isColumnVisible('bugs', 'severity') && <td><Badge bg={riskVariant(bug.severidad)}>{bug.severidad}</Badge></td>}
                        {isColumnVisible('bugs', 'status') && (
                        <td>
                          <Badge bg={bug.is_open ? 'warning' : 'secondary'} text={bug.is_open ? 'dark' : undefined}>{bug.estado}</Badge>
                          {bug.recurrent && <Badge bg="danger" className="ms-1">{t('reportes.recurrentBugs')}</Badge>}
                        </td>
                        )}
                        {isColumnVisible('bugs', 'time') && <td className="small">{formatHours(bug.tiempo_abierto_horas ?? bug.tiempo_resolucion_horas)}</td>}
                        {isColumnVisible('bugs', 'evidence') && (
                        <td>
                          <Badge bg={bug.has_evidence ? 'success' : 'danger'}>{bug.has_evidence ? 'Completa' : 'Faltante'}</Badge>
                        </td>
                        )}
                        {isColumnVisible('bugs', 'action') && (
                        <td className="text-end">
                          <Button variant="outline-primary" size="sm" onClick={() => onOpenBugTracker ? onOpenBugTracker() : showFeedback(t('reportes.bugTracker'), t('reportes.openBugTracker'), 'info')}>
                            Ver
                          </Button>
                        </td>
                        )}
                      </tr>
                    ))}
                    {filteredReportBugs.length === 0 && (
                      <tr><td colSpan={visibleColumnCount('bugs')} className="text-center text-muted py-4">{t('reportes.noBugsForExport')}</td></tr>
                    )}
                  </tbody>
                </Table>
              </Card>
          ))}

          {renderReportesWidget('failures', (
              <Card className="border-0 shadow-sm p-4 rounded-3 bg-white h-100">
                <h6 className="fw-bold mb-3 text-secondary text-start">{t('reportes.diagnosableFailures')}</h6>
                <Table hover responsive className="mb-0 align-middle">
                  <thead>
                    <tr>
                      {isColumnVisible('failures', 'case') && <th>{t('reportes.case')}</th>}
                      {isColumnVisible('failures', 'status') && <th>{t('reportes.status')}</th>}
                      {isColumnVisible('failures', 'step') && <th>{t('reportes.step')}</th>}
                      {isColumnVisible('failures', 'bug') && <th>{t('reportes.bug')}</th>}
                      {isColumnVisible('failures', 'flags') && <th>{t('reportes.flags')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFailures.slice(0, 8).map((item: any) => (
                      <tr key={`${item.case_id}-${item.failed_step || 'case'}`}>
                        {isColumnVisible('failures', 'case') && (
                        <td>
                          <div className="fw-bold">{item.case_code}</div>
                          <div className="x-small text-muted text-truncate" style={{ maxWidth: 260 }}>{item.case_title}</div>
                          <div className="x-small text-muted">{item.suite}</div>
                        </td>
                        )}
                        {isColumnVisible('failures', 'status') && <td><Badge bg={item.estado === 'FALLO' ? 'danger' : 'primary'}>{item.estado}</Badge></td>}
                        {isColumnVisible('failures', 'step') && <td className="small">{item.failed_step || t('common.case')}</td>}
                        {isColumnVisible('failures', 'bug') && <td className="small">{item.bug?.length ? item.bug.map((bug: any) => bug.codigo).join(', ') : t('reportes.openBugs')}</td>}
                        {isColumnVisible('failures', 'flags') && (
                        <td>
                          <div className="d-flex flex-wrap gap-1">
                            {item.flags?.sin_evidencia && <Badge bg="danger">{t('reportes.withoutEvidence')}</Badge>}
                            {item.flags?.sin_bug_asociado && <Badge bg="warning" text="dark">{t('reportes.bug')}</Badge>}
                            {item.flags?.bloqueo_sin_motivo && <Badge bg="primary">{t('reportes.blocksWithoutReason')}</Badge>}
                          </div>
                        </td>
                        )}
                      </tr>
                    ))}
                    {filteredFailures.length === 0 && (
                      <tr><td colSpan={visibleColumnCount('failures')} className="text-center text-muted py-4">{t('reportes.noFailuresForFilters')}</td></tr>
                    )}
                  </tbody>
                </Table>
              </Card>
          ))}

          {renderReportesWidget('evidence', (
              <Card className="border-0 shadow-sm p-4 rounded-3 bg-white h-100">
                <h6 className="fw-bold mb-3 text-secondary text-start d-flex align-items-center gap-2">
                  <ImageIcon size={18} /> {t('reportes.evidenceTab')}
                </h6>
                <Row className="g-2 text-center mb-3">
                  {[
                    ['Total', evidenceSummary.total],
                    ['Completas', evidenceSummary.complete],
                    ['Insuficientes', evidenceSummary.insufficient],
                    ['Faltantes', evidenceSummary.missing],
                  ].map(([label, value]) => (
                    <Col xs={6} key={label}>
                      <div className="border rounded-3 p-2">
                        <div className="x-small text-muted fw-bold text-uppercase">{label}</div>
                        <div className="fw-bold">{formatInt(value)}</div>
                      </div>
                    </Col>
                  ))}
                </Row>
                <div className="d-flex flex-column gap-2">
                  {filteredEvidenceItems.slice(0, 5).map((item: any, index: number) => (
                    <div key={`${item.case_code}-${item.bug}-${index}`} className="border rounded-3 p-2 d-flex justify-content-between gap-2">
                      <div>
                        <div className="fw-semibold small">{item.case_code || item.bug || 'Evidencia'}</div>
                        <div className="x-small text-muted">{item.name || item.type}</div>
                      </div>
                      <Badge bg={item.status === 'completa' ? 'success' : item.status === 'insuficiente' ? 'warning' : 'danger'}>
                        {item.status}
                      </Badge>
                    </div>
                  ))}
                  {filteredEvidenceItems.length === 0 && <div className="text-center text-muted small py-4">{t('reportes.noEvidenceForFilters')}</div>}
                </div>
              </Card>
          ))}

    </>
  )
}
