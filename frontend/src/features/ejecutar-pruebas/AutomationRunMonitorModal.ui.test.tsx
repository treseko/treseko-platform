// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { AutomationRunMonitorModal } from './AutomationRunMonitorModal'

afterEach(cleanup)

describe('AutomationRunMonitorModal', () => {
  it('muestra el estado de una ejecución completada y permite cerrar el monitor', () => {
    const onHide = vi.fn()

    render(
      <I18nProvider>
        <AutomationRunMonitorModal
          show
          onHide={onHide}
          run={{ id: 'run-1', nombre: 'Regresión de catálogo' }}
          jobs={[{
            jobId: 'job-1',
            caseCode: 'TC-001',
            caseTitle: 'Abrir catálogo',
            status: 'PASSED',
          }]}
          fetchWithAuth={vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ estado: 'PASSED', fecha_creacion: '2026-09-02T12:00:00Z' }),
          } as Response)}
          setAutomationMonitor={vi.fn()}
          canViewHistory
          onOpenWorkers={vi.fn()}
          onOpenHistory={vi.fn()}
        />
      </I18nProvider>,
    )

    expect(screen.getByText('Seguimiento de ejecución automatizada')).toBeTruthy()
    expect(screen.getByText('Regresión de catálogo')).toBeTruthy()
    expect(screen.getByText('TC-001')).toBeTruthy()
    expect(screen.getByText('Paso')).toBeTruthy()
    expect(screen.getByText('100%')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))

    expect(onHide).toHaveBeenCalledTimes(1)
  })
})
