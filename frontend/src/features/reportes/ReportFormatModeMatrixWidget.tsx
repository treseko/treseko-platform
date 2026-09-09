import type { ReactNode } from 'react'
import { Badge, Card, Table } from 'react-bootstrap'
import { Table2 } from 'lucide-react'
import { REPORT_VISIBLE_FORMATS } from './reportFormatVisibility'

type ReportFormatModeMatrixWidgetProps = {
  renderReportesWidget: (id: string, children: ReactNode, visible?: boolean) => ReactNode
  t: (key: string) => string
  formatInt: (value: any) => string
  projectMetrics: any
}

const FORMAT_ORDER = REPORT_VISIBLE_FORMATS
const MODE_ORDER = ['MANUAL', 'AUTOMATIZADA', 'IA', 'EXTERNA', 'SIN_EJECUTAR']
const FORMAT_LABEL_KEYS: Record<string, string> = { CLASICA: 'formatClassic', CONVERSACIONAL: 'formatConversational', API: 'formatApi' }
const MODE_LABEL_KEYS: Record<string, string> = { MANUAL: 'modeManual', AUTOMATIZADA: 'modeAutomated', IA: 'modeAi', EXTERNA: 'modeExternal', SIN_EJECUTAR: 'modeNotExecuted' }

export function ReportFormatModeMatrixWidget({
  renderReportesWidget,
  t,
  formatInt,
  projectMetrics,
}: ReportFormatModeMatrixWidgetProps) {
  const matrix = projectMetrics?.metricas_por_formato_y_modo || {}
  const hasData = FORMAT_ORDER.some((format) => MODE_ORDER.some((mode) => Number(matrix?.[format]?.[mode]?.total || 0) > 0))

  return renderReportesWidget('formatModeMatrix', (
    <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
      <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
        <div>
          <h6 className="fw-bold mb-1 text-secondary text-start d-flex align-items-center gap-2">
            <Table2 size={18} /> {t('reportes.formatModeMatrix')}
          </h6>
          <div className="small text-muted text-start">
            {t('reportes.formatModeMatrixDescription')}
          </div>
        </div>
        <Badge bg="light" text="dark" className="border">{t('reportes.currentBuild')}</Badge>
      </div>
      {hasData ? (
        <div className="table-responsive">
          <Table bordered hover size="sm" className="align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th scope="col">{t('reportes.format')}</th>
                {MODE_ORDER.map((mode) => <th scope="col" className="text-center" key={mode}>{t(`reportes.${MODE_LABEL_KEYS[mode]}`)}</th>)}
                <th scope="col" className="text-center">{t('reportes.total')}</th>
              </tr>
            </thead>
            <tbody>
              {FORMAT_ORDER.map((format) => {
                const rowTotal = MODE_ORDER.reduce((sum, mode) => sum + Number(matrix?.[format]?.[mode]?.total || 0), 0)
                return (
                  <tr key={format}>
                    <th scope="row">{t(`reportes.${FORMAT_LABEL_KEYS[format]}`)}</th>
                    {MODE_ORDER.map((mode) => {
                      const bucket = matrix?.[format]?.[mode] || {}
                      const total = Number(bucket.total || 0)
                      const pending = Number(bucket.pending || 0)
                      return (
                        <td className="text-center" key={mode}>
                          <strong>{formatInt(total)}</strong>
                          {total > 0 && mode !== 'SIN_EJECUTAR' && <div className="x-small text-muted">{t('reportes.executedCount').replace('{count}', formatInt(bucket.executed))}</div>}
                          {total > 0 && mode === 'SIN_EJECUTAR' && <div className="x-small text-muted">{t('reportes.pendingCount').replace('{count}', formatInt(pending))}</div>}
                        </td>
                      )
                    })}
                    <td className="text-center fw-bold">{formatInt(rowTotal)}</td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </div>
      ) : (
        <div className="text-muted small py-3">{t('reportes.noAssignedCasesBuild')}</div>
      )}
      <div className="x-small text-muted mt-3">
        “{t('reportes.notExecuted')}” conserva los casos de la build que todavía no tienen un modo persistido.
      </div>
    </Card>
  ))
}
