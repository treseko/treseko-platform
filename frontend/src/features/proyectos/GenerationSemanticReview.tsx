import { useI18n } from '../../i18n'

export function GenerationContextNotice({ analysis }: { analysis: any }) {
  const { t } = useI18n()
  const inventory = analysis?.source_inventory
  if (!inventory?.complete) return null
  return <p className="small text-muted" role="status">{t('proyectos.generationContextPartitionNotice', { sources: inventory.source_count, parts: inventory.parts_processed })}</p>
}

export function GenerationSemanticReview({ review, criteria = [] }: { review: any; criteria?: any[] }) {
  const { t } = useI18n()
  if (!review?.version) return null
  return (
    <details className="mt-3 small border rounded p-2">
      <summary>{t('proyectos.generationSemanticReview')}</summary>
      <p className="text-muted mt-2">{t('proyectos.generationSemanticReviewNotice')}</p>
      {(review.grounding || []).map((item: any, index: number) => (
        <div className="mb-2" key={`${item.criterion_id}-${index}`}>
          <strong>{criteria.find(criterion => String(criterion.id || criterion.local_id) === item.criterion_id)?.title || criteria.find(criterion => String(criterion.id || criterion.local_id) === item.criterion_id)?.titulo || t('proyectos.generationReviewCriterion', { number: index + 1 })}</strong>: {t(`proyectos.generationGrounding${item.status}`)}
          <div>{item.reason}</div>
          {(item.evidence || []).map((evidence: any, quoteIndex: number) => (
            <blockquote key={quoteIndex} className="border-start ps-2 my-1 text-break">
              {evidence.quote}<div className="text-muted">{evidence.source_id}</div>
            </blockquote>
          ))}
        </div>
      ))}
      {(review.coverage || []).map((item: any, index: number) => (
        <div className="mb-2" key={`${item.criterion_id}-${index}`}>
          <strong>{criteria.find(criterion => String(criterion.id || criterion.local_id) === item.criterion_id)?.title || criteria.find(criterion => String(criterion.id || criterion.local_id) === item.criterion_id)?.titulo || t('proyectos.generationReviewCriterion', { number: index + 1 })}</strong>: {t(`proyectos.generationCoverage${item.status}`)}
          <div>{item.reason}</div>
          {!!item.step_numbers?.length && <div>{t('proyectos.generationCoverageSteps', { steps: item.step_numbers.join(', ') })}</div>}
        </div>
      ))}
      {(review.scenario_coverage || []).map((item: any, index: number) => (
        <div className="mb-2" key={`${item.scenario_id}-${index}`}>
          <strong>{t('proyectos.generationScenarioCoverage', { scenario: item.scenario_id })}</strong>: {t(`proyectos.generationCoverage${item.status}`)}
          <div>{item.reason}</div>
          {!!item.step_numbers?.length && <div>{t('proyectos.generationCoverageSteps', { steps: item.step_numbers.join(', ') })}</div>}
        </div>
      ))}
      {(review.findings || []).length > 0 && (
        <ul className="mb-0 mt-2 ps-3" aria-label={t('proyectos.generationReviewFindings')}>
          {review.findings.map((finding: any, index: number) => (
            <li key={`${finding.scope || 'CASE'}-${finding.criterion_id || 'general'}-${index}`}
              className={finding.severity === 'FAIL' ? 'text-danger' : 'text-warning-emphasis'}>
              <strong>{t(`proyectos.generationReviewScope${finding.scope || 'CASE'}`)}:</strong>{' '}
              {finding.review_consistency === 'SCENARIO_COVERAGE_CONFLICT' && <><strong>{t('proyectos.generationReviewConsistencyConflict')}:</strong>{' '}</>}
              {finding.message}
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
