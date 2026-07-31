import { useMemo, useRef, useState } from 'react'

export function useTraceabilityGenerationState(options: any) {
  const { components, projectId, requirements, proposalQuality } = options
  const [generationRequirement, setGenerationRequirement] = useState<any>(null)
  const [generationStep, setGenerationStep] = useState<'context' | 'analysis' | 'configuration' | 'review'>('context')
  const [generationRun, setGenerationRun] = useState<any>(null)
  const [generationInstructions, setGenerationInstructions] = useState('')
  const [generationWiki, setGenerationWiki] = useState<any[]>([])
  const [generationWikiIds, setGenerationWikiIds] = useState<string[]>([])
  const [generationComponentIds, setGenerationComponentIds] = useState<string[]>([])
  const [generationMaxStories, setGenerationMaxStories] = useState(1)
  const [generationQuestionAnswers, setGenerationQuestionAnswers] = useState<Record<string, string>>({})
  const [generationCandidates, setGenerationCandidates] = useState<any[]>([])
  const [generationBusy, setGenerationBusy] = useState(false)
  const [generationElapsedSeconds, setGenerationElapsedSeconds] = useState(0)
  const [generationContextExpanded, setGenerationContextExpanded] = useState(true)
  const [expandedCandidateIndexes, setExpandedCandidateIndexes] = useState<Set<number>>(() => new Set())
  const [estimateExplanationVisible, setEstimateExplanationVisible] = useState(false)
  const [autoContinuePaused, setAutoContinuePaused] = useState(false)
  const [autoContinueRemaining, setAutoContinueRemaining] = useState<number | null>(null)
  const generationHasActionableReview = useMemo(() => {
    const analysis = generationRun?.analysis || {}
    return Boolean((analysis.questions || []).some((item: unknown) => String(item || '').trim()) || (analysis.proposed_assumptions || []).some((item: any) => String(item?.id || '').trim()))
  }, [generationRun])
  const generationHasCriticalAssumptions = useMemo(
    () => (generationRun?.analysis?.proposed_assumptions || []).some((item: any) => String(item?.risk || '').toUpperCase() === 'CRITICAL'),
    [generationRun],
  )
  const loadedProjectId = useRef<string | null>(null)
  const projectComponents = useMemo(() => components.filter((item: any) => String(item.projectId || item.proyecto_id) === String(projectId)), [components, projectId])
  const requirementById = useMemo(() => new Map<string, any>(requirements.map((item: any) => [item.id, item])), [requirements])
  const selectedCandidateCount = useMemo(() => generationCandidates.filter((item) => item.selected).length, [generationCandidates])
  const selectedCriticalCandidatesNeedDecision = useMemo(
    () => generationCandidates.some((item) => item.selected && proposalQuality(item) === 'FAIL' && (!item.quality_override_accepted || !String(item.quality_override_reason || '').trim())),
    [generationCandidates, proposalQuality],
  )
  const generationProgress = generationRun?.generation_progress || {}
  const generationRequestedCount = Number(generationProgress.requested || generationMaxStories || 1)
  const generationCompletedCount = Number(generationProgress.completed || generationCandidates.length || 0)
  const preflightDuplicateCheck = generationRun?.preflight_duplicate_check || {}
  const preflightExcludedStories = Array.isArray(preflightDuplicateCheck.excluded_existing_intent) ? preflightDuplicateCheck.excluded_existing_intent : []
  const updateGenerationCandidate = (index: number, patch: Record<string, unknown>) => {
    setGenerationCandidates((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }
  return {
    generationRequirement, setGenerationRequirement, generationStep, setGenerationStep, generationRun, setGenerationRun,
    generationInstructions, setGenerationInstructions, generationWiki, setGenerationWiki, generationWikiIds, setGenerationWikiIds,
    generationComponentIds, setGenerationComponentIds, generationMaxStories, setGenerationMaxStories, generationQuestionAnswers,
    setGenerationQuestionAnswers, generationCandidates, setGenerationCandidates, generationBusy, setGenerationBusy,
    generationElapsedSeconds, setGenerationElapsedSeconds, generationContextExpanded, setGenerationContextExpanded,
    expandedCandidateIndexes, setExpandedCandidateIndexes, estimateExplanationVisible, setEstimateExplanationVisible,
    autoContinuePaused, setAutoContinuePaused, autoContinueRemaining, setAutoContinueRemaining, generationHasActionableReview,
    generationHasCriticalAssumptions, loadedProjectId, projectComponents, requirementById, selectedCandidateCount,
    selectedCriticalCandidatesNeedDecision, generationProgress, generationRequestedCount, generationCompletedCount,
    preflightDuplicateCheck, preflightExcludedStories, updateGenerationCandidate,
  }
}
