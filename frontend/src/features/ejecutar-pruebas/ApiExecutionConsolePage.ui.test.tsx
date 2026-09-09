// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { I18nProvider } from '../../i18n'
import { ApiExecutionConsolePage } from './ApiExecutionConsolePage'

afterEach(cleanup)

const renderWithI18n = (ui: ReactNode) => render(<I18nProvider>{ui}</I18nProvider>)

describe('ApiExecutionConsolePage', () => {
  it('muestra la consola pendiente con lote, detalle y una única acción para enviar la solicitud', () => {
    const onExecuteRequest = vi.fn()
    renderWithI18n(
      <ApiExecutionConsolePage
        selectedTest={{
          id: 'case-1',
          code: 'TC-API-001',
          title: 'Health check',
          description: 'Comprueba que el servicio esté disponible.',
          configuracion_api: { request: { method: 'GET', url: '{{base_url}}/health', headers: [{ key: 'Authorization', value: 'Bearer {{access_token}}' }], body: { customer: '{{customer_name}}' } } },
        }}
        apiExecutionResults={{
          pending: true,
          origin: 'MANUAL',
          tests: [{ id: 'case-1', code: 'TC-API-001', title: 'Health check', configuracion_api: { request: { method: 'GET', url: '{{base_url}}/health', headers: [{ key: 'Authorization', value: 'Bearer {{access_token}}' }], body: { customer: '{{customer_name}}' } } } }],
          environment_name: 'API QA',
          dataset_name: 'Dataset API demo',
          dataset_preview: { variables_resueltas: { base_url: 'https://api.test', customer_name: 'T reseko QA', access_token: 'secret-value', unused_variable: 'no mostrar' } },
        }}
        currentProjectEnvironments={[]}
        returnToExecutionList={vi.fn()}
        onExecuteRequest={onExecuteRequest}
      />,
    )

    expect(screen.getByText('Lote de ejecución')).toBeTruthy()
    expect(screen.getByText('Detalles del caso')).toBeTruthy()
    expect(screen.getByText('Solicitud API lista para ejecutar')).toBeTruthy()
    expect(screen.getByText('{{base_url}}/health')).toBeTruthy()
    expect(screen.getByText('Variables utilizadas en la solicitud')).toBeTruthy()
    expect(screen.getByText('T reseko QA')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Mostrar valores resueltos'))
    expect(screen.getByText('https://api.test/health')).toBeTruthy()
    expect(screen.getByText('T reseko QA')).toBeTruthy()
    expect(screen.getByText('[REDACTADO]')).toBeTruthy()
    expect(screen.queryByText('no mostrar')).toBeNull()
    expect(screen.getByRole('button', { name: /Ejecutar solicitud/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Ejecutar solicitud/ }))
    expect(onExecuteRequest).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Respuesta recibida')).toBeNull()
  })

  it('explica que la ejecución fue iniciada manualmente y permite repetirla', () => {
    const onRepeatExecution = vi.fn()
    const onExecuteRequest = vi.fn()
    renderWithI18n(
      <ApiExecutionConsolePage
        selectedTest={{ id: 'case-1', code: 'TC-API-001', title: 'Health check' }}
        apiExecutionResults={{
          tests: [{ id: 'case-1', code: 'TC-API-001', title: 'Health check' }],
          executions: [{ case_id: 'case-1', status: 'FALLO', result: { status: 'FAILED', steps: [{ response: { status: 500, body: '' }, assertions: [{ name: 'HTTP 200', status: 'FAILED', expected: 200, actual: 500 }] }] } }],
          environment_name: 'API QA',
          dataset_name: 'Dataset API demo',
        }}
        currentProjectEnvironments={[]}
        returnToExecutionList={vi.fn()}
        onRepeatExecution={onRepeatExecution}
        onExecuteRequest={onExecuteRequest}
      />,
    )

    expect(screen.getByText('Consola manual API')).toBeTruthy()
    expect(screen.queryByText('MANUAL')).toBeNull()
    expect(document.body.textContent).toContain('Dataset API demo')
    expect(screen.getByText('El servicio respondió HTTP 500, pero no devolvió contenido.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Cambiar ambiente o dataset/ }))
    expect(onRepeatExecution).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /Ejecutar nuevamente/ }))
    expect(onExecuteRequest).toHaveBeenCalledTimes(1)
  })

  it('mantiene pendiente el siguiente caso hasta que el usuario pulse ejecutar', () => {
    const onExecuteRequest = vi.fn()
    renderWithI18n(
      <ApiExecutionConsolePage
        selectedTest={{ id: 'case-2', code: 'TC-API-002', title: 'Segundo caso', configuracion_api: { request: { method: 'GET', url: '{{base_url}}/second' } } }}
        apiExecutionResults={{
          pending: false,
          tests: [
            { id: 'case-1', code: 'TC-API-001', title: 'Primer caso' },
            { id: 'case-2', code: 'TC-API-002', title: 'Segundo caso', configuracion_api: { request: { method: 'GET', url: '{{base_url}}/second' } } },
          ],
          executions: [
            { case_id: 'case-1', status: 'FALLO', result: { status: 'FAILED', steps: [{ response: { status: 500 } }] } },
            { case_id: 'case-2', status: 'PENDIENTE' },
          ],
          dataset_preview: { variables_resueltas: { base_url: 'https://api.test' } },
        }}
        returnToExecutionList={vi.fn()}
        onExecuteRequest={onExecuteRequest}
      />,
    )

    expect(screen.getByText('Solicitud API lista para ejecutar')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Ejecutar solicitud/ })).toBeTruthy()
    expect(screen.queryByText('Respuesta recibida')).toBeNull()
    expect(onExecuteRequest).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Ejecutar solicitud/ }))
    expect(onExecuteRequest).toHaveBeenCalledTimes(1)
  })

  it('mantiene visibles las variables y el selector de valores resueltos después de ejecutar', () => {
    renderWithI18n(
      <ApiExecutionConsolePage
        selectedTest={{ id: 'case-1', code: 'TC-API-001', title: 'Health check', configuracion_api: { request: { method: 'GET', url: '{{base_url}}/health' } } }}
        apiExecutionResults={{
          tests: [{ id: 'case-1', code: 'TC-API-001', title: 'Health check', configuracion_api: { request: { method: 'GET', url: '{{base_url}}/health' } } }],
          executions: [{ case_id: 'case-1', status: 'PASO', result: { status: 'PASSED', steps: [{ response: { status: 200, body: '{}' } }] } }],
          dataset_preview: { variables_resueltas: { base_url: 'https://api.test' } },
        }}
        currentProjectEnvironments={[]}
        returnToExecutionList={vi.fn()}
        onExecuteRequest={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Solicitud y variables' }))
    expect(screen.getByLabelText('Mostrar valores resueltos')).toBeTruthy()
    expect(screen.getByText('Variables utilizadas en la solicitud')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Mostrar valores resueltos'))
    expect(screen.getByText('https://api.test/health')).toBeTruthy()
  })

  it('muestra la semilla y los valores Postman generados en la solicitud', () => {
    renderWithI18n(
      <ApiExecutionConsolePage
        selectedTest={{ id: 'case-1', code: 'TC-API-001', title: 'Health check', configuracion_api: { request: { method: 'GET', url: '{{$randomUUID}}' } } }}
        apiExecutionResults={{
          tests: [{ id: 'case-1', code: 'TC-API-001', title: 'Health check', configuracion_api: { request: { method: 'GET', url: '{{$randomUUID}}' } } }],
          executions: [{ case_id: 'case-1', status: 'PASO', result: { status: 'PASSED', dynamic_variables: { seed: 'fixture-seed', values: { '$randomUUID': '00000000-0000-4000-8000-000000000001' } }, steps: [{ request: { method: 'GET', url: 'https://api.test/00000000-0000-4000-8000-000000000001' }, response: { status: 200, body: '{}' } }] } }],
          dataset_preview: { variables_resueltas: {} },
        }}
        currentProjectEnvironments={[]}
        returnToExecutionList={vi.fn()}
        onExecuteRequest={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Solicitud y variables' }))
    expect(document.body.textContent).toContain('Semilla: fixture-seed')
    fireEvent.click(screen.getByLabelText('Mostrar valores resueltos'))
    expect(document.body.textContent).toContain('GET00000000-0000-4000-8000-000000000001')
    expect(document.body.textContent).toContain('00000000-0000-4000-8000-000000000001')
  })

  it('ofrece crear bug solo cuando la ejecución API tiene un fallo', () => {
    const onPrepareApiBug = vi.fn()
    renderWithI18n(
      <ApiExecutionConsolePage
        selectedTest={{ id: 'case-1', code: 'TC-API-001', title: 'Health check' }}
        apiExecutionResults={{
          tests: [{ id: 'case-1', code: 'TC-API-001', title: 'Health check' }],
          executions: [{ case_id: 'case-1', execution_id: 'execution-1', status: 'FALLO', result: { status: 'FAILED', manual_evaluation: { status: 'FALLO', notes: 'La respuesta no es aceptable para el negocio.' }, steps: [{ response: { status: 500 }, assertions: [{ name: 'HTTP 200', status: 'FAILED', expected: 200, actual: 500 }] }] } }],
          environment_name: 'API QA',
          dataset_name: 'Dataset API demo',
        }}
        currentProjectEnvironments={[]}
        returnToExecutionList={vi.fn()}
        onPrepareApiBug={onPrepareApiBug}
      />,
    )

    expect(screen.getAllByRole('button', { name: /Crear bug nuevo/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /Crear bug nuevo/ }))
    expect(onPrepareApiBug).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'case-1' }),
      expect.objectContaining({ execution_id: 'execution-1' }),
    )

    expect(screen.getByText('Reportar un bug con esta ejecución')).toBeTruthy()
    expect(onPrepareApiBug).toHaveBeenCalledTimes(1)
  })

  it('no ofrece crear bug para una ejecución API aprobada', () => {
    renderWithI18n(
      <ApiExecutionConsolePage
        selectedTest={{ id: 'case-1', code: 'TC-API-001', title: 'Health check' }}
        apiExecutionResults={{
          tests: [{ id: 'case-1', code: 'TC-API-001', title: 'Health check' }],
          executions: [{ case_id: 'case-1', status: 'PASO', result: { status: 'PASSED', steps: [{ response: { status: 200 }, assertions: [{ name: 'HTTP 200', status: 'PASSED', expected: 200, actual: 200 }] }] } }],
        }}
        currentProjectEnvironments={[]}
        returnToExecutionList={vi.fn()}
        onPrepareApiBug={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: /Crear bug nuevo/ })).toBeNull()
  })

  it('limita los bugs relacionados a dos y permite expandirlos y contraerlos', () => {
    renderWithI18n(
      <ApiExecutionConsolePage
        selectedTest={{ id: 'case-1', code: 'TC-API-001', title: 'Health check' }}
        apiExecutionResults={{
          tests: [{ id: 'case-1', code: 'TC-API-001', title: 'Health check' }],
          executions: [{ case_id: 'case-1', status: 'FALLO', result: { status: 'FAILED', steps: [{ response: { status: 500 } }] } }],
        }}
        relatedCaseBugs={[
          { id: 'bug-1', codigo: 'BUG-1', titulo: 'Primer bug', estado: 'ABIERTO' },
          { id: 'bug-2', codigo: 'BUG-2', titulo: 'Segundo bug', estado: 'ABIERTO' },
          { id: 'bug-3', codigo: 'BUG-3', titulo: 'Tercer bug', estado: 'ABIERTO' },
        ]}
        returnToExecutionList={vi.fn()}
      />,
    )

    expect(screen.getByText(/BUG-1/)).toBeTruthy()
    expect(screen.getByText(/BUG-2/)).toBeTruthy()
    expect(screen.queryByText(/BUG-3/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver 1 bugs más' }))
    expect(screen.getByText(/BUG-3/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ver menos' }))
    expect(screen.queryByText(/BUG-3/)).toBeNull()
  })

  it('guarda el veredicto visible aunque el usuario no cambie el valor del selector', () => {
    const onSaveApiEvaluation = vi.fn().mockResolvedValue({ status: 'FALLO' })
    renderWithI18n(
      <ApiExecutionConsolePage
        selectedTest={{ id: 'case-1', code: 'TC-API-001', title: 'Health check' }}
        apiExecutionResults={{
          tests: [{ id: 'case-1', code: 'TC-API-001', title: 'Health check' }],
          executions: [{ case_id: 'case-1', execution_id: 'execution-1', status: 'FALLO', result: { status: 'FAILED', steps: [{ response: { status: 500 }, assertions: [{ name: 'HTTP 200', status: 'FAILED', expected: 200, actual: 500 }] }] } }],
        }}
        returnToExecutionList={vi.fn()}
        onSaveApiEvaluation={onSaveApiEvaluation}
      />,
    )

    expect((screen.getByLabelText('Resultado del caso') as HTMLSelectElement).value).toBe('FALLO')
    fireEvent.click(screen.getByRole('button', { name: /Guardar veredicto/ }))
    expect(onSaveApiEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({ execution_id: 'execution-1' }),
      'FALLO',
      '',
    )
  })

  it('pregunta si reportar ahora o después cuando el caso tiene bugs abiertos', async () => {
    const onSaveApiEvaluation = vi.fn().mockResolvedValue({ status: 'FALLO' })
    renderWithI18n(
      <ApiExecutionConsolePage
        selectedTest={{ id: 'case-1', code: 'TC-API-001', title: 'Health check' }}
        apiExecutionResults={{
          tests: [{ id: 'case-1', code: 'TC-API-001', title: 'Health check' }],
          executions: [{ case_id: 'case-1', execution_id: 'execution-1', status: 'FALLO', result: { status: 'FAILED', steps: [{ response: { status: 500 } }] } }],
        }}
        returnToExecutionList={vi.fn()}
        onSaveApiEvaluation={onSaveApiEvaluation}
        onApiVerdictSaved={vi.fn().mockResolvedValue({ relatedBugs: [{ id: 'bug-1', codigo: 'BUG-1' }] })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Guardar veredicto/ }))
    expect(await screen.findByText(/Podés dejarla pendiente o crear ahora/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reportar ahora' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Reportar después/ }).find(button => button.textContent === 'Reportar después')).toBeTruthy()
  })

  it('pregunta si reportar ahora o después aunque todavía no haya bugs relacionados', async () => {
    const onSaveApiEvaluation = vi.fn().mockResolvedValue({ status: 'BLOQUEADO' })
    renderWithI18n(
      <ApiExecutionConsolePage
        selectedTest={{ id: 'case-1', code: 'TC-API-001', title: 'Health check' }}
        apiExecutionResults={{
          tests: [{ id: 'case-1', code: 'TC-API-001', title: 'Health check' }],
          executions: [{ case_id: 'case-1', execution_id: 'execution-1', status: 'BLOCKED', result: { status: 'BLOCKED', steps: [] } }],
        }}
        returnToExecutionList={vi.fn()}
        onSaveApiEvaluation={onSaveApiEvaluation}
        onApiVerdictSaved={vi.fn().mockResolvedValue({ relatedBugs: [] })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Guardar veredicto/ }))
    expect(await screen.findByText(/Podés dejarla pendiente o crear ahora/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reportar ahora' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reportar después' })).toBeTruthy()
  })
})
