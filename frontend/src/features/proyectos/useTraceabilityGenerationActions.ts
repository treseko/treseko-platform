import { useEffect } from 'react'
import { API_BASE } from '../../app/constants'

export function useTraceabilityGenerationActions(options: any) {
  const {
    projectId, fetchWithAuth, readJson, showFeedback, tx, hasSimilarStory,
    generationRequirement, setGenerationRequirement, generationStep, setGenerationStep,
    generationRun, setGenerationRun, generationInstructions, generationWikiIds,
    generationComponentIds, generationQuestionAnswers, generationMaxStories, setGenerationMaxStories,
    setGenerationWiki, setGenerationCandidates, setGenerationBusy, setGenerationContextExpanded,
    setGenerationComponentIds, setEstimateExplanationVisible, setGenerationWikiIds, setGenerationInstructions, setGenerationQuestionAnswers,
    setExpandedCandidateIndexes,
    setAutoContinuePaused, setAutoContinueRemaining, generationCandidates, generationHasActionableReview,
    generationHasCriticalAssumptions, generationBusy, autoContinuePaused, setStories, setStoriesExpanded,
  } = options

  const openGeneration = async (requirement: any) => {
    setGenerationRequirement(requirement)
    setGenerationStep('context')
    setGenerationRun(null)
    setGenerationInstructions('')
    setGenerationWikiIds([])
    setGenerationComponentIds(requirement.componente_ids || [])
    setGenerationCandidates([])
    setGenerationMaxStories(1)
    setGenerationQuestionAnswers({})
    setGenerationContextExpanded(true)
    setExpandedCandidateIndexes(new Set())
    setEstimateExplanationVisible(false)
    setAutoContinuePaused(false)
    setAutoContinueRemaining(null)
    try {
      setGenerationWiki(await readJson(await fetchWithAuth(`${API_BASE}/proyectos/${projectId}/wiki/`)))
    } catch {
      setGenerationWiki([])
    }
  }
  const estimateGeneration = async () => {
    if (!generationRequirement) return
    setGenerationBusy(true)
    try {
      const run = await readJson(await fetchWithAuth(`${API_BASE}/requisitos/${generationRequirement.id}/generaciones-historias/estimar`, {
        method: 'POST', body: JSON.stringify({ wiki_page_ids: generationWikiIds, componente_ids: generationComponentIds, instrucciones: generationInstructions }),
      }))
      setGenerationRun(run)
      if (run.estado === 'BLOQUEADA') throw new Error(run.error_detalle || tx('analysisUpdateFailed'))
      setGenerationMaxStories(run.estimacion?.cantidad_recomendada || 1)
      setGenerationStep(run.estado === 'ANALIZADA' ? 'configuration' : 'analysis')
      setGenerationContextExpanded(false)
      setEstimateExplanationVisible(true)
    } catch (error: any) {
      showFeedback(tx('generationTitle'), error.message || tx('previewGenerationFailed'), 'danger')
    } finally { setGenerationBusy(false) }
  }
  const generateCandidates = async () => {
    if (!generationRun) return
    setGenerationBusy(true)
    try {
      const run = await readJson(await fetchWithAuth(`${API_BASE}/generaciones-historias/${generationRun.id}/generar`, {
        method: 'POST', body: JSON.stringify({ max_historias: generationMaxStories, question_answers: Object.entries(generationQuestionAnswers).filter(([, answer]: [string, any]) => answer.trim()).map(([question, answer]: [string, any]) => ({ question, answer: answer.trim() })) }),
      }))
      if (run.estado === 'BLOQUEADA') throw new Error(run.error_detalle || 'La generación fue bloqueada.')
      setGenerationRun(run)
      setGenerationCandidates((run.propuestas || []).map((item: any) => ({ ...item, selected: item.quality?.testability === 'PASS' && !hasSimilarStory(item) })))
      setGenerationStep('review')
      setExpandedCandidateIndexes(new Set([0]))
    } catch (error: any) {
      showFeedback(tx('generationTitle'), error.message || tx('proposalsGenerationFailed'), 'danger')
    } finally { setGenerationBusy(false) }
  }
  const recalculateGenerationScope = async (generationId = generationRun?.id, usePersistedAnswers = false) => {
    if (!generationId) return
    setGenerationBusy(true)
    try {
      const run = await readJson(await fetchWithAuth(`${API_BASE}/generaciones-historias/${generationId}/reanalizar`, {
        method: 'POST', body: JSON.stringify({ max_historias: 1, question_answers: usePersistedAnswers ? [] : Object.entries(generationQuestionAnswers).filter(([, answer]: [string, any]) => answer.trim()).map(([question, answer]: [string, any]) => ({ question, answer: answer.trim() })) }),
      }))
      if (run.estado === 'BLOQUEADA') throw new Error(run.error_detalle || tx('analysisUpdateFailed'))
      setGenerationRun(run)
      setGenerationMaxStories(run.estimacion?.cantidad_recomendada || 1)
      setGenerationStep(run.estado === 'ANALIZADA' ? 'configuration' : 'analysis')
    } catch (error: any) {
      showFeedback(tx('analysisTitle'), error.message || tx('scopeUpdateFailed'), 'danger')
    } finally { setGenerationBusy(false) }
  }
  const confirmAssumptions = async (continuationMode: 'MANUAL' | 'AUTO_TIMEOUT' = 'MANUAL') => {
    if (!generationRun) return
    const assumptions = generationRun.analysis?.proposed_assumptions || []
    setGenerationBusy(true)
    try {
      const run = await readJson(await fetchWithAuth(`${API_BASE}/generaciones-historias/${generationRun.id}/supuestos`, { method: 'POST', body: JSON.stringify({ assumption_ids: assumptions.map((item: any) => item.id), question_answers: Object.entries(generationQuestionAnswers).filter(([, answer]: [string, any]) => answer.trim()).map(([question, answer]: [string, any]) => ({ question, answer: answer.trim() })), continuation_mode: continuationMode }) }))
      setGenerationRun(run)
      setGenerationStep('configuration')
    } catch (error: any) {
      showFeedback(tx('pendingAssumptionsTitle'), error.message || tx('assumptionsConfirmFailed'), 'danger')
    } finally { setGenerationBusy(false) }
  }
  const canAutoContinue = Boolean(generationRun && generationStep === 'analysis' && generationRun.estado === 'ESPERANDO_SUPUESTOS' && generationHasActionableReview && !generationHasCriticalAssumptions && !generationBusy && !autoContinuePaused)
  useEffect(() => {
    if (!canAutoContinue) { setAutoContinueRemaining(null); return }
    setAutoContinueRemaining(30)
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, 30 - Math.floor((Date.now() - startedAt) / 1000))
      setAutoContinueRemaining(remaining)
      if (remaining === 0) { window.clearInterval(timer); void confirmAssumptions('AUTO_TIMEOUT') }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [canAutoContinue, generationRun?.id])
  const applyCandidates = async () => {
    const historias = generationCandidates.filter((item: any) => item.selected).map((item: any) => item)
    if (!generationRun || !historias.length) return
    setGenerationBusy(true)
    try {
      const result = await readJson(await fetchWithAuth(`${API_BASE}/generaciones-historias/${generationRun.id}/aplicar`, { method: 'POST', body: JSON.stringify({ historias }) }))
      setStories((previous: any[]) => [...previous, ...(result.historias || [])])
      setStoriesExpanded(true)
      setGenerationRequirement(null)
      showFeedback(tx('storiesCreatedTitle'), tx('storiesCreatedMessage', { count: result.historias?.length || 0 }), 'success')
    } catch (error: any) {
      showFeedback(tx('storiesCreateFailed'), error.message, 'danger')
    } finally { setGenerationBusy(false) }
  }
  return { openGeneration, estimateGeneration, generateCandidates, recalculateGenerationScope, confirmAssumptions, canAutoContinue, applyCandidates }
}
