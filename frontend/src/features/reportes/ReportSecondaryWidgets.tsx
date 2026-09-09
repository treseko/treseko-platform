import { Row, Col, Card, Badge, Button, Table } from 'react-bootstrap'
import { BarChart3, Activity, Folders, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { filterAvailableBuildHistoryRows, normalizeBuildHistoryRows, sortBuildHistoryRows } from './BugBuildHistoryMetrics'
import { ReportSuiteRows } from './ReportSuiteRows'
import { createBugLocalizedLabels } from '../bugs/bugPresentation'

export function ReportSecondaryWidgets(options: any) {
  const {
    renderReportesWidget, t, projectMetrics, comparison, formatPercent, formatInt,
    isColumnVisible, riskVariant, suiteTree, setExpandedMetricSuites, collectSuiteIds,
    expandedMetricSuites, onOpenEvidence, visibleColumnCount, formatHours,
    snapshotBugLinks, bugStatusIsOpen, canCreateBugs, creatingSnapshotBugId,
    createBugFromReportSnapshot,
  } = options
  const bugLabels = createBugLocalizedLabels(t)
  const riskLabel = (value: any) => {
    const normalized = String(value || '').toUpperCase()
    const key = normalized === 'ALTO' || normalized === 'ALTA' ? 'reportes.riskHigh'
      : normalized === 'MEDIO' || normalized === 'MEDIA' ? 'reportes.riskMedium'
        : 'reportes.riskLow'
    return ['ALTO', 'ALTA', 'MEDIO', 'MEDIA', 'BAJO', 'BAJA'].includes(normalized)
      ? t(key)
      : value ? String(value) : t('common.notAvailable')
  }
  return [
renderReportesWidget('buildComparison', (() => {
  const buildHistory = filterAvailableBuildHistoryRows(normalizeBuildHistoryRows(Array.isArray(projectMetrics.historico_versions) ? projectMetrics.historico_versions : []), projectMetrics.build_id)
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
              <Activity size={18} /> {t('reportes.comparisonVsPrevious')}
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
                  {t('reportes.previousBuild')}: {previous.bloqueados}
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
                  <td className="fw-bold text-capitalize" title={bugLabels.priority(prioridad)}>
                    {bugLabels.priority(prioridad)}
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
                {isColumnVisible('priority', 'risk') && <td className="text-center"><Badge bg={riskVariant(data.riesgo)}>{riskLabel(data.riesgo)}</Badge></td>}
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
              {t('reportes.expandAll')}
            </Button>
            <Button variant="outline-secondary" size="sm" className="x-small fw-bold" onClick={() => setExpandedMetricSuites(new Set())}>
              {t('reportes.collapseAll')}
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


(() => {
  const buildHistory = filterAvailableBuildHistoryRows(normalizeBuildHistoryRows(Array.isArray(projectMetrics.historico_versions) ? projectMetrics.historico_versions : []), projectMetrics.build_id)
  const trendData = sortBuildHistoryRows(buildHistory)
  const hasTrendSeries = trendData.some((item) => item.pasados > 0 || item.fallados > 0 || item.bloqueados > 0 || item.bugs_resueltos > 0 || item.bugs_reabiertos > 0)
  const hasBugTrend = trendData.some((item) => item.bugs_resueltos > 0 || item.bugs_reabiertos > 0)
  const trendSeries = [
    { key: 'pasados', label: t('reportes.passed'), color: '#198754' },
    { key: 'fallados', label: t('reportes.failed'), color: '#dc3545' },
    { key: 'bloqueados', label: t('reportes.blocked'), color: '#0d6efd' },
    ...(hasBugTrend ? [
      { key: 'bugs_resueltos', label: t('reportes.resolvedBugs'), color: '#20c997' },
      { key: 'bugs_reabiertos', label: t('reportes.reopenedBugs'), color: '#fd7e14' },
    ] : []),
  ]
  const actualBuild = trendData.find((item) => item.build_id === projectMetrics.build_id) || null
  const trendMaxByKey = Object.fromEntries(trendSeries.map((series) => [series.key, Math.max(1, ...trendData.map((item) => Number(item[series.key] || 0)))]))
  const getTrendDelta = (item: any, key: string) => {
    if (!actualBuild || item.build_id === actualBuild.build_id || Number(item.ejecutados || 0) <= 0 || Number(actualBuild.ejecutados || 0) <= 0) return null
    const actualValue = Number(actualBuild[key] || 0)
    const comparedValue = Number(item[key] || 0)
    const higherIsBetter = key === 'pasados' || key === 'bugs_resueltos'
    if (comparedValue === 0) {
      return actualValue === 0
        ? { label: '0%', tone: 'neutral', title: t('reportes.noVariationCurrentBuild') }
        : {
          label: t('reportes.new'),
          tone: higherIsBetter ? 'positive' : 'negative',
          title: higherIsBetter ? t('reportes.currentBuildAddsMetric') : t('reportes.currentBuildAddsProblem'),
        }
    }
    const change = ((actualValue - comparedValue) / Math.abs(comparedValue)) * 100
    const improved = higherIsBetter ? change > 0 : change < 0
    return {
      label: `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`,
      tone: change === 0 ? 'neutral' : improved ? 'positive' : 'negative',
      title: improved ? t('reportes.currentBuildImproves') : t('reportes.currentBuildWorsens'),
    }
  }
  const getOverallTrend = (item: any) => {
    if (!Number(item.ejecutados || 0)) return { label: t('reportes.noData'), tone: 'neutral' }
    if (item.build_id === actualBuild?.build_id) return { label: t('reportes.current'), tone: 'neutral' }
    if (!actualBuild || Number(actualBuild.ejecutados || 0) <= 0) return { label: t('reportes.noReference'), tone: 'neutral' }
    const actualSuccess = Number(actualBuild.pasados || 0) / Number(actualBuild.ejecutados || 1)
    const comparedSuccess = Number(item.pasados || 0) / Number(item.ejecutados || 1)
    const actualRisk = (Number(actualBuild.fallados || 0) + Number(actualBuild.bloqueados || 0)) / Number(actualBuild.ejecutados || 1)
    const comparedRisk = (Number(item.fallados || 0) + Number(item.bloqueados || 0)) / Number(item.ejecutados || 1)
    if (actualSuccess > comparedSuccess && actualRisk <= comparedRisk) return { label: t('reportes.currentBetter'), tone: 'positive' }
    if (actualSuccess < comparedSuccess || actualRisk > comparedRisk) return { label: t('reportes.currentWorse'), tone: 'negative' }
    return { label: t('reportes.noChange'), tone: 'neutral' }
  }
  return renderReportesWidget('trend', trendData.length > 1 ? (
  <Row className="reportes-build-trend-grid-row g-4 mb-4">
    <Col md={12}>
      <Card className="reportes-build-trend-card border-0 shadow-sm p-4 rounded-3 bg-white">
        <h6 className="fw-bold mb-3 text-secondary text-start d-flex align-items-center gap-2">
        <BarChart3 size={18} /> {t('reportes.buildTrend')}
        </h6>
        {hasTrendSeries ? <div className="reportes-build-trend-content">
          <div className="reportes-build-trend-legend" aria-label={t('reportes.trendLegend')}>
            {trendSeries.map((series) => <span key={series.key}><i style={{ backgroundColor: series.color }} />{series.label}</span>)}
            <span className="reportes-build-trend-compare-hint">{t('reportes.comparisonAgainst')}: {actualBuild?.build_name || t('reportes.currentBuild')}</span>
          </div>
          <div
            className="reportes-build-trend-matrix"
            role="table"
            aria-label={t('reportes.buildResultsComparison')}
            style={{ gridTemplateColumns: `minmax(7.5rem, 1.1fr) minmax(7.5rem, .9fr) repeat(${trendSeries.length}, minmax(7rem, 1fr))` }}
          >
            <div className="reportes-build-trend-matrix-row is-header" role="row">
              <span role="columnheader">{t('reportes.build')}</span>
              <span role="columnheader">{t('reportes.vsCurrentBuild')}</span>
              {trendSeries.map((series) => <span role="columnheader" key={series.key}><i style={{ backgroundColor: series.color }} />{series.label}</span>)}
            </div>
            {trendData.map((item) => <div className={`reportes-build-trend-matrix-row ${item.build_id === actualBuild?.build_id ? 'is-current' : ''}`} role="row" key={item.build_id || item.build_name}>
              <strong role="rowheader" title={item.build_name}>{item.build_name}</strong>
              {(() => {
                const overallTrend = getOverallTrend(item)
                const Icon = overallTrend.tone === 'positive' ? TrendingUp : overallTrend.tone === 'negative' ? TrendingDown : Minus
                return <div className={`reportes-build-trend-overall is-${overallTrend.tone}`} role="cell">
                  <Icon size={15} aria-hidden="true" />
                  <strong>{overallTrend.label}</strong>
                </div>
              })()}
              {trendSeries.map((series) => {
                const value = Number(item[series.key] || 0)
                const delta = getTrendDelta(item, series.key)
                const previousValue = item.build_id === actualBuild?.build_id || !actualBuild || Number(item.ejecutados || 0) <= 0 ? null : value
                const actualValue = Number(actualBuild?.[series.key] || 0)
                const scale = Number(trendMaxByKey[series.key] || 1)
                return <div className="reportes-build-trend-matrix-cell" role="cell" key={series.key}>
                  <div className="reportes-build-trend-candles" aria-hidden="true">
                    {previousValue !== null && <span className="is-previous" style={{ height: `${Math.max(3, (previousValue / scale) * 100)}%` }} />}
                    <span className="is-current" style={{ height: actualBuild ? `${Math.max(3, (actualValue / scale) * 100)}%` : '3%', backgroundColor: series.color }} />
                  </div>
                  <div className="reportes-build-trend-cell-values">
                    <strong>{value}</strong>
                    {delta && <span className={`reportes-build-trend-delta is-${delta.tone}`} title={delta.title}>{delta.label}</span>}
                  </div>
                </div>
              })}
            </div>)}
          </div>
        </div> : <div className="reportes-build-trend-empty small text-muted">{t('reportes.noExecutionsSelectedBuilds')}</div>}
      </Card>
    </Col>
  </Row>
) : null)
})(),

  ]
}
