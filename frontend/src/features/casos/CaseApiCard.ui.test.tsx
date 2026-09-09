// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CaseApiCard } from './CaseApiCard'

const apiConfig = {
  schema_version: 'treseko.api-test/v1',
  request: {
    method: 'GET',
    url: '{{base_url}}',
    headers: [],
    query: [],
    cookies: [],
    auth: { type: 'none' },
    body: { mode: 'none' },
  },
  assertions: [],
  extractors: [],
}

const renderApiCard = (config: Record<string, any> = apiConfig) => {
  const setNewTestApiConfig = vi.fn()
  const showFeedback = vi.fn()
  const view = render(
    <CaseApiCard
      context={{
        newTestFormat: 'API',
        newTestApiConfig: config,
        setNewTestApiConfig,
        fetchWithAuth: vi.fn(),
        selectedTest: { id: 'case-api-1' },
        apiCaseId: 'case-api-1',
        currentBuildId: 'build-1',
        projectEnvironments: [{ id: 'env-1', name: 'QA', active: true, datasets: [] }],
        showFeedback,
      }}
    />,
  )
  return { ...view, setNewTestApiConfig, showFeedback }
}

function StatefulApiCard({ initialConfig = apiConfig }: { initialConfig?: Record<string, any> }) {
  const [config, setConfig] = useState(initialConfig)
  return (
    <CaseApiCard
      context={{
        newTestFormat: 'API',
        newTestApiConfig: config,
        setNewTestApiConfig: setConfig,
        fetchWithAuth: vi.fn(),
        selectedTest: { id: 'case-api-1' },
        apiCaseId: 'case-api-1',
        currentBuildId: 'build-1',
        projectEnvironments: [{ id: 'env-1', name: 'QA', active: true, datasets: [] }],
        showFeedback: vi.fn(),
      }}
    />
  )
}

afterEach(cleanup)

