import { Row, Col, Card, Badge, Button, Table } from 'react-bootstrap'
import { BarChart3, Activity, Folders } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { BugBuildTrendBars } from './BugBuildHistoryMetrics'
import { ReportSuiteRows } from './ReportSuiteRows'
import { getBugPriorityPresentation } from '../bugs/bugPresentation'

export function ReportSecondaryWidgets(options: any) {
  const {
    renderReportesWidget, t, projectMetrics, comparison, formatPercent, formatInt,
    isColumnVisible, riskVariant, suiteTree, setExpandedMetricSuites, collectSuiteIds,
    expandedMetricSuites, onOpenEvidence, visibleColumnCount, formatHours,
    snapshotBugLinks, bugStatusIsOpen, canCreateBugs, creatingSnapshotBugId,
    createBugFromReportSnapshot,
  } = options
  return [
renderReportesWidget('buildComparison', (() => {
  const buildHistory = Array.isArray(projectMetrics.historico_versions) ? projectMetrics.historico_versions : []
  const currentIndex = buildHistory.findIndex((item: any) => item.build_id === projectMetrics.build_id)
  const current = currentIndex >= 0 ? buildHistory[currentIndex] : undefined
  const previousBuildId = comparison?.previous_build_id
  const previous = previousBuildId
    ? buildHistory.find((item: any) => item.build_id === previousBuildId)
    : currentIndex >= 0 ? buildHistory[currentIndex + 1] : undefined
  if (!current || !previous) {
    return (
      <Row className="g-4 mb-4">
        <Col md={12}>
          <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
            <h6 className="fw-bold mb-2 text-secondary text-start d-flex align-items-center gap-2">
              <Activity size={18} /> Comparativa vs build anterior
            </h6>
            <div className="small text-muted">{t('reportes.noPreviousBuild')}</div>
          </Card>
        </Col>
      </Row>
    )
  }
  const totalCurrent = current.pasados + current.fallados + current.bloqueados
  const totalPrevious = previous.pasados + previous.fallados + previous.bloqueados
  const tasaCurrent = totalCurrent > 0 ? (current.pasados / totalCurrent) * 100 : 0
  const tasaPrevious = totalPrevious > 0 ? (previous.pasados / totalPrevious) * 100 : 0
  const diffTasa = tasaCurrent - tasaPrevious
  const diffPasados = current.pasados - previous.pasados
  const diffFallados = current.fallados - previous.fallados
  return (
    <Row className="g-4 mb-4">
      <Col md={12}>
        <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
          <h6 className="fw-bold mb-3 text-secondary text-start d-flex align-items-center gap-2">
            <Activity size={18} /> {t('reportes.comparisonVsPrevious')}
          </h6>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <Badge bg="light" text="dark" className="me-2 border">{previous.build_name}</Badge>
              <span className="text-muted x-small">{t('reportes.vs')}</span>
              <Badge bg="primary" className="ms-2">{current.build_name}</Badge>
            </div>
          </div>
          <Row className="g-3 text-center">
            <Col md={2}>
              <div className="border rounded-3 p-3">
                <small className="text-muted d-block">{t('reportes.resolutionRate')}</small>
                <h5 className={`fw-bold mb-1 ${diffTasa >= 0 ? 'text-success' : 'text-danger'}`}>
                  {tasaCurrent.toFixed(1)}%
                </h5>
                <span className={`x-small fw-bold ${diffTasa >= 0 ? 'text-success' : 'text-danger'}`}>
                  {diffTasa >= 0 ? '+' : ''}{diffTasa.toFixed(1)}%
                </span>
              </div>
            </Col>
            <Col md={2}>
              <div className="border rounded-3 p-3">
                <small className="text-muted d-block">{t('reportes.passed')}</small>
                <h5 className="fw-bold mb-1 text-success">{current.pasados}</h5>
                <span className={`x-small fw-bold ${diffPasados >= 0 ? 'text-success' : 'text-danger'}`}>
                  {diffPasados >= 0 ? '+' : ''}{diffPasados}
                </span>
              </div>
            </Col>
            <Col md={2}>
              <div className="border rounded-3 p-3">
                <small className="text-muted d-block">{t('reportes.failed')}</small>
                <h5 className="fw-bold mb-1 text-danger">{current.fallados}</h5>
                <span className={`x-small fw-bold ${diffFallados <= 0 ? 'text-success' : 'text-danger'}`}>
                  {diffFallados >= 0 ? '+' : ''}{diffFallados}
                </span>
              </div>
            </Col>
            <Col md={2}>
              <div className="border rounded-3 p-3">
                <small className="text-muted d-block">{t('reportes.blocked')}</small>
                <h5 className="fw-bold mb-1 text-primary">{current.bloqueados}</h5>
                <span className="x-small text-muted">
                  anterior: {previous.bloqueados}
                </span>
              </div>
            </Col>
            <Col md={2}>
              <div className="border rounded-3 p-3">
                <small className="text-muted d-block">{t('reportes.coverage')}</small>
                <h5 className={`fw-bold mb-1 ${(comparison.coverage_delta || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                  {formatPercent(current.cobertura_porcentaje)}
                </h5>
                <span className={`x-small fw-bold ${(comparison.coverage_delta || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                  {(comparison.coverage_delta || 0) >= 0 ? '+' : ''}{Number(comparison.coverage_delta || 0).toFixed(1)}%
                </span>
              </div>
            </Col>
            <Col md={2}>
              <div className="border rounded-3 p-3">
                <small className="text-muted d-block">{t('reportes.bugs')}</small>
                <h5 className="fw-bold mb-1 text-warning">{formatInt(comparison.open_bugs_current)}</h5>
                <span className="x-small text-muted">{t('reportes.recurrentBugs')}: {formatInt(comparison.recurrent_bugs_current)}</span>
              </div>
            </Col>
          </Row>
        </Card>
      </Col>
    </Row>
  )
})()),


renderReportesWidget('priority', Object.keys(projectMetrics.por_prioridad).length > 0 ? (
  <Row className="g-4 mb-4">
    <Col md={12}>
      <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
        <h6 className="fw-bold mb-4 text-secondary text-start">{t('reportes.resultsByPriority')}</h6>
        <Table hover responsive className="mb-0">
          <thead>
            <tr>
              {isColumnVisible('priority', 'priority') && <th>{t('reportes.priority')}</th>}
              {isColumnVisible('priority', 'total') && <th className="text-center">{t('reportes.total')}</th>}
              {isColumnVisible('priority', 'passed') && <th className="text-center text-success">{t('reportes.passed')}</th>}
              {isColumnVisible('priority', 'failed') && <th className="text-center text-danger">{t('reportes.failed')}</th>}
              {isColumnVisible('priority', 'blocked') && <th className="text-center text-primary">{t('reportes.blocked')}</th>}
              {isColumnVisible('priority', 'pending') && <th className="text-center text-secondary">{t('reportes.notExecuted')}</th>}
              {isColumnVisible('priority', 'coverage') && <th className="text-center">{t('reportes.coverage')}</th>}
              {isColumnVisible('priority', 'success') && <th className="text-center">{t('reportes.executedSuccess')}</th>}
              {isColumnVisible('priority', 'bugs') && <th className="text-center">{t('reportes.openBugs')}</th>}
              {isColumnVisible('priority', 'risk') && <th className="text-center">{t('reportes.risk')}</th>}
            </tr>
          </thead>
          <tbody>
            {Object.entries(projectMetrics.por_prioridad).map(([prioridad, data]: [string, any]) => (
              <tr key={prioridad}>
                {isColumnVisible('priority', 'priority') && (
                  <td className="fw-bold text-capitalize" title={getBugPriorityPresentation(prioridad)?.title || prioridad}>
                    {getBugPriorityPresentation(prioridad)?.shortLabel || prioridad}
                  </td>
                )}
                {isColumnVisible('priority', 'total') && <td className="text-center">{data.total}</td>}
                {isColumnVisible('priority', 'passed') && <td className="text-center text-success fw-bold">{data.pasados}</td>}
                {isColumnVisible('priority', 'failed') && <td className="text-center text-danger fw-bold">{data.fallados}</td>}
                {isColumnVisible('priority', 'blocked') && <td className="text-center text-primary fw-bold">{data.bloqueados}</td>}
                {isColumnVisible('priority', 'pending') && <td className="text-center text-secondary fw-bold">{data.pendientes || 0}</td>}
                {isColumnVisible('priority', 'coverage') && <td className="text-center">{formatPercent(data.cobertura_porcentaje)}</td>}
                {isColumnVisible('priority', 'success') && <td className="text-center">{formatPercent(data.exito_sobre_ejecutados_porcentaje)}</td>}
                {isColumnVisible('priority', 'bugs') && <td className="text-center">{formatInt(data.bugs_abiertos)}</td>}
                {isColumnVisible('priority', 'risk') && <td className="text-center"><Badge bg={riskVariant(data.riesgo)}>{data.riesgo || 'BAJO'}</Badge></td>}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </Col>
  </Row>
) : null),


renderReportesWidget('suites', suiteTree.length > 0 ? (
  <Row className="g-4 mb-4">
    <Col md={12}>
      <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <h6 className="fw-bold text-secondary text-start d-flex align-items-center gap-2 m-0">
            <Folders size={18} /> {t('reportes.resultsBySuite')}
          </h6>
          <div className="d-flex gap-2">
            <Button variant="outline-secondary" size="sm" className="x-small fw-bold" onClick={() => setExpandedMetricSuites(new Set(collectSuiteIds(suiteTree)))}>
              Desplegar todo
            </Button>
            <Button variant="outline-secondary" size="sm" className="x-small fw-bold" onClick={() => setExpandedMetricSuites(new Set())}>
              Contraer todo
            </Button>
          </div>
        </div>
        <Table hover responsive className="mb-0">
          <thead>
            <tr>
              {isColumnVisible('suites', 'suite') && <th style={{ width: '40px' }}></th>}
              {isColumnVisible('suites', 'suite') && <th>{t('reportes.suite')}</th>}
              {isColumnVisible('suites', 'total') && <th className="text-center">{t('reportes.total')}</th>}
              {isColumnVisible('suites', 'passed') && <th className="text-center text-success">{t('reportes.passed')}</th>}
              {isColumnVisible('suites', 'failed') && <th className="text-center text-danger">{t('reportes.failed')}</th>}
              {isColumnVisible('suites', 'blocked') && <th className="text-center text-primary">{t('reportes.blocked')}</th>}
              {isColumnVisible('suites', 'pending') && <th className="text-center text-secondary">{t('reportes.notExecuted')}</th>}
              {isColumnVisible('suites', 'successExecuted') && <th className="text-center">{t('reportes.executedSuccess')}</th>}
              {isColumnVisible('suites', 'coverage') && <th className="text-center">{t('reportes.coverage')}</th>}
              {isColumnVisible('suites', 'successTotal') && <th className="text-center">{t('reportes.totalSuccess')}</th>}
              {isColumnVisible('suites', 'bugs') && <th className="text-center">{t('reportes.bugs')}</th>}
              {isColumnVisible('suites', 'risk') && <th className="text-center">{t('reportes.risk')}</th>}
              {isColumnVisible('suites', 'lastExecution') && <th className="text-center">{t('reportes.lastExecution')}</th>}
              {isColumnVisible('suites', 'time') && <th className="text-center">{t('reportes.time')}</th>}
            </tr>
          </thead>
          <tbody>
            <ReportSuiteRows
              nodes={suiteTree}
              options={{
                onOpenEvidence,
                t,
                isColumnVisible,
                visibleColumnCount,
                expandedMetricSuites,
                setExpandedMetricSuites,
                formatPercent,
                formatInt,
                riskVariant,
                formatHours,
                snapshotBugLinks,
                bugStatusIsOpen,
                canCreateBugs,
                creatingSnapshotBugId,
                createBugFromReportSnapshot,
              }}
            />
          </tbody>
        </Table>
      </Card>
    </Col>
  </Row>
) : null),


renderReportesWidget('trend', projectMetrics.historico_versions && projectMetrics.historico_versions.length > 1 ? (
  <Row className="g-4 mb-4">
    <Col md={12}>
      <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
        <h6 className="fw-bold mb-4 text-secondary text-start d-flex align-items-center gap-2">
        <BarChart3 size={18} /> {t('reportes.buildTrend')}
        </h6>
        <div style={{ height: '280px' }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
            <BarChart data={[...projectMetrics.historico_versions].reverse().map(h => ({
              name: h.build_name,
              pasados: h.pasados,
              fallados: h.fallados,
              bloqueados: h.bloqueados
            }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="pasados" name="Pasados" fill="#198754" radius={[4, 4, 0, 0]} />
              <Bar dataKey="fallados" name="Fallados" fill="#dc3545" radius={[4, 4, 0, 0]} />
              <Bar dataKey="bloqueados" name="Bloqueados" fill="#0d6efd" radius={[4, 4, 0, 0]} />
              <BugBuildTrendBars />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </Col>
  </Row>
) : null),

  ]
}
