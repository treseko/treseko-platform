import { Badge } from 'react-bootstrap'
import { useI18n } from '../../i18n'

type CompactValueLabels = {
  array: (count: number) => string
  empty: string
}

export const compactValue = (value: any, labels?: CompactValueLabels): string => {
  if (value === undefined || value === null || value === '') return '-'
  if (Array.isArray(value)) return value.length ? (labels?.array(value.length) ?? `${value.length} item(s)`) : (labels?.empty ?? '-')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function CompactObject({ value, emptyLabel }: { value: any; emptyLabel?: string }) {
  const { t } = useI18n()
  const entries = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : []
  if (!entries.length) return <div className="small text-muted">{emptyLabel ?? t('motorIa.noData')}</div>
  return (
    <div className="d-flex flex-column gap-1 small">
      {entries.map(([key, item]) => (
        <div key={key} className="d-flex gap-2 align-items-baseline">
          <span className="text-muted text-nowrap">{key}</span>
          <span className="text-break">{compactValue(item, { array: (count) => t('motorIa.compactItems', { count }), empty: t('motorIa.emptyValue') })}</span>
        </div>
      ))}
    </div>
  )
}

export function JsonTechnicalDetails({ value }: { value: any }) {
  const { t } = useI18n()
  return (
    <details className="mt-2">
      <summary className="small text-primary fw-semibold">{t('motorIa.viewTechnicalJson')}</summary>
      <pre className="bg-light border rounded-2 p-2 small mt-2 mb-0 overflow-auto">{JSON.stringify(value || {}, null, 2)}</pre>
    </details>
  )
}

export function MemoryCheckSummary({ checks }: { checks: any[] }) {
  const { t } = useI18n()
  if (!checks.length) return null
  return (
    <div className="d-flex flex-column gap-1 mb-2">
      {checks.map((check: any, index: number) => (
        <div key={index} className="small">
          <Badge bg={check.passed ? 'success' : 'danger'} className="me-1">{check.passed ? t('motorIa.ok') : t('motorIa.failed')}</Badge>
          {check.name || check.rule || t('motorIa.checkNumber', { number: index + 1 })}
          {check.actual ? ` · ${compactValue(check.actual, { array: (count) => t('motorIa.compactItems', { count }), empty: t('motorIa.emptyValue') })}` : ''}
        </div>
      ))}
    </div>
  )
}
