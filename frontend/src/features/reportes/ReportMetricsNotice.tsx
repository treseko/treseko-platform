import { Alert, Button } from 'react-bootstrap'
import { useI18n } from '../../i18n'

export function ReportMetricsNotice({ error, hasPreviousData, loading, onRetry }: {
  error?: string; hasPreviousData: boolean; loading: boolean; onRetry: () => void
}) {
  const { t } = useI18n()
  if (!error) return null
  return <Alert variant="danger" role="alert">
    <div>{error}</div>
    {hasPreviousData && <div>{t('reportes.metricsStaleNotice')}</div>}
    <Button variant="outline-danger" size="sm" className="mt-2" onClick={onRetry} disabled={loading}>{t('common.retry')}</Button>
  </Alert>
}
