// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { interpolate } from '../../i18n/index'
import es from '../../i18n/catalogs/es/casos'
import en from '../../i18n/catalogs/en/casos'
import { ApiAssertionBuilder } from './ApiAssertionBuilder'
import type { ApiAssertion } from './apiAssertions'

type Catalog = Readonly<Record<string, string>>

const translator = (catalog: Catalog) => (key: string, params?: Record<string, string | number>) => (
  interpolate(catalog[key.replace(/^casos\./, '')] || key, params)
)

const commonProps = (overrides: Partial<ComponentProps<typeof ApiAssertionBuilder>> = {}) => ({
  assertions: [],
  onChange: vi.fn(),
  advancedText: '[]',
  onAdvancedTextChange: vi.fn(),
  onAdvancedBlur: vi.fn(),
  advancedDirty: false,
  onAdvancedDirtyChange: vi.fn(),
  t: translator(en),
  ...overrides,
})

afterEach(cleanup)

describe('ApiAssertionBuilder', () => {
  it('localiza la interfaz guiada en inglés y conserva los valores técnicos', () => {
    const assertion: ApiAssertion = {
      id: 'assertion-fixed',
      name: 'Nombre escrito por el usuario',
      source: 'response.status',
      operator: 'equals',
      expected: 200,
      expected_type: 'number',
      severity: 'must',
    }

    render(<ApiAssertionBuilder {...commonProps({ assertions: [assertion], t: translator(en) })} />)

    expect(screen.getByText('Response checks')).toBeTruthy()
    expect(screen.getByText('HTTP status equals 200')).toBeTruthy()
    expect(screen.getByLabelText('HTTP status')).toHaveValue('equals')
    expect(screen.getByLabelText('Expected code')).toHaveValue(200)
    expect(screen.getByText('Required: fails the case if it is not satisfied.')).toBeTruthy()
    expect(screen.queryByText('Comprobaciones de la respuesta')).toBeNull()
  })

  it('localiza los campos de JSON y deja intactos selector, operador y expected', () => {
    const assertion: ApiAssertion = {
      id: 'assertion-json',
      name: 'Valor esperado en el JSON',
      source: 'response.body',
      selector: '$.customer.id',
      operator: 'equals',
      expected: 'customer-42',
      expected_type: 'text',
      severity: 'warning',
    }
    const onChange = vi.fn()

    render(<ApiAssertionBuilder {...commonProps({ assertions: [assertion], onChange, t: translator(en) })} />)

    expect(screen.getByLabelText('JSON field')).toHaveValue('customer.id')
    expect(screen.getByLabelText('This field')).toHaveValue('equals')
    expect(screen.getByLabelText('Expected value')).toHaveValue('customer-42')
    expect(screen.getByText('Warning: does not fail the case.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('This field'), { target: { value: 'contains' } })
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({
      id: 'assertion-json',
      name: 'Valor esperado en el JSON',
      source: 'response.body',
      selector: '$.customer.id',
      operator: 'contains',
      expected: 'customer-42',
      expected_type: 'text',
      severity: 'warning',
    })])
  })

  it('mantiene los datos persistidos al agregar una comprobación desde el catálogo español', () => {
    const onChange = vi.fn()
    render(<ApiAssertionBuilder {...commonProps({ onChange, t: translator(es) })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Agregar comprobación' }))
    const added = onChange.mock.calls.at(-1)?.[0]?.[0]

    expect(added).toMatchObject({
      source: 'response.status',
      operator: 'equals',
      expected: 200,
      expected_type: 'number',
      severity: 'must',
      name: 'Estado HTTP esperado',
    })
    expect(added.id).toMatch(/^assertion-/)
    expect(screen.getByText('Comprobaciones de la respuesta')).toBeTruthy()
  })
})
