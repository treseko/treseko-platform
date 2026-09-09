// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { AiExecutionReportModal } from './AiExecutionReportModal'

afterEach(cleanup)

const screenshot = `data:image/png;base64,${'a'.repeat(96)}`

describe('AiExecutionReportModal', () => {
  it('temporarily hides the report while previewing evidence and restores it after closing the preview', () => {
    render(
      <I18nProvider>
        <AiExecutionReportModal
          show
          onHide={vi.fn()}
          report={{
            execution_id: 'execution-1',
            case_code: 'TC-1',
            case_title: 'Caso con evidencia',
            status: 'PASO',
            ai_report: {
              steps: [{
                number: 1,
                action: 'Ingresar al navegador y abrir',
                data: 'https://example.test',
                expected_result: 'Se muestra la página inicial',
                attempts: [{
                  attempt: 1,
                  action: { action: 'click', target_ref: 'el-1' },
                  screenshot_base64: screenshot,
                }],
              }],
            },
          }}
        />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole('tab', { name: /Pasos \(1\)/i }))
    expect(screen.getByText('Ingresar al navegador y abrir')).toBeTruthy()
    expect(screen.getByText('https://example.test')).toBeTruthy()
    expect(screen.getByText('Se muestra la página inicial')).toBeTruthy()
    fireEvent.click(screen.getByAltText('Paso 1 intento 1'))

    expect(screen.getByTestId('ai-report-modal').closest('.modal')).not.toHaveClass('show')
    expect(screen.getByTestId('ai-evidence-preview-modal').closest('.modal')).toHaveClass('show')
    expect(screen.getByText('Paso 1 - Intento 1')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: /cerrar|close/i }).at(-1)!)

    expect(screen.getByTestId('ai-report-modal').closest('.modal')).toHaveClass('show')
    expect(screen.getByTestId('ai-evidence-preview-modal').closest('.modal')).not.toHaveClass('show')
    expect(screen.getByText('Reporte IA de ejecucion')).toBeTruthy()
  })

  it('shows workflow context and explains a blocked execution without runnable steps', () => {
    render(
      <I18nProvider>
        <AiExecutionReportModal
          show
          onHide={vi.fn()}
          report={{
            execution_id: 'execution-blocked',
            status: 'BLOQUEADO',
            ai_report: {
              errors: ['Select action requires a selector'],
              case_steps: [{
                number: 1,
                action: 'Abrir la página',
                data: 'url=https://example.test',
                expected_result: 'Se muestra el aviso',
                status: 'BLOQUEADO',
                observations: 'Select action requires a selector',
                evidence_url: 'https://example.test/evidence.png',
              }, {
                number: 2,
                action: 'Buscar el texto final',
                expected_result: 'El texto queda visible',
                status: 'SIN_CORRER',
              }],
              agent_conversation: [{
                agent: 'Planner',
                level: 'WARN',
                message: 'Nodo bloqueado',
                input_json: { action: 'select' },
                output_json: { reason: 'Select action requires a selector', decision: { action: 'select', target_ref: 'selector ausente' } },
              }],
              steps: [],
            },
          }}
        />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole('tab', { name: /Trazas IA/i }))
    expect(screen.getByText('Ver contexto de la traza')).toBeTruthy()
    expect(screen.getAllByText(/Select action requires a selector/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: /Pasos \(2\)/i }))
    expect(screen.getByText('Pasos definidos en el caso')).toBeTruthy()
    expect(screen.getByText('Abrir la página')).toBeTruthy()
    expect(screen.getByAltText('Evidencia persistida del paso 1')).toBeTruthy()
    expect(screen.getByText(/Se ejecutaron 0 acciones en el navegador/)).toBeTruthy()
    expect(screen.getByText('Actividad previa al bloqueo')).toBeTruthy()
    expect(screen.getByText(/Acción propuesta:/)).toBeTruthy()
  })
})
