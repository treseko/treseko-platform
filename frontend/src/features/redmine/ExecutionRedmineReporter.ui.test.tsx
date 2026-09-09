// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { ExecutionRedmineReporter } from './ExecutionRedmineReporter'

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

afterEach(cleanup)

function renderManualBugReporter() {
  return render(
    <I18nProvider>
      <ExecutionRedmineReporter
        showPrompt={false}
        onHidePrompt={vi.fn()}
        showDrawer
        onHideDrawer={vi.fn()}
        currentExecutionCase={null}
        selectedTest={null}
        onDefer={vi.fn()}
        onOpenReport={vi.fn()}
        onSubmitInternalBug={vi.fn()}
        internalBugDraft={{
          titulo: '',
          descripcion: '',
          resultado_esperado: '',
          resultado_obtenido: '',
          pasos_reproduccion: '',
          _context: { manual: true },
        }}
        onInternalBugDraftChange={vi.fn()}
      />
    </I18nProvider>,
  )
}

describe('ExecutionRedmineReporter required fields', () => {
  it('explica y marca todos los campos obligatorios del bug manual', () => {
    renderManualBugReporter()

    expect(screen.getByText('Los campos marcados son obligatorios.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Título del bug/)).toBeRequired()
    expect(screen.getByLabelText(/Pasos para reproducir/)).toBeRequired()
    expect(screen.getByLabelText(/Resumen y diagnostico/)).toBeRequired()
    expect(screen.getByLabelText(/Resultado esperado/)).toBeRequired()
    expect(screen.getByLabelText(/Resultado obtenido/)).toBeRequired()
  })

  it('no presenta como obligatorios los campos opcionales o con valor predeterminado', () => {
    renderManualBugReporter()

    expect(screen.getByLabelText('Severidad')).not.toBeRequired()
    expect(screen.getByLabelText('Prioridad')).not.toBeRequired()
    expect(screen.getByLabelText('Criticidad')).not.toBeRequired()
    expect(screen.getByLabelText('Asignado a')).not.toBeRequired()
    expect(screen.getByLabelText(/Notas QA/)).not.toBeRequired()
  })
})
