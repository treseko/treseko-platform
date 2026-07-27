import { describe, expect, it, vi } from 'vitest'
import { createIaLog } from './executionPresentation'

describe('logs de ejecución IA', () => {
  it('preserva nivel, origen, fecha y contexto', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T16:00:00Z'))
    expect(createIaLog('queue', 'Esperando', { executionId: 'run-1' })).toEqual({
      ts: '2026-07-26T16:00:00.000Z', level: 'queue', source: 'QUEUE', message: 'Esperando', executionId: 'run-1'
    })
    vi.useRealTimers()
  })
})
