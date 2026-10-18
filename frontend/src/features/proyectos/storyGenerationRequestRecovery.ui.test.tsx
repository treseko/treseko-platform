import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useTraceabilityGenerationActions } from './useTraceabilityGenerationActions'

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
afterEach(cleanup)

function Harness({ fetchWithAuth }: { fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response> }) {
  const [run, setRun] = useState<any>({ id: 'generation', estado: 'LISTA_PARA_GENERAR' })
  const [candidates, setCandidates] = useState<any[]>([])
  const [step, setStep] = useState('configuration')
  const actions = useTraceabilityGenerationActions({
    projectId: 'project', fetchWithAuth, readJson: async (response: Response) => {
      const value = await response.json()
      if (!response.ok) throw new Error(value.detail || 'request failed')
      return value
    },
    showFeedback: vi.fn(), tx: (key: string) => key, hasSimilarStory: () => false,
    generationRequirement: null, setGenerationRequirement: vi.fn(), generationStep: step, setGenerationStep: setStep,
    generationRun: run, setGenerationRun: setRun, generationInstructions: '', generationWikiIds: [],
    generationComponentIds: [], generationQuestionAnswers: {}, generationMaxStories: 2, setGenerationMaxStories: vi.fn(),
    setGenerationWiki: vi.fn(), setGenerationCandidates: setCandidates, setGenerationBusy: vi.fn(),
    setGenerationContextExpanded: vi.fn(), setGenerationComponentIds: vi.fn(), setEstimateExplanationVisible: vi.fn(),
    setGenerationWikiIds: vi.fn(), setGenerationInstructions: vi.fn(), setGenerationQuestionAnswers: vi.fn(),
    setExpandedCandidateIndexes: vi.fn(), setAutoContinuePaused: vi.fn(), setAutoContinueRemaining: vi.fn(),
    generationCandidates: candidates, generationBusy: false, autoContinuePaused: false,
    setStories: vi.fn(), setStoriesExpanded: vi.fn(),
  })
  return <><span data-testid="run-state">{run.estado}</span><span data-testid="step">{step}</span>
    {candidates.map(item => <span key={item.local_id}>{item.title}</span>)}
    <button onClick={actions.generateCandidates}>generate</button></>
}

it('reloads and displays persisted partial story drafts after the generation request fails', async () => {
  const candidate = { local_id: 'PROP-002', title: 'Comprar gift card', quality: { testability: 'PASS' } }
  const fetchWithAuth = vi.fn(async (url: string) => {
    if (url.endsWith('/generar')) return Response.json({ detail: 'Request closed' }, { status: 502 })
    if (url.endsWith('/generaciones-historias/generation')) return Response.json({
      id: 'generation', estado: 'LISTA_PARA_REVISION', propuestas: [candidate],
      error_detalle: 'La solicitud se interrumpió; revisa los borradores guardados.',
    })
    throw new Error(`Unexpected request: ${url}`)
  })

  render(<Harness fetchWithAuth={fetchWithAuth} />)
  fireEvent.click(screen.getByText('generate'))

  await waitFor(() => expect(screen.getByTestId('run-state')).toHaveTextContent('LISTA_PARA_REVISION'))
  expect(screen.getByTestId('step')).toHaveTextContent('review')
  expect(screen.getByText('Comprar gift card')).toBeInTheDocument()
  expect(fetchWithAuth).toHaveBeenCalledTimes(2)
})
