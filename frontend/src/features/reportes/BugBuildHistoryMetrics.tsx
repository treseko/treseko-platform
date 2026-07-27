import { Col } from 'react-bootstrap'
import { Bar } from 'recharts'

type Props = { metrics: any; formatInt: (value: any) => string; formatPercent: (value: any) => string }

export function BugBuildHistoryMetrics({ metrics, formatInt, formatPercent }: Props) {
  const items = [
    ['Resueltos en build', formatInt(metrics.resolved_in_build)],
    ['Cerrados en build', formatInt(metrics.closed_in_build)],
    ['Cierre administrativo', formatInt(metrics.closed_without_fix_in_build)],
    ['Reabiertos en build', formatInt(metrics.reopened_in_build)],
    ['Tasa de resolución', formatPercent(metrics.resolution_rate)],
    ['Atribución desconocida', formatInt(metrics.closure_attribution_unknown)],
  ]
  return <>{items.map(([label, value]) => (
    <Col xs={6} key={label}><div className="border rounded-3 p-2 h-100">
      <div className="x-small text-muted fw-bold text-uppercase">{label}</div><div className="fw-bold">{value}</div>
    </div></Col>
  ))}</>
}

export function BugBuildTrendBars() {
  return <><Bar dataKey="bugs_resueltos" name="Bugs resueltos" fill="#20c997" radius={[4, 4, 0, 0]} />
    <Bar dataKey="bugs_reabiertos" name="Bugs reabiertos" fill="#fd7e14" radius={[4, 4, 0, 0]} /></>
}
