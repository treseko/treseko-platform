import { Alert, Badge, Button, Card, Form, Spinner, Table } from 'react-bootstrap'
import { Activity, Check, FilePlus2, Pencil, RefreshCw, ShieldAlert, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { formatDateTime } from '../../shared/utils/dateTime'
import type { QualityDiagnosis, QualityDiagnosisBugDraft, QualityDiagnosisEditPayload, QualityExecutionObservation, QualityExecutionObservationResponse, QualityFailureFingerprintResponse, QualityHealthResponse, QualityIntelligenceSummary, ReleaseRiskEvaluation } from './useQualityIntelligence'

type Props = {
  t: (key: `${string}.${string}`, params?: Record<string, string | number>) => string
  health: QualityHealthResponse | null
  fingerprints: QualityFailureFingerprintResponse | null
  observations: QualityExecutionObservationResponse | null
  summary: QualityIntelligenceSummary | null
  diagnoses: QualityDiagnosis[]
  releaseRisk: ReleaseRiskEvaluation | null
  loading: boolean
  rebuilding: boolean
  diagnosingExecutionId: string
  reviewingDiagnosisId: string
  editingDiagnosisId: string
  bugDraft: QualityDiagnosisBugDraft | null
  error: string
  canRebuild: boolean
  canCreateBugs: boolean
  onReload: () => void
  onRebuild: () => void
  onDiagnose: (observation: QualityExecutionObservation) => void
  onReview: (diagnosisId: string, status: 'ACCEPTED' | 'REJECTED') => void
  onEdit: (diagnosisId: string, payload: QualityDiagnosisEditPayload) => void
  onPrepareBugDraft: (diagnosisId: string) => void
  onEvaluateReleaseRisk: () => void
  onAcceptReleaseRisk: (note: string) => void
}

const variantFor = (classification: string) => ({
  FLAKY: 'warning', BLOCKED: 'secondary', STABLE: 'success', MIXED: 'info', INSUFFICIENT_DATA: 'light',
}[classification] || 'light')

const QUALITY_CASES_PAGE_SIZE = 8

export function QualityIntelligenceWidget({
  t, health, fingerprints, observations, summary, diagnoses, releaseRisk, loading, rebuilding, diagnosingExecutionId, reviewingDiagnosisId, editingDiagnosisId, bugDraft, error, canRebuild, canCreateBugs,
  onReload, onRebuild, onDiagnose, onReview, onEdit, onPrepareBugDraft, onEvaluateReleaseRisk, onAcceptReleaseRisk,
}: Props) {
  const items = health?.items || []
  const groupedFailures = fingerprints?.items || []
  const flaky = items.filter((item) => item.classification === 'FLAKY').length
  const blocked = items.filter((item) => item.classification === 'BLOCKED').length
  const [riskNote, setRiskNote] = useState('')
  const [editDraft, setEditDraft] = useState<{ id: string; facts: string; hypotheses: string; unknowns: string; nextSteps: string; note: string } | null>(null)
  const [showQualityCases, setShowQualityCases] = useState(false)
  const [qualityCasesPage, setQualityCasesPage] = useState(0)
  const lines = (items: Array<{ statement?: string }> | string[]) => items.map((item) => typeof item === 'string' ? item : item.statement || '').filter(Boolean).join('\n')
  const splitLines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean)
  const qualityCasesTotalPages = Math.max(1, Math.ceil(items.length / QUALITY_CASES_PAGE_SIZE))
  const safeQualityCasesPage = Math.min(qualityCasesPage, qualityCasesTotalPages - 1)
  const qualityCasesFrom = safeQualityCasesPage * QUALITY_CASES_PAGE_SIZE
  const visibleQualityCases = items.slice(qualityCasesFrom, qualityCasesFrom + QUALITY_CASES_PAGE_SIZE)
  const startEdit = (diagnosis: QualityDiagnosis) => setEditDraft({
    id: diagnosis.id, facts: lines(diagnosis.facts), hypotheses: lines(diagnosis.hypotheses),
    unknowns: lines(diagnosis.unknowns), nextSteps: lines(diagnosis.recommended_next_steps), note: '',
  })

  return (
    <Card className="h-100 border-0 shadow-sm">
      <Card.Body className="d-flex flex-column gap-2 overflow-auto">
        <div className="d-flex flex-wrap justify-content-between align-items-start gap-2">
          <div>
            <div className="fw-semibold d-flex align-items-center gap-2"><Activity size={18} className="text-primary" />{t('reportes.qualityIntelligence')}</div>
            <div className="small text-muted">{t('reportes.qualityIntelligenceDescription')}</div>
          </div>
          <div className="d-flex gap-2">
            <Button variant="outline-secondary" size="sm" onClick={onReload} disabled={loading || rebuilding} title={t('reportes.qualityReload')}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </Button>
            {canRebuild && <Button variant="primary" size="sm" onClick={onRebuild} disabled={rebuilding}>
              {rebuilding ? <Spinner size="sm" className="me-1" /> : <RefreshCw size={14} className="me-1" />}{t('reportes.qualityRebuild')}
            </Button>}
          </div>
        </div>
        {error && <Alert variant="warning" className="py-2 mb-0">{t('reportes.qualityAnalysisError')}: {error}</Alert>}
        {health?.is_stale && <Alert variant="info" className="py-2 mb-0">{t('reportes.qualityAnalysisStale')}</Alert>}
        <div className="border rounded p-2 small">
          <div className="d-flex justify-content-between gap-2 align-items-center"><div><div className="fw-semibold">{t('reportes.releaseRisk')}</div><div className="text-muted">{t('reportes.releaseRiskDescription')}</div></div>
            {canRebuild && <Button size="sm" variant="outline-primary" onClick={onEvaluateReleaseRisk} disabled={Boolean(health?.is_stale)}>{t('reportes.releaseRiskEvaluate')}</Button>}
          </div>
          {releaseRisk && <div className="mt-2"><div className="d-flex flex-wrap align-items-center gap-2"><Badge bg={releaseRisk.level === 'HIGH' ? 'danger' : releaseRisk.level === 'MEDIUM' ? 'warning' : 'success'} text={releaseRisk.level === 'MEDIUM' ? 'dark' : undefined}>{releaseRisk.level} · {releaseRisk.score}/100</Badge><strong>{t(`reportes.releaseRisk${releaseRisk.recommendation}`)}</strong></div>
            <div className="text-muted mt-1">{releaseRisk.factors.filter((factor) => factor.points > 0).map((factor) => `${factor.id}: +${factor.points}`).join(' · ') || t('reportes.releaseRiskNoFactors')}</div>
            {releaseRisk.comparison?.available && <div className="text-muted mt-1">{t('reportes.releaseRiskCompared', { score: releaseRisk.comparison.score || 0, delta: releaseRisk.comparison.score_delta || 0 })}</div>}
            {!releaseRisk.accepted_at && canRebuild && <Form className="d-flex gap-1 mt-2" onSubmit={(event) => { event.preventDefault(); onAcceptReleaseRisk(riskNote); }}><Form.Control name="a11y-qualityintelligencewidgettsx-82" aria-label="Campo de formulario" size="sm" value={riskNote} onChange={(event) => setRiskNote(event.target.value)} placeholder={t('reportes.releaseRiskNote')} /><Button size="sm" type="submit" disabled={riskNote.trim().length < 3 || Boolean(health?.is_stale)}>{t('reportes.releaseRiskAccept')}</Button></Form>}
            {releaseRisk.accepted_at && <div className="text-success mt-1">{t('reportes.releaseRiskAcceptedAt', { date: formatDateTime(releaseRisk.accepted_at) })}</div>}
          </div>}
        </div>
        {!loading && !error && items.length === 0 && (
          <Alert variant="light" className="border py-2 mb-0 d-flex gap-2 align-items-center"><ShieldAlert size={18} />{t('reportes.qualityNoData')}</Alert>
        )}
        {items.length > 0 && <>
          <div className="d-flex flex-wrap gap-2 small">
            <Badge bg="warning" text="dark">{flaky} {t('reportes.qualityFlaky')}</Badge>
            <Badge bg="secondary">{blocked} {t('reportes.qualityBlocked')}</Badge>
            {summary?.flaky_case_rate != null && <Badge bg="light" text="dark">{t('reportes.qualityFlakyRate', { rate: summary.flaky_case_rate.toFixed(0) })}</Badge>}
            {summary && <span className="text-muted">{t('reportes.qualityExecutionSummary', { observations: summary.terminal_observations, retries: summary.retry_observations })}</span>}
            <span className="text-muted">{t('reportes.qualityEvidenceNote')}</span>
          </div>
          {groupedFailures.length > 0 && <div className="border rounded p-2 small">
            <div className="fw-semibold mb-1">{t('reportes.qualityGroupedFailures')}</div>
            {groupedFailures.slice(0, 3).map((fingerprint) => <div key={fingerprint.id} className="d-flex justify-content-between gap-2">
              <span><Badge bg="light" text="dark">{fingerprint.failure_category}</Badge> <code title={fingerprint.fingerprint}>{fingerprint.fingerprint.slice(0, 10)}</code></span>
              <span className="text-muted">{t('reportes.qualityOccurrences', { count: fingerprint.occurrence_count, cases: fingerprint.case_count })}</span>
            </div>)}
            <div className="text-muted mt-1">{t('reportes.qualityFingerprintNote')}</div>
          </div>}
          {(observations?.items || []).length > 0 && <div className="border rounded p-2 small">
            <div className="fw-semibold mb-1">{t('reportes.qualityRecentExecutions')}</div>
            <div className="d-flex flex-column gap-1">{observations?.items.slice(0, 5).map((item) => <div key={item.id} className="d-flex justify-content-between align-items-start gap-2">
              <span className="text-truncate"><code>{item.case_code || '—'}</code> · {item.suite_name || t('reportes.qualityNoSuite')} · {item.build_name || t('reportes.qualityNoBuild')}</span>
              <span className="text-nowrap d-inline-flex align-items-center gap-1"><Badge bg={item.resultado === 'PASO' ? 'success' : item.resultado === 'FALLO' ? 'danger' : 'secondary'}>{item.resultado}</Badge> <span className="text-muted">{formatDateTime(item.observed_at)}</span>
                {canRebuild && ['FALLO', 'BLOQUEADO'].includes(item.resultado) && <Button variant="outline-primary" size="sm" className="py-0" disabled={Boolean(diagnosingExecutionId) || Boolean(health?.is_stale)} onClick={() => onDiagnose(item)} title={t('reportes.qualityCreateDiagnosis')}>
                  {diagnosingExecutionId === item.ejecucion_caso_id ? <Spinner size="sm" /> : <Sparkles size={13} />}
                </Button>}
              </span>
            </div>)}</div>
            <div className="text-muted mt-1">{t('reportes.qualityHistoryFilterHint')}</div>
          </div>}
          {diagnoses.length > 0 && <div className="border rounded p-2 small">
            <div className="fw-semibold mb-1">{t('reportes.qualityDiagnoses')}</div>
            <div className="d-flex flex-column gap-2">{diagnoses.slice(0, 3).map((diagnosis) => <div key={diagnosis.id} className="border-top pt-2">
              <div className="d-flex justify-content-between gap-2 align-items-start"><span><Badge bg={diagnosis.status === 'ACCEPTED' ? 'success' : diagnosis.status === 'REJECTED' ? 'secondary' : diagnosis.status === 'MODEL_UNAVAILABLE' ? 'warning' : 'primary'}>{diagnosis.status}</Badge> <span className="text-muted">{formatDateTime(diagnosis.created_at)}</span></span>
                {['DRAFT', 'UNDER_REVIEW', 'INSUFFICIENT_EVIDENCE', 'MODEL_UNAVAILABLE'].includes(diagnosis.status) && canCreateBugs && <span className="d-flex gap-1"><Button variant="outline-primary" size="sm" className="py-0" disabled={Boolean(health?.is_stale)} onClick={() => startEdit(diagnosis)} title={t('reportes.qualityEditDiagnosis')}><Pencil size={13} /></Button><Button variant="outline-success" size="sm" className="py-0" disabled={reviewingDiagnosisId === diagnosis.id || Boolean(health?.is_stale)} onClick={() => onReview(diagnosis.id, 'ACCEPTED')} title={t('reportes.qualityAcceptDiagnosis')}><Check size={13} /></Button><Button variant="outline-secondary" size="sm" className="py-0" disabled={reviewingDiagnosisId === diagnosis.id || Boolean(health?.is_stale)} onClick={() => onReview(diagnosis.id, 'REJECTED')} title={t('reportes.qualityRejectDiagnosis')}><X size={13} /></Button></span>}
              </div>
              {diagnosis.hypotheses.slice(0, 1).map((hypothesis, index) => <div key={index} className="mt-1">{hypothesis.statement || t('reportes.qualityNoHypothesis')}</div>)}
              {diagnosis.unknowns.slice(0, 1).map((unknown, index) => <div key={index} className="text-muted">{t('reportes.qualityUnknown')}: {unknown}</div>)}
              {diagnosis.status === 'ACCEPTED' && canCreateBugs && diagnosis.ejecucion_caso_id && <Button variant="outline-primary" size="sm" className="mt-1" onClick={() => onPrepareBugDraft(diagnosis.id)}><FilePlus2 size={13} className="me-1" />{t('reportes.qualityPrepareBug')}</Button>}
              {editDraft?.id === diagnosis.id && <Form className="mt-2 border rounded p-2" onSubmit={(event) => { event.preventDefault(); onEdit(diagnosis.id, { facts: splitLines(editDraft.facts).map((statement) => ({ statement })), hypotheses: splitLines(editDraft.hypotheses).map((statement) => ({ statement })), unknowns: splitLines(editDraft.unknowns), recommended_next_steps: splitLines(editDraft.nextSteps), note: editDraft.note }); }}>
                <Form.Label className="mb-1">{t('reportes.qualityEditFacts')}</Form.Label><Form.Control name="a11y-qualityintelligencewidgettsx-127" aria-label="Campo de formulario" size="sm" as="textarea" rows={2} value={editDraft.facts} onChange={(event) => setEditDraft({ ...editDraft, facts: event.target.value })} />
                <Form.Label className="mb-1 mt-1">{t('reportes.qualityEditHypotheses')}</Form.Label><Form.Control name="a11y-qualityintelligencewidgettsx-128" aria-label="Campo de formulario" size="sm" as="textarea" rows={2} value={editDraft.hypotheses} onChange={(event) => setEditDraft({ ...editDraft, hypotheses: event.target.value })} />
                <Form.Label className="mb-1 mt-1">{t('reportes.qualityEditUnknowns')}</Form.Label><Form.Control name="a11y-qualityintelligencewidgettsx-129" aria-label="Campo de formulario" size="sm" as="textarea" rows={2} value={editDraft.unknowns} onChange={(event) => setEditDraft({ ...editDraft, unknowns: event.target.value })} />
                <Form.Label className="mb-1 mt-1">{t('reportes.qualityEditNextSteps')}</Form.Label><Form.Control name="a11y-qualityintelligencewidgettsx-130" aria-label="Campo de formulario" size="sm" as="textarea" rows={2} value={editDraft.nextSteps} onChange={(event) => setEditDraft({ ...editDraft, nextSteps: event.target.value })} />
                <Form.Control name="a11y-qualityintelligencewidgettsx-131" aria-label="Campo de formulario" className="mt-1" size="sm" value={editDraft.note} onChange={(event) => setEditDraft({ ...editDraft, note: event.target.value })} placeholder={t('reportes.qualityEditNote')} />
                <div className="d-flex gap-1 mt-1"><Button size="sm" type="submit" disabled={editDraft.note.trim().length < 3 || editingDiagnosisId === diagnosis.id}>{editingDiagnosisId === diagnosis.id ? <Spinner size="sm" /> : t('reportes.qualitySaveDiagnosis')}</Button><Button size="sm" variant="outline-secondary" type="button" onClick={() => setEditDraft(null)}>{t('common.cancel')}</Button></div>
              </Form>}
            </div>)}</div>
          </div>}
          {bugDraft && <Alert variant="info" className="py-2 mb-0 small"><strong>{t('reportes.qualityBugDraftReady')}</strong> {t('reportes.qualityBugDraftHint')}<div className="mt-1 text-break"><code>{bugDraft.target_path}</code></div></Alert>}
          <div className="border rounded p-2 small">
            <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
              <div>
                <div className="fw-semibold">{t('reportes.qualityCasesTitle')}</div>
                <div className="text-muted">{t('reportes.qualityCasesSummary', { count: items.length })}</div>
              </div>
              <Button
                variant="outline-primary"
                size="sm"
                onClick={() => setShowQualityCases((value) => !value)}
                aria-expanded={showQualityCases}
                aria-controls="quality-cases-table"
              >
                {showQualityCases ? t('reportes.qualityCasesHide') : t('reportes.qualityCasesShow')}
              </Button>
            </div>
            {showQualityCases && <>
              <div id="quality-cases-table" className="table-responsive mt-2">
                <Table size="sm" hover className="align-middle mb-0">
                  <thead><tr><th>{t('reportes.case')}</th><th>{t('reportes.status')}</th><th>{t('reportes.qualityScore')}</th><th>{t('reportes.qualityEvidence')}</th><th>{t('reportes.date')}</th></tr></thead>
                  <tbody>{visibleQualityCases.map((item) => {
                    const evidence = item.evidence_summary || {}
                    const comparable = Number(evidence.comparable_observations || 0)
                    return <tr key={`${item.case_master_id}:${item.scope_key}`}>
                      <td><code>{item.case_code || '—'}</code><div className="small text-muted text-truncate" style={{ maxWidth: 220 }}>{item.case_title || item.case_master_id}</div></td>
                      <td><Badge bg={variantFor(item.classification)} text={item.classification === 'FLAKY' ? 'dark' : undefined}>{t(`reportes.qualityStatus${item.classification}`)}</Badge></td>
                      <td>{item.classification === 'INSUFFICIENT_DATA' ? '—' : `${Number(item.flaky_score || 0).toFixed(0)}%`}</td>
                      <td>{comparable}/{item.total_observations} · {item.transition_count} {t('reportes.qualityTransitions')}</td>
                      <td className="small text-muted">{formatDateTime(item.calculated_at)}</td>
                    </tr>
                  })}</tbody>
                </Table>
              </div>
              <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-2">
                <span className="text-muted">{t('reportes.qualityCasesShowing', { from: qualityCasesFrom + 1, to: Math.min(qualityCasesFrom + visibleQualityCases.length, items.length), total: items.length })}</span>
                {qualityCasesTotalPages > 1 && <div className="d-flex gap-1">
                  <Button variant="outline-secondary" size="sm" disabled={safeQualityCasesPage === 0} onClick={() => setQualityCasesPage((page) => Math.max(0, page - 1))}>{t('reportes.traceabilityPrevious')}</Button>
                  <span className="small align-self-center px-1">{safeQualityCasesPage + 1}/{qualityCasesTotalPages}</span>
                  <Button variant="outline-secondary" size="sm" disabled={safeQualityCasesPage >= qualityCasesTotalPages - 1} onClick={() => setQualityCasesPage((page) => Math.min(qualityCasesTotalPages - 1, page + 1))}>{t('reportes.traceabilityNext')}</Button>
                </div>}
              </div>
            </>}
          </div>
        </>}
      </Card.Body>
    </Card>
  )
}
