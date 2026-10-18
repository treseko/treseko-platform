import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGenerationQuestionAnswers } from './generationQuestionAnswers.ts'

test('keeps a scope-only decision even when the user provides no free-text answer', () => {
  assert.deepEqual(buildGenerationQuestionAnswers(
    { '¿Qué pasa si falla?': '' },
    { '¿Qué pasa si falla?': true },
  ), [{ question: '¿Qué pasa si falla?', answer: '', scope_decision: 'OUT_OF_SCOPE' }])
})

test('requires free text for in-scope questions and trims submitted values', () => {
  assert.deepEqual(buildGenerationQuestionAnswers(
    { '¿Qué pasa si falla?': '  Se muestra el error.  ', '¿Quién recibe aviso?': '  ' },
  ), [{ question: '¿Qué pasa si falla?', answer: 'Se muestra el error.', scope_decision: 'IN_SCOPE' }])
})
