// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useCaseEditorState } from './useCaseEditorState'

describe('useCaseEditorState', () => {
  it.each([
    ['clásica', (state: any) => state.setNewTestTitle('Título actualizado')],
    ['automatizada', (state: any) => {
      state.setNewTestType('Automatizada')
      state.setNewTestScript('test("actualizado")')
    }],
    ['API', (state: any) => {
      state.setNewTestApiConfig({
        schema_version: 'treseko.api-test/v1',
        request: { method: 'POST', url: '/v1/orders', headers: [] },
        assertions: [],
      })
    }],
    ['conversacional', (state: any) => {
      state.setNewTestChatbotConfig({
        conversation: {
          turns: [{
            order: 1,
            role: 'user',
            input: { mode: 'fixed', text: 'mensaje actualizado' },
            expected: { semantic: 'responde' },
          }],
        },
      })
    }],
  ])('detecta cambios en una definición %s', (_label, edit) => {
    const { result } = renderHook(() => useCaseEditorState({ caseEditorOpen: true }))

    if (_label === 'API') act(() => result.current.setNewTestFormat('API'))
    if (_label === 'conversacional') act(() => result.current.setNewTestFormat('CONVERSACIONAL'))
    act(() => result.current.setCaseEditorBaseline(result.current.currentCaseEditorSnapshot))

    expect(result.current.hasUnsavedCaseChanges).toBe(false)

    act(() => edit(result.current))

    expect(result.current.hasUnsavedCaseChanges).toBe(true)
  })

  it('vuelve a estado limpio cuando el baseline se actualiza después de guardar', () => {
    const { result } = renderHook(() => useCaseEditorState({ caseEditorOpen: true }))

    act(() => result.current.setNewTestTitle('Caso'))
    act(() => result.current.setCaseEditorBaseline(result.current.currentCaseEditorSnapshot))
    expect(result.current.hasUnsavedCaseChanges).toBe(false)

    act(() => result.current.setNewTestTitle('Caso editado'))
    expect(result.current.hasUnsavedCaseChanges).toBe(true)

    act(() => result.current.setCaseEditorBaseline(result.current.currentCaseEditorSnapshot))
    expect(result.current.hasUnsavedCaseChanges).toBe(false)
  })
})
