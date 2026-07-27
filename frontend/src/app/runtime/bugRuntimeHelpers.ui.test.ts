import { describe, expect, it } from 'vitest'
import { attachmentIds, getLatestFailureExecutionContext, isExecutionHistoryItemFromBuild, isFailureStatus, uniqueAttachmentList } from './bugRuntimeHelpers'

describe('bug runtime helpers', () => {
  it.each(['FALLO', 'fallido', 'BLOQUEADO'])('detecta %s como fallo', (status) => expect(isFailureStatus(status)).toBe(true))
  it.each(['PASO', 'SIN_CORRER', undefined])('no detecta %s como fallo', (status) => expect(isFailureStatus(status)).toBe(false))

  it('limita el historial al build activo cuando corresponde', () => {
    const test = { history: [{ status: 'FALLO', executionId: 'run-1', snapshotId: 'snap-1', buildId: 'build-1', observation: 'falló' }] }
    expect(getLatestFailureExecutionContext(test, 'build-1', true)).toMatchObject({ executionId: 'run-1', snapshotId: 'snap-1', note: 'falló' })
    expect(getLatestFailureExecutionContext(test, 'build-2', true).executionId).toBeNull()
    expect(isExecutionHistoryItemFromBuild({ build_id: 'build-1' }, 'build-1')).toBe(true)
  })

  it('no fabrica contexto cuando el último resultado no es fallo', () => {
    expect(getLatestFailureExecutionContext({ history: [{ status: 'PASO', executionId: 'run-1' }] }).historyItem).toBeNull()
  })

  it('deduplica adjuntos, ignora IDs vacíos y devuelve IDs estables', () => {
    const attachments: any[] = [{ id: 'a' }, { id: 'a' }, { id: '' }, { id: 'b' }]
    expect(uniqueAttachmentList(attachments).map((item) => item.id)).toEqual(['a', 'b'])
    expect(attachmentIds(attachments)).toEqual(['a', 'b'])
  })
})
