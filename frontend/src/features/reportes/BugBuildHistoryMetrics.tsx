import { Col } from 'react-bootstrap'
import { Bar } from 'recharts'
import { useI18n } from '../../i18n'

type Props = { metrics: any; formatInt: (value: any) => string; formatPercent: (value: any) => string }

export function BugBuildHistoryMetrics({ metrics, formatInt, formatPercent }: Props) {
  const { t } = useI18n()
  const items = [
    [t('reportes.resolvedInBuild'), formatInt(metrics.resolved_in_build)],
    [t('reportes.closedInBuild'), formatInt(metrics.closed_in_build)],
    [t('reportes.administrativeClosure'), formatInt(metrics.closed_without_fix_in_build)],
    [t('reportes.reopenedInBuild'), formatInt(metrics.reopened_in_build)],
    [t('reportes.resolutionRate'), formatPercent(metrics.resolution_rate)],
    [t('reportes.unknownAttribution'), formatInt(metrics.closure_attribution_unknown)],
  ]
  return <>{items.map(([label, value]) => (
    <Col xs={6} key={label}><div className="border rounded-3 p-2 h-100">
      <div className="x-small text-muted fw-bold text-uppercase">{label}</div><div className="fw-bold">{value}</div>
    </div></Col>
  ))}</>
}

export function BugBuildTrendBars() {
  const { t } = useI18n()
  return <><Bar dataKey="bugs_resueltos" name={t('reportes.resolvedBugs')} fill="#20c997" radius={[4, 4, 0, 0]} />
    <Bar dataKey="bugs_reabiertos" name={t('reportes.reopenedBugs')} fill="#fd7e14" radius={[4, 4, 0, 0]} /></>
}
