import assert from 'node:assert/strict'
import test from 'node:test'
import { createCaseVersionRows } from './caseVersionUtils'

const rowsFor = (current: any, selected: any) =>
  createCaseVersionRows({ suitesTree: [], componentsList: [] })(current, selected)

test('el historial compara configuración API, script y framework', () => {
  const selected = {
    configuracion_api: { request: { url: '/v1/items' } },
    script_automatizado: 'await page.goto("/v1")',
    framework: 'playwright:javascript',
  }
  const current = {
    configuracion_api: { request: { url: '/v2/items' } },
    script_automatizado: 'await page.goto("/v2")',
    framework: 'playwright:typescript',
  }

  const rows = rowsFor(current, selected)

  assert.equal(rows.find(row => row.key === 'configuracion_api')?.changed, true)
  assert.equal(rows.find(row => row.key === 'script_automatizado')?.changed, true)
  assert.equal(rows.find(row => row.key === 'framework')?.changed, true)
})

test('el dataset se muestra como contexto y no dispara una diferencia', () => {
  const rows = rowsFor(
    { dataset: [{ key: 'user', value: 'qa-2' }] },
    { dataset: [{ key: 'user', value: 'qa-1' }] },
  )
  const datasetRow = rows.find(row => row.key === 'dataset')

  assert.equal(datasetRow?.contextOnly, true)
  assert.equal(datasetRow?.changed, false)
  assert.equal(datasetRow?.label, 'Dataset (contexto)')
})

test('el historial mantiene la comparación conversacional', () => {
  const rows = rowsFor(
    { configuracion_chatbot: { objetivo: 'validar carrito' } },
    { configuracion_chatbot: { objetivo: 'validar login' } },
  )

  assert.equal(rows.find(row => row.key === 'configuracion_chatbot')?.changed, true)
})
