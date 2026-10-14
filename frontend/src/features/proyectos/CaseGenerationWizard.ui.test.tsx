import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CaseGenerationWizard } from './CaseGenerationWizard'

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('./CaseGenerationWizardView', () => ({ CaseGenerationWizardView: ({ options: o }: any) => <>
  <span data-testid="state">{o.run?.estado || 'NEW'}</span><span>{o.error}</span>
  <button onClick={() => { o.setSelectedComponent('component'); o.setSelectedSuite('suite') }}>destination</button>
  <button onClick={o.estimate}>analyze</button><button onClick={o.generate} disabled={o.busy || o.recoveryPending}>generate</button>
<button onClick={o.restart}>restart</button>
</> }))
afterEach(cleanup)

it('refreshes the persisted generation state after authoring fails', async () => {
  const ready = { id: 'generation', estado: 'LISTA_PARA_GENERAR', analysis: { readiness: 'READY' }, estimacion: { scenarios: [{ local_id: 'scenario' }] } }
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/suites/')) return Response.json([{ id: 'suite', componente_id: 'component', nombre: 'Suite' }])
    if (url.includes('/componentes/')) return Response.json([{ id: 'component' }])
    if (url.endsWith('/estimar')) return Response.json(ready)
    if (url.endsWith('/generar')) return Response.json({ detail: 'Provider unavailable' }, { status: 502 })
    if (url.endsWith('/generaciones-casos/generation') && !options?.method) return Response.json({ ...ready, estado: 'BLOQUEADA' })
    throw new Error('Unexpected request')
  })
  render(<CaseGenerationWizard story={{ id: 'story', proyecto_id: 'project' }} fetchWithAuth={fetcher} onClose={vi.fn()} onApplied={vi.fn()} />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByText('destination')); fireEvent.click(screen.getByText('analyze'))
  await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('LISTA_PARA_GENERAR'))
  fireEvent.click(screen.getByText('generate'))
  await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('BLOQUEADA'))
  expect(screen.getByText('Provider unavailable')).toBeInTheDocument()
})


it.each(['unavailable', 'wrong-id', 'still-generating'])('prevents another write when state refresh is %s', async (failure) => {
  const ready = { id: 'generation', estado: 'LISTA_PARA_GENERAR', analysis: { readiness: 'READY' }, estimacion: { scenarios: [{ local_id: 'scenario' }] } }
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/suites/')) return Response.json([{ id: 'suite', componente_id: 'component', nombre: 'Suite' }])
    if (url.includes('/componentes/')) return Response.json([{ id: 'component' }])
    if (url.endsWith('/estimar')) return Response.json(ready)
    if (url.endsWith('/generar')) return Response.json({ detail: 'Provider unavailable' }, { status: 502 })
    if (failure === 'unavailable') return Response.json({}, { status: 503 })
    return Response.json(failure === 'wrong-id' ? { ...ready, id: 'other-generation' } : { ...ready, estado: 'GENERANDO' })
  })
  render(<CaseGenerationWizard story={{ id: 'story', proyecto_id: 'project' }} fetchWithAuth={fetcher} onClose={vi.fn()} onApplied={vi.fn()} />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByText('destination')); fireEvent.click(screen.getByText('analyze'))
  await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('LISTA_PARA_GENERAR'))
  fireEvent.click(screen.getByText('generate'))
  await waitFor(() => expect(screen.getByText('generate')).toBeDisabled())
  expect(screen.getByText('Provider unavailable')).toBeInTheDocument()
  fireEvent.click(screen.getByText('generate'))
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/generar'))).toHaveLength(1)
  fireEvent.click(screen.getByText('restart'))
  expect(screen.getByTestId('state')).toHaveTextContent('NEW')
  expect(screen.getByText('generate')).not.toBeDisabled()
})
