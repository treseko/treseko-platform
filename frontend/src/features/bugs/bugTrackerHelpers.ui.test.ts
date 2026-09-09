import { describe, expect, it } from 'vitest'
import { bugDisplayType } from './bugTrackerHelpers'

describe('bugDisplayType', () => {
  it('clasifica explícitamente cada tipo visible de bug', () => {
    expect(bugDisplayType({ tipo_contexto: 'CONVERSACIONAL' })).toBe('CONVERSACIONAL')
    expect(bugDisplayType({ tipo_contexto: 'API' })).toBe('API')
    expect(bugDisplayType({ tipo_contexto: 'CLASICO' })).toBe('CLASICO')
  })

  it('reconoce bugs API heredados por el formato y conserva el resto como clásicos', () => {
    expect(bugDisplayType({ tipo_contexto: 'CLASICO', formato_prueba: 'API' })).toBe('API')
    expect(bugDisplayType({ metadata_json: { format: 'API' } })).toBe('API')
    expect(bugDisplayType({})).toBe('CLASICO')
  })

  it('usa el contexto API cargado en el detalle como compatibilidad', () => {
    expect(bugDisplayType({ tipo_contexto: 'CLASICO' }, true)).toBe('API')
  })
})
