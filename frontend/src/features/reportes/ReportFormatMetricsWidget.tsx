import type { ReactNode } from 'react'
import { Badge, Card, Col, Row } from 'react-bootstrap'
import { Layers3 } from 'lucide-react'
import { REPORT_VISIBLE_FORMATS } from './reportFormatVisibility'

type ReportFormatMetricsWidgetProps = {
  renderReportesWidget: (id: string, children: ReactNode, visible?: boolean) => ReactNode
  t: (key: string) => string
  formatInt: (value: any) => string
  formatMs: (value: any) => string
  projectMetrics: any
}

const FORMAT_ORDER = REPORT_VISIBLE_FORMATS
const FORMAT_LABEL_KEYS: Record<string, string> = {
  CLASICA: 'formatClassic',
  CONVERSACIONAL: 'formatConversational',
  API: 'formatApi',
}

const STATUS_LABEL_KEYS: Record<string, string> = {
  DISPONIBLE: 'metricsAvailable',
  EN_PREPARACION: 'metricsPreparing',
  SIN_DATOS: 'metricsNoData',
}

export function ReportFormatMetricsWidget({
  renderReportesWidget,
  t,
  formatInt,
  formatMs,
  projectMetrics,
}: ReportFormatMetricsWidgetProps) {
  const metrics = projectMetrics?.metricas_por_formato || {}
  const formats = FORMAT_ORDER.map((format) => metrics[format] || {
    format,
    status: 'SIN_DATOS',
    total: 0,
    executed: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    pending: 0,
    coverage_percent: 0,
    success_executed_percent: 0,
    specific: {},
  })

  return renderReportesWidget('formatMetrics', (
    <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
      <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
        <div>
          <h6 className="fw-bold mb-1 text-secondary text-start d-flex align-items-center gap-2">
            <Layers3 size={18} /> {t('reportes.formatMetrics')}
          </h6>
          <div className="small text-muted text-start">{t('reportes.formatMetricsDescription')}</div>
        </div>
        <Badge bg="light" text="dark" className="border">{t('reportes.formatsCount').replace('{count}', String(formats.length))}</Badge>
      </div>
      <Row className="g-3">
        {formats.map((item: any) => {
          const specific = item.specific || {}
          const isConversational = item.format === 'CONVERSACIONAL'
          const isApi = item.format === 'API'
          return (
            <Col md={6} xl={3} key={item.format}>
              <div className="border rounded-3 p-3 h-100">
                <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                  <strong>{FORMAT_LABEL_KEYS[item.format] ? t(`reportes.${FORMAT_LABEL_KEYS[item.format]}`) : item.format}</strong>
                  <Badge bg={item.status === 'DISPONIBLE' ? 'success' : item.status === 'EN_PREPARACION' ? 'warning' : 'secondary'} text={item.status === 'EN_PREPARACION' ? 'dark' : undefined}>
                    {item.status === 'DISPONIBLE' ? t('reportes.ready') : item.status === 'EN_PREPARACION' ? t('reportes.next') : t('reportes.noData')}
                  </Badge>
                </div>
                <div className="x-small text-muted mb-2">{STATUS_LABEL_KEYS[item.status] ? t(`reportes.${STATUS_LABEL_KEYS[item.status]}`) : t('reportes.statusNotReported')}</div>
                <div className="row g-2 small">
                  <Metric label={t('reportes.cases')} value={formatInt(item.total)} />
                  <Metric label={t('reportes.executed')} value={formatInt(item.executed)} />
                  <Metric label={t('reportes.passed')} value={formatInt(item.passed)} />
                  <Metric label={t('reportes.failed')} value={formatInt(item.failed)} />
                  <Metric label={t('reportes.blocked')} value={formatInt(item.blocked)} />
                  <Metric label={t('reportes.coverage')} value={`${Number(item.coverage_percent || 0).toFixed(1)}%`} />
                </div>
                {isConversational && Number(item.total || 0) > 0 && (
                  <div className="border-top mt-2 pt-2 x-small">
                    <div className="fw-bold text-secondary mb-1">{t('reportes.conversationalDetail')}</div>
                    <div className="d-flex justify-content-between"><span>{t('reportes.turns')}</span><strong>{formatInt(specific.turns)}</strong></div>
                    <div className="d-flex justify-content-between"><span>{t('reportes.p95Response')}</span><strong>{formatMs(specific.p95_latency_ms)}</strong></div>
                    <div className="d-flex justify-content-between"><span>{t('reportes.httpNon2xx')}</span><strong>{formatInt(specific.http_errors)}</strong></div>
                    <div className="d-flex justify-content-between"><span>{t('reportes.failedValidations')}</span><strong>{formatInt(specific.validation_failures)}</strong></div>
                    <div className="d-flex justify-content-between"><span>{t('reportes.memoryTools')}</span><strong>{formatInt(specific.memory_failures)} / {formatInt(specific.tool_failures)}</strong></div>
                  </div>
                )}
                {isApi && Number(item.total || 0) > 0 && (
                  <div className="border-top mt-2 pt-2 x-small">
                    <div className="fw-bold text-secondary mb-1">{t('reportes.apiDetail')}</div>
                    <div className="d-flex justify-content-between"><span>{t('reportes.requests')}</span><strong>{formatInt(specific.requests)}</strong></div>
                    <div className="d-flex justify-content-between"><span>{t('reportes.p95Response')}</span><strong>{formatMs(specific.p95_latency_ms)}</strong></div>
                    <div className="d-flex justify-content-between"><span>{t('reportes.httpNon2xx')}</span><strong>{formatInt(specific.http_errors)}</strong></div>
                    <div className="d-flex justify-content-between"><span>{t('reportes.failedValidations')}</span><strong>{formatInt(specific.validation_failures)}</strong></div>
                    <div className="d-flex justify-content-between"><span>{t('reportes.httpStatusGroups')}</span><strong>{formatInt(specific.status_2xx)} / {formatInt(specific.status_4xx)} / {formatInt(specific.status_5xx)}</strong></div>
                  </div>
                )}
                {item.status === 'EN_PREPARACION' && (
                  <div className="border-top mt-2 pt-2 x-small text-muted">{t('reportes.metricsPreparingDetail')}</div>
                )}
              </div>
            </Col>
          )
        })}
      </Row>
    </Card>
  ))
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="col-6"><div className="text-muted">{label}</div><strong>{value}</strong></div>
}
