import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAIJson } from './responseParsing.ts'

test('extrae el JSON final cuando Gemma agrega un canal de pensamiento', () => {
  const raw = `<|channel>thought\nEl esquema de ejemplo es {"message":"ejemplo","should_finish":false}.\n<|channel|>{"message":"consulta real","should_finish":false,"reason":"continúa"}<|end>`
  assert.deepEqual(parseAIJson(raw), { message: 'consulta real', should_finish: false, reason: 'continúa' })
})

test('conserva el objeto externo cuando contiene arrays u objetos anidados', () => {
  const raw = '<|channel>thought\n{"status":"SUCCESS","reason":"ejemplo"}\n<|channel|>{"status":"SUCCESS","score":0.9,"reason":"cumple","findings":[]}'
  assert.deepEqual(parseAIJson(raw), { status: 'SUCCESS', score: 0.9, reason: 'cumple', findings: [] })
})

test('extrae el JSON aunque el proveedor deje un prefijo thought sin marcador', () => {
  const raw = 'thought\nThe page looks ready.\n{"action":"finish","reason":"La pantalla cumple","confidence":90}'
  assert.deepEqual(parseAIJson(raw), { action: 'finish', reason: 'La pantalla cumple', confidence: 90 })
})
