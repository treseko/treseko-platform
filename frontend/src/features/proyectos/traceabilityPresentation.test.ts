import assert from 'node:assert/strict'
import test from 'node:test'
import es from '../../i18n/catalogs/es/proyectos.ts'
import en from '../../i18n/catalogs/en/proyectos.ts'
import { canAutoConfirmStoryAnalysis } from './useTraceabilityGenerationState.ts'
import {
  priorityLabel,
  requirementStateLabel,
  storyStateLabel,
} from './traceabilityPresentation.ts'

type Catalog = Record<string, string>

test('automatic continuation requires complete LOW assumptions and no questions', () => {
  const low = { id: 'A-1', text: 'Confirmed working default', risk: 'LOW' }
  assert.equal(canAutoConfirmStoryAnalysis({ questions: [], proposed_assumptions: [low] }), true)
  for (const risk of ['MEDIUM', 'HIGH', 'CRITICAL', 'UNKNOWN', undefined]) {
    assert.equal(canAutoConfirmStoryAnalysis({ questions: [], proposed_assumptions: [{ ...low, risk }] }), false)
  }
  for (const assumptions of [[], [{ ...low, text: '' }], [{ ...low, id: '' }], [{ ...low, id: 42 }], [{ ...low, text: { invalid: 'value' } }], [low, low], [null], [low, { ...low, id: 'A-2', risk: 'HIGH' }]]) {
    assert.equal(canAutoConfirmStoryAnalysis({ questions: [], proposed_assumptions: assumptions }), false)
  }
  assert.equal(canAutoConfirmStoryAnalysis({ questions: ['Confirm expected behavior'], proposed_assumptions: [low] }), false)
  assert.equal(canAutoConfirmStoryAnalysis({ proposed_assumptions: [low] }), false)
})

function translator(catalog: Catalog) {
  return (key: string) => {
    const [, messageKey] = key.split('.')
    return catalog[messageKey]
  }
}

test('localizes traceability states and priorities without changing domain values', () => {
  const esT = translator(es as Catalog)
  const enT = translator(en as Catalog)
  const requirementStates = ['BORRADOR', 'ACTIVO', 'EN_REVISION', 'CUMPLIDO', 'ARCHIVADO']
  const storyStates = ['BORRADOR', 'LISTA_PARA_QA', 'EN_PRUEBA', 'ACEPTADA', 'ARCHIVADA']
  const priorities = ['ALTA', 'MEDIA', 'BAJA']

  assert.deepEqual(
    requirementStates.map((state) => requirementStateLabel(esT, state)),
    ['Borrador', 'Activo', 'En revisión', 'Cumplido', 'Archivado'],
  )
  assert.deepEqual(
    requirementStates.map((state) => requirementStateLabel(enT, state)),
    ['Draft', 'Active', 'In review', 'Completed', 'Archived'],
  )
  assert.deepEqual(
    storyStates.map((state) => storyStateLabel(enT, state)),
    ['Draft', 'Ready for QA', 'In test', 'Accepted', 'Archived'],
  )
  assert.deepEqual(
    priorities.map((priority) => priorityLabel(enT, priority)),
    ['High', 'Medium', 'Low'],
  )

  assert.deepEqual(requirementStates, ['BORRADOR', 'ACTIVO', 'EN_REVISION', 'CUMPLIDO', 'ARCHIVADO'])
  assert.deepEqual(storyStates, ['BORRADOR', 'LISTA_PARA_QA', 'EN_PRUEBA', 'ACEPTADA', 'ARCHIVADA'])
  assert.deepEqual(priorities, ['ALTA', 'MEDIA', 'BAJA'])
  assert.equal(requirementStateLabel(enT, 'FUTURE_STATUS'), 'FUTURE_STATUS')
})
