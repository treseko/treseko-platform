import type { ReactNode } from 'react'
import { Badge, Card } from 'react-bootstrap'

export function ReportChartWidgets(options: any): ReactNode[] {
  const { renderReportesWidget, t, statusChartData, statusGradient, statusChartTotal, assignedStatusTotal, executedStatusTotal, formatInt, executionModeData, executionModeMax, hasExecutionModeData, caseTypeData } = options
  return [
          renderReportesWidget('statusChart', (
              <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
                <h6 className="fw-bold mb-4 text-secondary text-start">{t('reportes.executionStatus')}</h6>
                <div style={{ height: '260px' }}>
                  {statusChartData.length > 0 ? (
                    <div className="h-100 d-flex flex-column align-items-center justify-content-center gap-3">
                      <div
                        className="rounded-circle position-relative shadow-sm"
                        style={{
                          width: 150,
                          height: 150,
                          background: statusGradient,
                        }}
                        role="img"
                        aria-label={`Estado de ejecuciones: ${statusChartData.map(item => `${item.name} ${formatInt(item.value)}`).join(', ')}`}
                      >
                        <div
                          className="position-absolute top-50 start-50 translate-middle rounded-circle bg-white d-flex flex-column align-items-center justify-content-center text-center"
                          style={{ width: 86, height: 86 }}
                        >
                          <span className="fw-bold text-dark">{formatInt(statusChartTotal)}</span>
                          <span className="x-small text-muted">{t('reportes.cases')}</span>
                        </div>
                      </div>
                      <div className="d-flex flex-wrap justify-content-center gap-3">
                        {statusChartData.map(item => (
                          <div key={item.name} className="d-flex align-items-center gap-1 x-small text-muted">
                            <span className="rounded-1 d-inline-block" style={{ width: 10, height: 10, backgroundColor: item.color }}></span>
                            <span>{item.name}</span>
                            <strong className="text-dark">{formatInt(item.value)}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="h-100 d-flex align-items-center justify-content-center text-muted small">
                      Sin ejecuciones registradas para graficar.
                    </div>
                  )}
                </div>
                <div className="text-muted x-small text-center mt-2">
                  Total asignadas: {formatInt(assignedStatusTotal)}{'\u00b7'}{' '}
                  Total ejecutadas: {formatInt(executedStatusTotal)}
                </div>
              </Card>
          )),

          renderReportesWidget('executionModeChart', (
              <Card className="border-0 shadow-sm p-4 rounded-3 bg-white">
                <h6 className="fw-bold mb-4 text-secondary text-start">{t('reportes.executionMode')}</h6>
                <div style={{ height: '260px' }}>
                  {hasExecutionModeData ? (
                    <div className="h-100 d-flex flex-column justify-content-end">
                      <div className="d-flex align-items-end justify-content-around gap-3 flex-grow-1 border-bottom px-2 pb-2">
                        {executionModeData.map(item => {
                          const heightPercent = item.cantidad > 0 ? Math.max(12, (item.cantidad / executionModeMax) * 100) : 0
                          return (
                            <div key={item.name} className="d-flex flex-column align-items-center justify-content-end h-100 flex-fill" style={{ minWidth: 74 }}>
                              <div className="fw-bold small text-dark mb-1">{formatInt(item.cantidad)}</div>
                              <div
                                className="rounded-top shadow-sm w-100"
                                style={{
                                  maxWidth: 72,
                                  height: `${heightPercent}%`,
                                  minHeight: item.cantidad > 0 ? 18 : 0,
                                  backgroundColor: item.fill,
                                  opacity: item.cantidad > 0 ? 1 : 0.18,
                                }}
                                title={`${item.name}: ${formatInt(item.cantidad)}`}
                              ></div>
                            </div>
                          )
                        })}
                      </div>
                      <div className="d-flex justify-content-around gap-3 pt-2 px-2">
                        {executionModeData.map(item => (
                          <div key={item.name} className="text-center x-small text-muted flex-fill" style={{ minWidth: 74 }}>
                            <span className="rounded-1 d-inline-block me-1" style={{ width: 9, height: 9, backgroundColor: item.fill }}></span>
                            {item.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="h-100 d-flex align-items-center justify-content-center text-muted small">
                      Sin ejecuciones reales para graficar por modo.
                    </div>
                  )}
                </div>
                {caseTypeData.length > 0 && (
                  <div className="border-top mt-3 pt-3">
                    <div className="x-small text-muted fw-bold text-uppercase mb-2">{t('reportes.caseType')}</div>
                    <div className="d-flex flex-wrap gap-2">
                      {caseTypeData.map(item => (
                        <Badge key={item.name} bg="light" text="dark" className="border">
                          {item.name}: {formatInt(item.cantidad)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
          )),

  ]
}
