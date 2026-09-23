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

  it('limpia la evidencia legacy al agregar o quitar adjuntos', () => {
    let steps: any[] = [{ action: 'uno', actionImg: 'legacy-action', actionAttachments: [{ id: 'old' }] }]
    const setSteps: any = (next: any) => { steps = typeof next === 'function' ? next(steps) : next }
    const actions = createCaseStepEditorActions(steps, setSteps)

    actions.updateStepAttachments(0, 'actionAttachments', [{ id: 'new' } as any])

    expect(steps[0].actionAttachments).toEqual([{ id: 'new' }])
    expect(steps[0].actionImg).toBe('')
  })

  it('acumula dos respuestas de pegado aunque lleguen con el mismo estado inicial', () => {
    let steps: any[] = [{ action: 'uno', actionAttachments: [] }]
    const setSteps: any = (next: any) => { steps = typeof next === 'function' ? next(steps) : next }
    const actions = createCaseStepEditorActions(steps, setSteps)

    actions.updateStepAttachments(0, 'actionAttachments', current => [...current, { id: 'image-1' } as any])
    actions.updateStepAttachments(0, 'actionAttachments', current => [...current, { id: 'image-2' } as any])

    expect(steps[0].actionAttachments.map((item: any) => item.id)).toEqual(['image-1', 'image-2'])
  })

  it('inserta un paso vacío inmediatamente después del paso seleccionado', () => {
    let steps: any[] = [{ action: 'uno' }, { action: 'dos' }]
    const setSteps: any = (next: any) => { steps = typeof next === 'function' ? next(steps) : next }

    createCaseStepEditorActions(steps, setSteps).addStepInput(0)

    expect(steps.map(item => item.action)).toEqual(['uno', '', 'dos'])
  })
})
