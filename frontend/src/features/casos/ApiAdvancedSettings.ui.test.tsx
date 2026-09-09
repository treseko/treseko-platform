// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import es from '../../i18n/catalogs/es/casos'
import en from '../../i18n/catalogs/en/casos'
import { ApiAdvancedSettings } from './ApiAdvancedSettings'

type Catalog = Readonly<Record<string, string>>

const translator = (catalog: Catalog) => (key: string) => {
  const catalogKey = key.replace(/^casos\./, '') as keyof Catalog
  return catalog[catalogKey] || key
}

const baseConfig = {
  schema_version: 'treseko.api-test/v2',
  variables: {},
  extractors: [],
  execution: { iterations: 1, parallelism: 1, fail_fast: true },
  pre_request_script: "pm.variables.set('id', '123')",
  post_response_script: "pm.test('status', () => pm.response.to.have.status(200))",
}

const baseRequest = {
  cookies: [],
  timeout: { total_ms: 45000 },
  redirects: { follow: false },
}

afterEach(cleanup)

describe('ApiAdvancedSettings', () => {
  it('muestra todos sus textos propios en inglés sin traducir datos técnicos', () => {
    render(
      <ApiAdvancedSettings
        config={{ ...baseConfig, variables: { access_token: 'secret-value' }, extractors: [{ name: 'api.token', source: 'response.headers', selector: '$.token', required: true }] }}
        request={{ ...baseRequest, cookies: [{ key: 'session', value: 'cookie-value', enabled: true }] }}
        onConfigChange={vi.fn()}
        onRequestChange={vi.fn()}
        t={translator(en)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'HTTP cookies and options' }))
    expect(screen.getByText('Optional configuration for sessions, redirects, and timeouts.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Variables and chaining' }))
    expect(screen.getByText('Case variables')).toBeTruthy()
    expect(screen.getByText('{{nombre}}')).toBeTruthy()
    expect(screen.getByText('Save response data')).toBeTruthy()
    expect(screen.getByLabelText('Required extractor 1')).toBeTruthy()
    expect(screen.getByPlaceholderText('Variable name')).toBeTruthy()
    expect(screen.getByLabelText('Value of cookie 1')).toBeTruthy()
    expect(screen.getByDisplayValue('$.token')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Postman-compatible scripts' }))
    expect(screen.getByText('Before sending')).toBeTruthy()
    expect(screen.getByText('After receiving the response')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Execution options' }))
    expect(screen.getByText('Stop on first failure')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Complete JSON definition' }))
    expect(screen.getByLabelText('Complete JSON definition of the API test')).toBeTruthy()
    expect(screen.queryByText('Definición JSON completa')).toBeNull()
  })

  it('mantiene los valores técnicos y el contrato de payload al editar variables y extractores', () => {
    const onConfigChange = vi.fn()
    const onRequestChange = vi.fn()
    render(
      <ApiAdvancedSettings
        config={baseConfig}
        request={baseRequest}
        onConfigChange={onConfigChange}
        onRequestChange={onRequestChange}
        t={translator(en)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Variables and chaining' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }))
    fireEvent.change(screen.getByLabelText('Variable name of variable 1'), { target: { value: 'api_token' } })
    fireEvent.change(screen.getByLabelText('Value of variable 1'), { target: { value: 'secret-value' } })

    const variableUpdate = onConfigChange.mock.calls.at(-1)?.[0]
    expect(variableUpdate).toMatchObject({
      schema_version: 'treseko.api-test/v2',
      variables: { api_token: 'secret-value' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add extractor' }))
    const extractorUpdate = onConfigChange.mock.calls.at(-1)?.[0]
    expect(extractorUpdate.extractors[0]).toMatchObject({ source: 'response.body', selector: '$', required: true })
    expect(extractorUpdate.extractors[0]).not.toHaveProperty('sourceLabel')
    expect(onRequestChange).not.toHaveBeenCalled()
  })

  it('localiza el error JSON y no aplica configuraciones inválidas', () => {
    const onConfigChange = vi.fn()
    render(
      <ApiAdvancedSettings
        config={baseConfig}
        request={baseRequest}
        onConfigChange={onConfigChange}
        onRequestChange={vi.fn()}
        t={translator(en)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Complete JSON definition' }))
    const rawConfig = screen.getByLabelText('Complete JSON definition of the API test')
    fireEvent.change(rawConfig, { target: { value: '[' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }))

    expect(screen.getByText('The JSON is invalid. Check the syntax before applying the changes.')).toBeTruthy()
    expect(onConfigChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/Unexpected end|position/i)).toBeNull()
  })

  it('conserva las etiquetas españolas y los mismos valores técnicos', () => {
    const onConfigChange = vi.fn()
    render(
      <ApiAdvancedSettings
        config={{ ...baseConfig, extractors: [{ name: 'api.token', source: 'response.status', selector: '$', required: true }] }}
        request={baseRequest}
        onConfigChange={onConfigChange}
        onRequestChange={vi.fn()}
        t={translator(es)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Variables y encadenamiento' }))
    expect(screen.getByText('Guardar datos de la respuesta')).toBeTruthy()
    expect(screen.getByDisplayValue('api.token')).toBeTruthy()
    expect(screen.getByDisplayValue('$')).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Estado HTTP' })).toHaveValue('response.status')
  })
})
