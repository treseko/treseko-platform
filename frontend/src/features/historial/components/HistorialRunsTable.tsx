import { Badge, Button, Card, Table } from 'react-bootstrap'
import { AlertTriangle, Eye } from 'lucide-react'
import { EvidenceList } from '../RunDetailModal'
import { getEffectiveRunExecutionMode, getExecutionModeBadge } from '../mappers/historialMappers'

type Props = {
  runs: any[]
  getStatusColor: (status: string) => string
  onOpenEvidence: (attachment: any) => void
  onOpenRunDetail: (runId: string) => void
  canViewDetail?: boolean
  canViewEvidence?: boolean
}

export function HistorialRunsTable({
  runs,
  getStatusColor,
  onOpenEvidence,
  onOpenRunDetail,
  canViewDetail = true,
  canViewEvidence = true,
}: Props) {
  return (
    <Card className="border-0 shadow-sm rounded-3 bg-white p-4 history-runs-card">
      <Table responsive hover size="sm" className="align-middle border-0 history-runs-table">
        <colgroup>
          <col className="history-col-run" />
          <col className="history-col-date" />
          <col className="history-col-build" />
          <col className="history-col-mode" />
          <col className="history-col-env" />
          <col className="history-col-owner" />
          <col className="history-col-counts" />
          <col className="history-col-evidence" />
          <col className="history-col-verdict" />
          <col className="history-col-actions" />
        </colgroup>
        <thead className="bg-light">
          <tr className="x-small text-muted text-uppercase border-bottom">
            <th className="ps-3 py-3 border-0">Run ID</th>
            <th className="border-0 text-dark">Fecha / Hora</th>
            <th className="border-0 text-dark">Build</th>
            <th className="border-0 text-dark text-center">Ejecutado con</th>
            <th className="border-0 text-dark">Ambiente / Dataset</th>
            <th className="border-0 text-dark">Responsable</th>
            <th className="border-0 text-dark text-center">P/F/B/S</th>
            <th className="border-0 text-dark text-center">Evidencias</th>
            <th className="border-0 text-dark text-center">Verdict</th>
            <th className="border-0 text-end pe-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {runs.map(run => {
            const mode = getEffectiveRunExecutionMode(run)
            const pendingAiReview = Number(run.aiReviewPending || 0)
            const evidences = Array.isArray(run.evidencias) ? run.evidencias : []
            const visibleEvidences = evidences.slice(0, 3)
            const hiddenEvidenceCount = Math.max(0, evidences.length - visibleEvidences.length)
            return (
              <tr key={run.id || run.runId} className="border-bottom">
                <td className="ps-3 py-2 fw-bold text-dark">{run.runId}</td>
                <td className="small text-dark">{run.date}</td>
                <td>
                  <div className="small fw-bold text-dark">{run.buildName || run.suite}</div>
                  {run.componentName && <div className="x-small text-muted">{run.componentName}</div>}
                </td>
                <td className="text-center">
                  <div className="d-inline-flex align-items-center justify-content-center gap-1">
                    <Badge bg={getExecutionModeBadge(mode.summary)} text={mode.summary === 'MIXTO' ? 'dark' : undefined} className="x-small">
                      {mode.label}
                    </Badge>
                  </div>
                  {mode.detail && <div className="x-small text-muted mt-1">{mode.detail}</div>}
                </td>
                <td>
                  <div className="small text-dark">{run.environmentName || '-'}</div>
                  <div className="x-small text-muted">{run.datasetName || 'Sin dataset'}</div>
                </td>
                <td><Badge bg="light" text="dark" className="border x-small fw-normal">{run.runner}</Badge></td>
                <td className="text-center small fw-bold">
                  <span className="text-success">{run.passed}</span> / <span className="text-danger">{run.failed}</span> / <span className="text-primary">{run.blocked}</span> / <span className="text-muted">{run.pending}</span>
                </td>
                <td className="text-center">
                  <div className="d-flex justify-content-center align-items-center gap-1 flex-wrap">
                    {canViewEvidence ? (
                      <>
                        <EvidenceList items={visibleEvidences} onOpenEvidence={onOpenEvidence} />
                        {hiddenEvidenceCount > 0 && (
                          <Badge bg="light" text="dark" className="border x-small" title={`${hiddenEvidenceCount} evidencia(s) adicionales en el detalle`}>
                            +{hiddenEvidenceCount}
                          </Badge>
                        )}
                      </>
                    ) : <span className="text-muted x-small">Sin acceso</span>}
                  </div>
                </td>
                <td className="text-center" style={{ width: '120px' }}>
                  <Badge bg={getStatusColor(run.status)} className="w-100 x-small text-uppercase shadow-sm">
                    {run.status}
                  </Badge>
                </td>
                <td className="text-end pe-3">
                  <div className="d-inline-flex align-items-center justify-content-end gap-2">
                    {canViewDetail && (
                      <Button variant="outline-primary" size="sm" className="x-small d-inline-flex align-items-center gap-1" onClick={() => onOpenRunDetail(run.id || run.runId)}>
                        <Eye size={13} /> Ver detalle
                      </Button>
                    )}
                    {pendingAiReview > 0 && (
                      <span
                        className="history-ai-review-warning"
                        title={`${pendingAiReview} ejecucion${pendingAiReview === 1 ? '' : 'es'} IA requiere${pendingAiReview === 1 ? '' : 'n'} revision`}
                        aria-label="Revision IA pendiente"
                      >
                        <AlertTriangle size={13} />
                        <span className="visually-hidden">Revision IA pendiente</span>
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
          {runs.length === 0 && (
            <tr>
              <td colSpan={10} className="text-center text-muted py-5 small">No se encontraron ejecuciones con los filtros actuales.</td>
            </tr>
          )}
        </tbody>
      </Table>
    </Card>
  )
}
