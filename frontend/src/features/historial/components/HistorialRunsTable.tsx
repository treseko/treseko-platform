import { Badge, Button, Card, Table } from 'react-bootstrap'
import { AlertTriangle, Eye } from 'lucide-react'
import { useI18n } from '../../../i18n'
import { EvidenceList } from '../EvidenceList'
import { getEffectiveRunExecutionMode, getExecutionModeBadge } from '../mappers/historialMappers'

type Props = {
  runs: any[]
  loading?: boolean
  getStatusColor: (status: string) => string
  onOpenEvidence: (attachment: any) => void
  onOpenRunDetail: (runId: string) => void
  canViewDetail?: boolean
  canViewEvidence?: boolean
}

export function HistorialRunsTable({ runs, loading, getStatusColor, onOpenEvidence, onOpenRunDetail, canViewDetail = true, canViewEvidence = true }: Props) {
  const { t } = useI18n()
  const statusLabel = (status: string) => {
    const value = String(status || '').toUpperCase()
    if (['PASO', 'OK', 'PASSED'].includes(value)) return t('historial.pass')
    if (['FALLO', 'FALLIDO', 'FAILED'].includes(value)) return t('historial.fail')
    if (['BLOQUEADO', 'BLOCKED'].includes(value)) return t('historial.blocked')
    if (value === 'RUNNING') return t('historial.inProgress')
    if (['SIN_CORRER', 'NOT_RUN', 'PENDING', 'PENDIENTE'].includes(value)) return t('historial.notRun')
    return status || '-'
  }
  const modeLabel = (run: any) => {
    const value = getEffectiveRunExecutionMode(run).summary
    if (value === 'IA') return t('historial.ia')
    if (value === 'AUTOMATIZADA') return t('historial.automatedLabel')
    if (value === 'EXTERNA') return t('historial.externalLabel')
    if (value === 'MIXTO') return t('historial.mixedLabel')
    return t('historial.manualLabel')
  }
  const evidence = (run: any) => {
    if (!canViewEvidence) return <span className="small text-muted">{t('historial.noAccess')}</span>
    const items = (run.evidencias || []).slice(0, 3)
    const hidden = Math.max(0, Number(run.evidenceCount ?? run.evidencias?.length ?? 0) - items.length)
    return <div className="d-flex flex-wrap gap-1 align-items-center">
      {(!items.length || items.some((item: any) => !item.structured)) && <EvidenceList items={items.filter((item: any) => !item.structured)} onOpenEvidence={onOpenEvidence} />}
      {items.filter((item: any) => item.structured).map((item: any) => <Button key={item.id} disabled={!canViewDetail} size="sm" variant="outline-secondary" onClick={() => onOpenRunDetail(run.id)}>{item.kind === 'API' ? 'API' : 'Chatbot'}</Button>)}
      {hidden > 0 && <Button variant="outline-secondary" size="sm" disabled={!canViewDetail} title={t('historial.additionalEvidenceTitle', { count: hidden })} onClick={() => onOpenRunDetail(run.id)}>+{hidden}</Button>}
    </div>
  }
  const counts = (run: any) => <div><span className="history-counts" title={t('historial.countsHelp')} aria-label={t('historial.countsValues', { passed: run.passed, failed: run.failed, blocked: run.blocked, pending: run.pending })}>
    <span className="text-success">{run.passed}</span> / <span className="text-danger">{run.failed}</span> / <span className="text-primary">{run.blocked}</span> / <span className="text-muted">{run.pending}</span>
  </span>{Number(run.running || 0) > 0 && <div className="small text-primary">{t('historial.runningCount', { count: run.running })}</div>}</div>
  const verdict = (run: any) => <div className="d-flex gap-1 align-items-center flex-wrap"><Badge bg={run.status === 'running' ? 'primary' : getStatusColor(run.status)}>{statusLabel(run.status)}</Badge>{Number(run.aiReviewPending || 0) > 0 && <span title={t('historial.pendingAiReview')}><AlertTriangle size={14} aria-label={t('historial.pendingAiReview')} /></span>}</div>
  const state = (run: any) => run.runState === 'CERRADO' ? t('historial.closed') : ['EN_CURSO', 'EN_PROGRESO'].includes(run.runState) ? t('historial.inProgress') : t('historial.openRun')
  const action = (run: any) => canViewDetail && <Button variant="outline-primary" size="sm" className="d-inline-flex gap-1 align-items-center" onClick={() => onOpenRunDetail(run.id || run.runId)}><Eye size={13} aria-hidden="true" />{t('historial.viewDetail')}</Button>
  return <Card className="border-0 shadow-sm rounded-3 bg-white history-runs-card" aria-busy={loading}>
    <div className="history-desktop-list p-3"><Table responsive hover size="sm" className="align-middle history-runs-table mb-0">
      <thead><tr><th>{t('historial.runId')}</th><th>{t('historial.dateTime')}</th><th>{t('historial.build')}</th><th title={t('historial.countsHelp')}>{t('historial.pfbs')}</th><th>{t('historial.evidenceCol')}</th><th>{t('historial.verdict')}</th><th>{t('historial.actions')}</th></tr></thead>
      <tbody>{runs.map(run => <tr key={run.id}>
        <td><div className="fw-semibold text-break">{run.runId}</div><div className="small text-muted text-break">{run.environmentName || '-'} · {run.datasetName || t('historial.noDataset')}</div></td>
        <td><div className="small">{run.date}</div><div className="small text-muted">{state(run)}</div></td>
        <td><div className="small text-break" title={run.buildName}>{run.buildName || run.suite}</div><div className="small text-muted text-break" title={run.runner}>{run.runner}</div><Badge bg={getExecutionModeBadge(getEffectiveRunExecutionMode(run).summary)}>{modeLabel(run)}</Badge></td>
        <td>{counts(run)}</td><td>{evidence(run)}</td><td>{verdict(run)}</td><td>{action(run)}</td>
      </tr>)}</tbody>
    </Table></div>
    <div className="history-mobile-list">{runs.map(run => <article className="history-mobile-run p-3 border-bottom" key={run.id}>
      <div className="d-flex justify-content-between align-items-start gap-2"><strong className="text-break">{run.runId}</strong>{verdict(run)}</div>
      <div className="small text-muted my-2">{run.date} · {state(run)} · {modeLabel(run)}</div>
      <div className="small text-break">{run.buildName || run.suite} · {run.environmentName || '-'} · {run.datasetName || t('historial.noDataset')}</div>
      <div className="small text-muted text-break mb-2">{run.runner}</div>
      <div className="d-flex justify-content-between align-items-center gap-2 mb-2">{counts(run)}{action(run)}</div>
      {evidence(run)}
    </article>)}</div>
    {!runs.length && !loading && <div className="text-center text-muted py-4 small">{t('historial.noResults')}</div>}
  </Card>
}
