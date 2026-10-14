import { useEffect, useRef } from 'react'
import { API_BASE } from '../../app/constants'
import { useI18n } from '../../i18n'
import { canAutoConfirmStoryAnalysis } from './useTraceabilityGenerationState'

export function useTraceabilityGenerationActions(options: any) {
  const { t } = useI18n()
  const {
    projectId, fetchWithAuth, readJson, showFeedback, tx, hasSimilarStory,
    generationRequirement, setGenerationRequirement, generationStep, setGenerationStep,
    generationRun, setGenerationRun, generationInstructions, generationWikiIds,
    generationComponentIds, generationQuestionAnswers, generationMaxStories, setGenerationMaxStories,
    setGenerationWiki, setGenerationCandidates, setGenerationBusy: setGenerationBusyState, setGenerationContextExpanded,
    setGenerationComponentIds, setEstimateExplanationVisible, setGenerationWikiIds, setGenerationInstructions, setGenerationQuestionAnswers,
    setExpandedCandidateIndexes,
    setAutoContinuePaused, setAutoContinueRemaining, generationCandidates,
    generationBusy, autoContinuePaused, setStories, setStoriesExpanded,
  } = options

  const busyRef = useRef(false)
  const setGenerationBusy = (value: boolean) => { busyRef.current = value; setGenerationBusyState(value) }
  const openGeneration = async (requirement: any) => {
    if (busyRef.current) return
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
    if (busyRef.current) return
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
    if (busyRef.current) return
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
    if (busyRef.current) return
    if (!generationId) return
    setGenerationBusy(true)
    try {
      const run = await readJson(await fetchWithAuth(`${API_BASE}/generaciones-historias/${generationId}/reanalizar`, {
        method: 'POST', body: JSON.stringify({ max_historias: 1, question_answers: usePersistedAnswers ? [] : Object.entries(generationQuestionAnswers).filter(([, answer]: [string, any]) => answer.trim()).map(([question, answer]: [string, any]) => ({ question, answer: answer.trim() })) }),
      }))
      if (run.estado === 'BLOQUEADA') throw new Error(run.error_detalle || tx('analysisUpdateFailed'))
      setGenerationRun(run)
      setGenerationQuestionAnswers({})
      setGenerationMaxStories(run.estimacion?.cantidad_recomendada || 1)
      setGenerationStep(run.estado === 'ANALIZADA' ? 'configuration' : 'analysis')
    } catch (error: any) {
      showFeedback(tx('analysisTitle'), error.message || tx('scopeUpdateFailed'), 'danger')
    } finally { setGenerationBusy(false) }
  }
  const confirmAssumptions = async (continuationMode: 'MANUAL' | 'AUTO_TIMEOUT' = 'MANUAL') => {
    if (busyRef.current) return
    if (!generationRun) return
    const assumptions = generationRun.analysis?.proposed_assumptions || []
    setGenerationBusy(true)
    try {
      const run = await readJson(await fetchWithAuth(`${API_BASE}/generaciones-historias/${generationRun.id}/supuestos`, { method: 'POST', body: JSON.stringify({ assumption_ids: assumptions.map((item: any) => item.id), question_answers: Object.entries(generationQuestionAnswers).filter(([, answer]: [string, any]) => answer.trim()).map(([question, answer]: [string, any]) => ({ question, answer: answer.trim() })), continuation_mode: continuationMode }) }))
      setGenerationRun(run)
      setGenerationQuestionAnswers({})
      setGenerationStep(['ANALIZADA', 'LISTA_PARA_GENERAR'].includes(run.estado) ? 'configuration' : 'analysis')
    } catch (error: any) {
      showFeedback(tx('pendingAssumptionsTitle'), error.message || tx('assumptionsConfirmFailed'), 'danger')
    } finally { setGenerationBusy(false) }
  }
  const canAutoContinue = Boolean(generationRun && generationStep === 'analysis' && generationRun.estado === 'ESPERANDO_SUPUESTOS' && canAutoConfirmStoryAnalysis(generationRun.analysis) && !generationBusy && !autoContinuePaused)
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
    if (busyRef.current) return
    const historias = generationCandidates.filter((item: any) => item.selected).map((item: any) => item)
    if (!generationRun || !historias.length) return
    setGenerationBusy(true)
    try {
      const reviewed = await readJson(await fetchWithAuth(`${API_BASE}/generaciones-historias/${generationRun.id}/revisar`, { method: 'POST', body: JSON.stringify({ propuestas: historias }) }))
      const reviewedById = new Map((reviewed.propuestas || []).map((item: any) => [item.local_id, item]))
      const checked = historias.map((item: any) => ({ ...item, quality: (reviewedById.get(item.local_id) as any)?.quality || item.quality }))
      setGenerationCandidates((previous: any[]) => previous.map(item => checked.find((candidate: any) => candidate.local_id === item.local_id) || item))
      setGenerationRun(reviewed)
      if (checked.some((item: any) => item.quality?.testability === 'FAIL' && (!item.quality_override_accepted || !item.quality_override_reason?.trim()))) {
        showFeedback(tx('storiesCreateFailed'), t('proyectos.generationSemanticDecisionRequired'), 'warning')
        return
      }
      const result = await readJson(await fetchWithAuth(`${API_BASE}/generaciones-historias/${generationRun.id}/aplicar`, { method: 'POST', body: JSON.stringify({ historias: checked }) }))
      setStories((previous: any[]) => [...previous, ...(result.historias || []).filter((item: any) => !previous.some(existing => existing.id === item.id))])
      setStoriesExpanded(true)
      setGenerationRequirement(null)
      showFeedback(tx('storiesCreatedTitle'), tx('storiesCreatedMessage', { count: result.historias?.length || 0 }), 'success')
    } catch (error: any) {
      showFeedback(tx('storiesCreateFailed'), error.message, 'danger')
    } finally { setGenerationBusy(false) }
  }
  return { openGeneration, estimateGeneration, generateCandidates, recalculateGenerationScope, confirmAssumptions, canAutoContinue, applyCandidates }
}
