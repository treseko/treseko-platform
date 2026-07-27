import { describe, expect, it } from 'vitest'
import { createCaseStepEditorActions } from './caseStepEditorActions'

describe('acciones de pasos del editor de casos', () => {
  it('duplica adjuntos sin compartir referencias y mueve pasos válidos', () => {
    let steps: any[] = [{ action: 'uno', actionAttachments: [{ id: 'a' }], expectedAttachments: [] }, { action: 'dos' }]
    const setSteps: any = (next: any) => { steps = typeof next === 'function' ? next(steps) : next }
    const actions = createCaseStepEditorActions(steps, setSteps)
    actions.duplicateStepInput(0)
    expect(steps).toHaveLength(3)
    expect(steps[1].actionAttachments).not.toBe(steps[0].actionAttachments)
    createCaseStepEditorActions(steps, setSteps).moveStepInput(2, 'up')
    expect(steps.map(item => item.action)).toEqual(['uno', 'dos', 'uno'])
  })
})
