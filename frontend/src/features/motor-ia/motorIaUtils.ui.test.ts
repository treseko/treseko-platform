import { describe, expect, it } from 'vitest'
import { getLatestQueueItem, selectConsoleLogs } from './motorIaUtils'
import type { IaLogEntry, IaQueueItem } from './motorIaTypes'

const queueItem = (overrides: Partial<IaQueueItem>): IaQueueItem => ({
  caseId: 'case-1',
  executionId: 'execution-1',
  caseCode: 'TC-1',
  caseTitle: 'Caso',
  component: 'Web',
  status: 'PASO',
  ...overrides,
})

const log = (executionId: string, index: number): IaLogEntry => ({
  ts: `2026-08-30T20:00:${String(index).padStart(2, '0')}Z`,
  level: 'engine',
  executionId,
  message: `Evento ${index}`,
})

describe('monitor Motor IA', () => {
  it('identifica la ejecucion mas reciente por su fecha efectiva', () => {
    const older = queueItem({ executionId: 'older', endedAt: '2026-08-30T20:00:00Z' })
    const latest = queueItem({ executionId: 'latest', startedAt: '2026-08-30T21:00:00Z' })

    expect(getLatestQueueItem([older, latest])).toBe(latest)
  })

  it('muestra solo los eventos de la ultima ejecucion y respeta el limite visual', () => {
    const latest = queueItem({ executionId: 'latest' })
    const logs = [log('older', 1), ...Array.from({ length: 60 }, (_, index) => log('latest', index))]

    const selected = selectConsoleLogs(logs, latest, false)

    expect(selected).toHaveLength(50)
    expect(selected.every(item => item.executionId === 'latest')).toBe(true)
    expect(selected.at(-1)?.message).toBe('Evento 59')
  })
})
