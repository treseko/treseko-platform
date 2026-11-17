// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { AutomationRunMonitorModal } from './AutomationRunMonitorModal'
import { parseScriptFailureDetails } from './automationMonitorPresentation'

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

  it('ofrece abrir y descargar el trace de Playwright desde el resultado', async () => {
    const fetchWithAuth = vi.fn(async (url: string) => {
      if (url.includes('/static/attachments/')) return new Response(new Blob(['trace-data']), { status: 200, headers: { 'content-type': 'application/zip' } })
      return {
      ok: true,
      json: async () => ({
        id: 'job-trace',
        estado: 'PASSED',
        fecha_creacion: '2026-11-15T12:00:00Z',
        metadata_resultado: {
          script_format: 'playwright_test',
          script_line_offset: 5,
          artifacts: [{
            id: 'trace-1',
            type: 'trace',
            filename: 'trace.zip',
            content_type: 'application/zip',
            public_url: '/static/attachments/trace.zip',
          }],
        },
      }),
    } as Response
    })

    render(
      <I18nProvider>
        <AutomationRunMonitorModal
          show
          onHide={vi.fn()}
          run={{ id: 'run-trace', nombre: 'Replay con trace' }}
          jobs={[{ jobId: 'job-trace', caseCode: 'PUB-001', caseTitle: 'Recorrido', status: 'PASSED' }]}
          fetchWithAuth={fetchWithAuth}
          setAutomationMonitor={vi.fn()}
          canViewHistory
          onOpenWorkers={vi.fn()}
          onOpenHistory={vi.fn()}
        />
      </I18nProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Ver respuesta Playwright' }))

    const viewerButton = await screen.findByRole('button', { name: 'Ver secuencia' })
    const downloadLink = screen.getByRole('link', { name: 'Descargar trace' })
    expect(downloadLink.getAttribute('href')).toContain('/static/attachments/trace.zip')
    expect(downloadLink.getAttribute('download')).toBe('trace.zip')
    fireEvent.click(viewerButton)
    const traceFrame = await screen.findByTitle('Secuencia de Playwright') as HTMLIFrameElement
    expect(traceFrame.getAttribute('src')).toBe('https://trace.playwright.dev/')
    expect(fetchWithAuth).toHaveBeenCalledWith(expect.stringContaining('/static/attachments/trace.zip'))
    const postMessage = vi.spyOn(traceFrame.contentWindow!, 'postMessage')
    fireEvent.load(traceFrame)
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'load', params: expect.objectContaining({ trace: expect.any(Blob) }) }),
      'https://trace.playwright.dev',
    )
  })

  it('expone el error, la ubicación del script y el video cuando falla Playwright', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'job-failed',
        estado: 'FAILED',
        fecha_creacion: '2026-11-15T12:00:00Z',
        logs: [
          'Resultados por test:',
          '- FAILED | Recorre el flujo de compra | 100 ms',
          '  errores:',
          '  Error: expect(locator).toBeVisible() failed',
          '    at /tmp/qa-worker/job.spec.ts:24:9',
        ].join('\n'),
        metadata_resultado: {
          script_format: 'playwright_test',
          script_line_offset: 5,
          artifacts: [{
            id: 'video-failed',
            type: 'video',
            filename: 'video.webm',
            content_type: 'video/webm',
            public_url: '/static/attachments/video.webm',
          }],
        },
      }),
    } as Response)

    render(
      <I18nProvider>
        <AutomationRunMonitorModal
          show
          onHide={vi.fn()}
          run={{ id: 'run-failed', nombre: 'Flujo con fallo' }}
          jobs={[{ jobId: 'job-failed', caseCode: 'PUB-001', caseTitle: 'Compra', status: 'FAILED' }]}
          fetchWithAuth={fetchWithAuth}
          setAutomationMonitor={vi.fn()}
          canViewHistory
          onOpenWorkers={vi.fn()}
          onOpenHistory={vi.fn()}
        />
      </I18nProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Ver respuesta Playwright' }))

    expect(await screen.findByText('Dónde falló el script')).toBeTruthy()
    expect(screen.getByText('Recorre el flujo de compra')).toBeTruthy()
    expect(screen.getByText('Error: expect(locator).toBeVisible() failed')).toBeTruthy()
    expect(document.body.textContent).toMatch(/(?:Línea del script|Script line):\s*19/)
    expect(document.body.textContent).toMatch(/(?:Ubicación del archivo ejecutado|Executed file location): job\.spec\.ts:24:9/)
    expect(screen.getByRole('button', { name: 'Ver video de la ejecución' })).toBeTruthy()
  })

  it('muestra la excepción y línea de un script Selenium Python', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'job-selenium-failed',
        estado: 'FAILED',
        metadata_resultado: { script_format: 'python_script', script_line_offset: 15 },
        logs: [
          'Traceback (most recent call last):',
          '  File "/tmp/qa-worker/job.py", line 42, in <module>',
          '    assert button.is_displayed()',
          'AssertionError: el botón no quedó visible',
        ].join('\n'),
      }),
    } as Response)

    render(
      <I18nProvider>
        <AutomationRunMonitorModal
          show
          onHide={vi.fn()}
          run={{ id: 'run-selenium', nombre: 'Selenium Python' }}
          jobs={[{ jobId: 'job-selenium-failed', caseCode: 'SEL-001', caseTitle: 'Validar botón', status: 'FAILED' }]}
          fetchWithAuth={fetchWithAuth}
          setAutomationMonitor={vi.fn()}
          canViewHistory
          onOpenWorkers={vi.fn()}
          onOpenHistory={vi.fn()}
        />
      </I18nProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'View log' }))

    expect(await screen.findByText('Where the script failed')).toBeTruthy()
    expect(screen.getByText('AssertionError: el botón no quedó visible')).toBeTruthy()
    expect(document.body.textContent).toMatch(/(?:Línea del script|Script line):\s*27\s*·\s*<module>/)
    expect(document.body.textContent).toMatch(/(?:Ubicación del archivo ejecutado|Executed file location): job\.py:42/)
  })

  it('extrae ubicación de errores JavaScript para Cypress y Puppeteer', () => {
    for (const [frameworkFile, expectedFile] of [['job.cy.js', 'job.cy.js'], ['job.js', 'job.js']]) {
      const failure = parseScriptFailureDetails(`Error: selector no encontrado\n    at Context.eval (webpack:///./${frameworkFile}:18:7)`)
      expect(failure?.message).toBe('Error: selector no encontrado')
      expect(failure?.location).toEqual({ file: expectedFile, line: 18, column: 7, context: '' })
    }
  })
})
