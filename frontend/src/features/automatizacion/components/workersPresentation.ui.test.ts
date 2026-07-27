import { describe, expect, it, vi } from 'vitest'
import { effectiveStatus, formatDuration, getFrameworkLanguageRows, jobStatusVariant } from './workersPresentation'

describe('presentación de workers', () => {
  it('clasifica un worker sin heartbeat como offline y uno deshabilitado como disabled', () => {
    expect(effectiveStatus({ activo: true, ultimo_heartbeat: null, estado: 'ONLINE' } as any)).toBe('OFFLINE')
    expect(effectiveStatus({ activo: false, ultimo_heartbeat: new Date().toISOString(), estado: 'ONLINE' } as any)).toBe('DISABLED')
  })

  it('mantiene la matriz oficial de framework y lenguaje', () => {
    expect(getFrameworkLanguageRows({ frameworks: ['playwright'] })).toEqual([{ framework: 'playwright', languages: 'JavaScript, TypeScript' }])
  })

  it('conserva estados y duración de los jobs', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T15:01:05Z'))
    expect(jobStatusVariant('BLOCKED_BY_RUNNER')).toBe('secondary')
    expect(formatDuration('2026-07-26T15:00:00Z')).toBe('1m 5s')
    vi.useRealTimers()
  })
})
