import type { ReactNode } from 'react'
import { Row, Col, Card, Badge, Button } from 'react-bootstrap'
import { Activity } from 'lucide-react'

type ReportAiMetricsWidgetProps = {
  renderReportesWidget: (id: string, children: ReactNode, visible?: boolean) => ReactNode
  t: (key: string) => string
  aiMetrics: any
  formatInt: (value: any) => string
  formatMoney: (value: any) => string
  formatMs: (value: any) => string
  workflowNodeSummary: string
  isAiBlockVisible: (block: string) => boolean
  aiModels: any[]
  aiFailureCategories: any[]
  aiErrorCodes: any[]
  readableAiLabel: (value: string) => string
  projectMetrics: any
  currentBuildId: string
  onOpenHistorial?: (filters?: Record<string, any>, runId?: string) => void
  showFeedback: (title: string, message: string, variant?: string) => void
}

export function ReportAiMetricsWidget({
  renderReportesWidget,
  t,
  aiMetrics,
  formatInt,
  formatMoney,
  formatMs,
  workflowNodeSummary,
  isAiBlockVisible,
  aiModels,
  aiFailureCategories,
  aiErrorCodes,
  readableAiLabel,
  projectMetrics,
  currentBuildId,
  onOpenHistorial,
  showFeedback,
}: ReportAiMetricsWidgetProps) {
  const hasExecutions = Number(aiMetrics?.executions || 0) > 0

  return renderReportesWidget('aiMetrics', hasExecutions ? (
    <Row className="g-4 mb-4">
      <Col md={12}>
        <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
          <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
            <div>
              <h6 className="fw-bold mb-1 text-secondary text-start d-flex align-items-center gap-2">
                <Activity size={18} /> {t('reportes.aiMetrics')}
              </h6>
              <div className="small text-muted text-start">{t('reportes.aiMetricsDescription')}</div>
            </div>
            {Number(aiMetrics.tokens_missing_executions || 0) > 0 && (
              <Badge bg="warning" text="dark">{formatInt(aiMetrics.tokens_missing_executions)} ejec. sin usage del proveedor</Badge>
            )}
          </div>
          {isAiBlockVisible('summary') && (
            <Row className="g-3 text-center">
              {[
                { l: 'Ejecuciones IA', v: formatInt(aiMetrics.executions), s: `${formatInt(aiMetrics.passed)} pasadas / ${formatInt(aiMetrics.failed)} fallidas / ${formatInt(aiMetrics.blocked)} bloqueadas`, c: 'primary' },
                { l: 'Revision IA', v: formatInt(aiMetrics.human_review_pending || aiMetrics.human_review_required), s: `${formatInt(aiMetrics.human_review_reviewed)} revisadas / ${formatInt(aiMetrics.human_review_required)} requeridas`, c: Number(aiMetrics.human_review_pending || aiMetrics.human_review_required || 0) > 0 ? 'warning' : 'success' },
                { l: 'Confianza promedio', v: `${Number(aiMetrics.avg_confidence || 0).toFixed(0)}%`, s: 'solo ejecuciones con confianza', c: Number(aiMetrics.avg_confidence || 0) >= 80 ? 'success' : 'warning' },
                { l: 'Tokens reportados', v: formatInt(aiMetrics.total_tokens), s: `${formatInt(aiMetrics.tokens_reported_executions)} ejecuciones con usage`, c: Number(aiMetrics.total_tokens || 0) > 0 ? 'info' : 'secondary' },
                { l: 'Costo estimado', v: formatMoney(aiMetrics.estimated_cost), s: 'segun costo configurado', c: 'success' },
                { l: 'Latencia IA', v: formatMs(aiMetrics.latency_ms), s: `promedio ${formatMs(aiMetrics.avg_latency_ms)}`, c: 'dark' },
                { l: 'Trazas workflow', v: formatInt(aiMetrics.workflow_traces), s: workflowNodeSummary, c: 'primary' },
              ].map((item, index) => {
                const isReviewCard = item.l === 'Revision IA'
                return (
                  <Col md={4} xl={2} key={index}>
                    <div className={`border rounded-3 p-3 h-100 ${isReviewCard ? 'bg-warning-subtle' : ''}`}>
                      <small className="text-muted fw-bold text-uppercase">{item.l}</small>
                      <h5 className={`fw-bold my-1 text-${item.c}`}>{item.v}</h5>
                      <span className="text-muted x-small">{item.s}</span>
                      {isReviewCard && Number(aiMetrics.human_review_pending || aiMetrics.human_review_required || 0) > 0 && (
                        <Button variant="outline-warning" size="sm" className="w-100 mt-2 fw-bold" onClick={() => {
                          const historyBuildId = projectMetrics.build_id || currentBuildId || null
                          if (!historyBuildId) {
                            showFeedback(t('reportes.history'), t('reportes.selectBuildForAiReview'), 'warning')
                            return
                          }
                          onOpenHistorial?.({ origin: 'IA', ai_review_status: 'REQUIERE_REVISION', build_id: historyBuildId })
                        }}>{t('reportes.reviewInHistory')}</Button>
                      )}
                    </div>
                  </Col>
                )
              })}
            </Row>
          )}
          <Row className="g-3 mt-1">
            {isAiBlockVisible('models') && <AiMetricList title={t('reportes.modelsUsed')} items={aiModels} label={value => value} empty={t('reportes.noModelReported')} />}
            {isAiBlockVisible('categories') && <AiMetricList title={t('reportes.aiCategories')} items={aiFailureCategories} label={readableAiLabel} empty={t('reportes.noCategories')} />}
            {isAiBlockVisible('errorCodes') && <AiMetricList title={t('reportes.aiErrorCodes')} items={aiErrorCodes} label={readableAiLabel} empty={t('reportes.noErrorCodes')} />}
          </Row>
        </Card>
      </Col>
    </Row>
  ) : (
    <Row className="g-4 mb-4">
      <Col md={12}>
        <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
          <div className="d-flex align-items-start gap-2">
            <Activity size={18} className="text-primary flex-shrink-0 mt-1" />
            <div>
              <h6 className="fw-bold mb-1 text-secondary text-start">{t('reportes.aiMetrics')}</h6>
              <div className="small text-muted text-start">{t('reportes.aiMetricsDescription')}</div>
              <div className="reportes-empty-state mt-3">
                <strong className="d-block text-secondary">{t('reportes.noAiMetrics')}</strong>
                <span className="small text-muted">{t('reportes.noAiMetricsDescription')}</span>
              </div>
            </div>
          </div>
        </Card>
      </Col>
    </Row>
  ))
}

function AiMetricList({ title, items, label, empty }: { title: string; items: any[]; label: (value: string) => string; empty: string }) {
  return (
    <Col md={4}>
      <div className="border rounded-3 p-3 h-100">
        <div className="x-small text-muted fw-bold text-uppercase mb-2">{title}</div>
        {items.length > 0 ? items.map(([value, count]: any) => (
          <div key={value} className="d-flex justify-content-between small border-top py-1">
            <span className={title.includes('model') ? 'font-monospace' : undefined}>{label(value)}</span>
            <strong>{count}</strong>
          </div>
        )) : <div className="small text-muted">{empty}</div>}
      </div>
    </Col>
  )
}