describe('CaseApiCard', () => {
  it('ejecuta un dry-run antes de guardar el caso y no exige una build', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(new Response(JSON.stringify({ dry_run: true, status: 'PASSED', result: { status: 'PASSED', steps: [] } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    render(
      <CaseApiCard
        context={{
          newTestFormat: 'API', newTestApiConfig: apiConfig, setNewTestApiConfig: vi.fn(), fetchWithAuth,
          selectedTest: null, apiCaseId: '', currentProjectId: 'project-1', currentBuildId: '',
          projectEnvironments: [{ id: 'env-1', name: 'QA', active: true, datasets: [] }], showFeedback: vi.fn(),
        }}
      />,
    )

    fireEvent.change(screen.getByLabelText('Ambiente'), { target: { value: 'env-1' } })
    fireEvent.click(screen.getByRole('button', { name: /Probar solicitud/ }))
    await vi.waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith('/api/api-tests/dry-run', expect.objectContaining({ method: 'POST' })))
    expect(JSON.parse(fetchWithAuth.mock.calls[0][1].body)).toMatchObject({ proyecto_id: 'project-1', entorno_id: 'env-1', configuracion_api: apiConfig })
  })

  it('muestra el resumen visible y separa respuesta y validaciones en el modal', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      dry_run: true,
      status: 'PASSED',
      result: { status: 'PASSED', duration_ms: 42, steps: [{ response: { status: 200, body: '{"ok":true}' }, assertions: [{ status: 'PASSED' }] }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    render(<CaseApiCard context={{
      newTestFormat: 'API', newTestApiConfig: apiConfig, setNewTestApiConfig: vi.fn(), fetchWithAuth,
      selectedTest: null, apiCaseId: '', currentProjectId: 'project-1', currentBuildId: '',
      projectEnvironments: [{ id: 'env-1', name: 'QA', active: true, datasets: [] }], showFeedback: vi.fn(),
    }} />)

    fireEvent.change(screen.getByLabelText('Ambiente'), { target: { value: 'env-1' } })
    fireEvent.click(screen.getByRole('button', { name: /Probar solicitud/ }))
    expect(await screen.findByText('Resultado de la prueba')).toBeTruthy()
    expect(screen.getByText('HTTP 200')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ver resultado de la prueba' }))
    expect(await screen.findByText('Resultado de la prueba API')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Respuesta recibida' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Validaciones realizadas' })).toBeTruthy()
    expect(screen.getByText('1 aprobadas · 0 fallidas')).toBeTruthy()
    expect(document.body.textContent).toContain('ok')
  })

  it('hidrata la configuración del caso seleccionado cuando el editor aún tiene el borrador genérico', () => {
    const configuredCase = {
      id: 'case-api-003',
      configuracion_api: {
        schema_version: 'treseko.api-test/v2',
        request: {
          method: 'POST',
          url: '{{base_url}}/anything',
          query: [{ key: 'case', value: 'api-003', enabled: true }],
          headers: [{ key: 'X-Treseko-Example', value: 'postman-completo', enabled: true }],
          auth: { type: 'bearer', variable: 'api_token' },
          body: { mode: 'raw', media_type: 'application/json', content: { enabled: true } },
        },
        assertions: [
          { id: 'status', source: 'response.status', operator: 'equals', expected: 200 },
          { id: 'enabled', source: 'response.body', selector: '$.json.enabled', operator: 'equals', expected: true },
        ],
      },
    }
    function HydratingApiCard() {
      const [config, setConfig] = useState(apiConfig)
      return <CaseApiCard context={{
        newTestFormat: 'API', newTestApiConfig: config, setNewTestApiConfig: setConfig,
        fetchWithAuth: vi.fn(), selectedTest: configuredCase, apiCaseId: configuredCase.id,
        currentBuildId: 'build-1', projectEnvironments: [{ id: 'env-1', name: 'QA', active: true, datasets: [] }],
        showFeedback: vi.fn(),
      }} />
    }
    render(<HydratingApiCard />)

    expect(screen.getByLabelText('Método HTTP')).toHaveValue('POST')
    expect(screen.getByDisplayValue('{{base_url}}/anything')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Parámetros 1/ })).toBeTruthy()
    expect(screen.getByText('2 validaciones')).toBeTruthy()
  })

  it('no rompe la consola si la carga tardía del detalle no tiene autenticación disponible', () => {
    const configuredCase = {
      id: 'case-api-004',
      configuracion_api: {
        ...apiConfig,
        request: { ...apiConfig.request, url: '{{base_url}}/status/500' },
      },
    }

    render(
      <CaseApiCard
        context={{
          newTestFormat: 'API',
          newTestApiConfig: apiConfig,
          setNewTestApiConfig: vi.fn(),
          selectedTest: configuredCase,
          apiCaseId: configuredCase.id,
          currentBuildId: 'build-1',
          projectEnvironments: [],
          showFeedback: vi.fn(),
        }}
      />,
    )

    expect(screen.getByText('Solicitud y validaciones API')).toBeTruthy()
  })

  it('presenta un flujo guiado y deja la configuración técnica plegada', () => {
    const { container } = renderApiCard()

    const contextBar = screen.getByRole('group', { name: 'Contexto de ejecución API' })
    const requestSection = screen.getByRole('region', { name: 'Solicitud' })
    expect(contextBar.compareDocumentPosition(requestSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByLabelText('Ambiente')).toBeTruthy()
    expect(screen.getByLabelText('Dataset')).toBeTruthy()
    expect(screen.getByText('Solicitud y validaciones API')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Parámetros/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Autorización' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Encabezados/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Contenido' })).toBeTruthy()
    expect((container.querySelector('.api-advanced-disclosure') as HTMLDetailsElement).open).toBe(false)
  })

  it('mantiene el editor enfocado en la solicitud sin mostrar el catálogo externo', () => {
    const fetchWithAuth = vi.fn()
    render(<CaseApiCard context={{
      newTestFormat: 'API', newTestApiConfig: apiConfig, setNewTestApiConfig: vi.fn(), fetchWithAuth,
      selectedTest: null, apiCaseId: '', currentProjectId: 'project-1', currentBuildId: '',
      projectEnvironments: [{ id: 'env-1', name: 'API Lab QA', active: true, datasets: [] }], showFeedback: vi.fn(),
    }} />)

    expect(screen.queryByText('Catálogo del servicio API')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cargar operaciones' })).toBeNull()
    expect(screen.getByLabelText('Método HTTP')).toBeTruthy()
    expect(screen.getByLabelText('URL de la solicitud API')).toBeTruthy()
    expect(fetchWithAuth).not.toHaveBeenCalled()
  })

  it('edita params con filas legibles sin requerir JSON', () => {
    const config = { ...apiConfig, request: { ...apiConfig.request, query: [{ key: 'page', value: '1', enabled: true }] } }
    const { setNewTestApiConfig } = renderApiCard(config)
    const value = screen.getByLabelText('Valor de parámetro 1')

    fireEvent.change(value, { target: { value: '2' } })

    expect(setNewTestApiConfig).toHaveBeenCalledTimes(1)
    expect(setNewTestApiConfig.mock.calls[0][0].request.query[0]).toMatchObject({ key: 'page', value: '2' })
  })

  it('agrega un parámetro vacío y permite completarlo antes de guardar', () => {
    render(<StatefulApiCard />)

    fireEvent.click(screen.getByRole('button', { name: 'Agregar parámetro' }))

    const name = screen.getByLabelText('Nombre de parámetro 1')
    const value = screen.getByLabelText('Valor de parámetro 1')
    expect(name).toHaveFocus()
    fireEvent.change(name, { target: { value: 'page' } })
    fireEvent.change(value, { target: { value: '2' } })

    expect(name).toHaveValue('page')
    expect(value).toHaveValue('2')
    expect(screen.getByRole('tab', { name: /Parámetros 1/ })).toBeTruthy()
  })

  it('ofrece headers frecuentes y conserva la opción de agregar uno personalizado', () => {
    render(<StatefulApiCard />)

    fireEvent.click(screen.getByRole('tab', { name: /Encabezados/ }))

    const addButton = screen.getByRole('button', { name: 'Agregar header personalizado' })
    expect(addButton).toBeTruthy()
    const list = document.querySelector('#api-common-header-options')
    expect(list?.querySelectorAll('option')).toHaveLength(10)
    expect(list?.querySelector('option[value="Idempotency-Key"]')).toBeTruthy()
  })

  it('normaliza el modo histórico form-data al formato que ejecuta el runner', () => {
    const config = { ...apiConfig, request: { ...apiConfig.request, body: { mode: 'form-data', content: [] } } }
    const { setNewTestApiConfig } = renderApiCard(config)

    fireEvent.click(screen.getByRole('tab', { name: 'Contenido' }))
    const bodyMode = screen.getByLabelText('Tipo de body')
    expect((bodyMode as HTMLSelectElement).value).toBe('formdata')
    fireEvent.change(bodyMode, { target: { value: 'urlencoded' } })

    expect(setNewTestApiConfig.mock.calls[0][0].request.body.mode).toBe('urlencoded')
    expect(setNewTestApiConfig.mock.calls[0][0].request.body.fields).toEqual([])
  })

  it('permite crear una validación tipada desde el constructor visual', () => {
    const { setNewTestApiConfig } = renderApiCard()

    fireEvent.click(screen.getByRole('button', { name: /Agregar comprobación/ }))

    expect(setNewTestApiConfig).toHaveBeenCalledTimes(1)
    expect(setNewTestApiConfig.mock.calls[0][0].assertions[0].source).toBe('response.status')
    expect(setNewTestApiConfig.mock.calls[0][0].assertions[0].expected).toBe(200)
  })

  it('mantiene el JSON completo como opción avanzada y muestra errores en línea', () => {
    const { container, setNewTestApiConfig, showFeedback } = renderApiCard()
    const rawDefinition = screen.getByLabelText('Definición JSON completa de la prueba API')

    fireEvent.change(rawDefinition, { target: { value: '{invalid' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar JSON' }))

    expect(container.textContent).toContain('JSON inválido')
    expect(setNewTestApiConfig).not.toHaveBeenCalled()
    expect(showFeedback).not.toHaveBeenCalled()
  })

  it('solo valida el JSON avanzado de assertions después de que fue editado', () => {
    const { showFeedback } = renderApiCard()
    fireEvent.click(screen.getByRole('button', { name: /JSON avanzado/ }))
    const assertions = screen.getByLabelText('Definición técnica de las comprobaciones')

    fireEvent.focus(assertions)
    fireEvent.blur(assertions)
    expect(showFeedback).not.toHaveBeenCalled()

    fireEvent.change(assertions, { target: { value: '{invalid' } })
    fireEvent.blur(assertions)
    expect(screen.getByRole('alert').textContent).toContain('El JSON no es válido')
    expect(showFeedback).not.toHaveBeenCalled()
  })

  it('configura una comprobación de texto sin exponer campos técnicos', () => {
    const { setNewTestApiConfig } = renderApiCard()
    fireEvent.change(screen.getByLabelText('¿Qué querés comprobar?'), { target: { value: 'text' } })
    fireEvent.click(screen.getByRole('button', { name: /Agregar comprobación/ }))

    const created = setNewTestApiConfig.mock.calls[0][0].assertions[0]
    expect(created).toMatchObject({ source: 'response.text', operator: 'contains', expected_type: 'text' })
  })
})
