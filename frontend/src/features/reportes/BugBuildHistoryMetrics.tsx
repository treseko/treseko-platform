import { Col } from 'react-bootstrap'
import { Bar } from 'recharts'
import { useI18n } from '../../i18n'

type Props = { metrics: any; formatInt: (value: any) => string; formatPercent: (value: any) => string }

const firstNumber = (item: any, keys: string[]) => {
  for (const key of keys) {
    const value = Number(item?.[key])
    if (Number.isFinite(value)) return value
  }
  return 0
}

/**
 * Keeps report widgets compatible with historical API payloads while the
 * backend contract is being rolled out across environments.
 */
export function normalizeBuildHistoryRows(items: any[]): any[] {
  return items.map((item) => ({
    ...item,
    build_name: item?.build_name ?? item?.buildName ?? item?.nombre ?? item?.name ?? 'Build',
    ejecutados: firstNumber(item, ['ejecutados', 'total_ejecutados', 'executed', 'executed_count']),
    pasados: firstNumber(item, ['pasados', 'passed', 'passed_count']),
    fallados: firstNumber(item, ['fallados', 'failed', 'failed_count']),
    bloqueados: firstNumber(item, ['bloqueados', 'blocked', 'blocked_count']),
    bugs_resueltos: firstNumber(item, ['bugs_resueltos', 'resolved_in_build', 'resolved_bugs']),
    bugs_reabiertos: firstNumber(item, ['bugs_reabiertos', 'reopened_in_build', 'reopened_bugs']),
  }))
}

export function filterAvailableBuildHistoryRows(items: any[], currentBuildId?: string): any[] {
  return items.filter((item) => {
    const lifecycleState = String(item?.estado || '').toUpperCase()
    if (lifecycleState === 'PREPARACION' || lifecycleState === 'DRAFT') return false
    return item?.build_id === currentBuildId || Number(item?.ejecutados || 0) > 0
  })
}

export function sortBuildHistoryRows(items: any[]): any[] {
  return [...items].sort((left, right) => {
    const parse = (name: string) => {
      const match = String(name || '').match(/^(?:v)?(\d+)(?:\.(\d+))?(?:\.(\d+))?/i)
      return match ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] : [-1, -1, -1]
    }
    const a = parse(left.build_name)
    const b = parse(right.build_name)
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return b[index] - a[index]
    }
    return String(right.build_name).localeCompare(String(left.build_name))
  })
}

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
