import { Card, Button } from 'react-bootstrap'
import { BarChart3 } from 'lucide-react'

export function ReportEmptyState({ t, loadProjectMetrics }: any) {
  return (
  <Card className="border-0 shadow-sm p-5 rounded-3 bg-white text-center">
    <BarChart3 size={48} className="text-muted mb-3" />
    <h5 className="text-muted">{t('reportes.noMetrics')}</h5>
    <p className="text-muted small">{t('reportes.selectProjectForReports')}</p>
    <Button variant="primary" size="sm" className="fw-bold px-4 rounded-pill" onClick={() => loadProjectMetrics()}>
      {t('reportes.loadMetrics')}
    </Button>
  </Card>

  )
}
