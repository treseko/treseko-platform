import assert from 'node:assert/strict'
import test from 'node:test'
import es from './catalogs/es/index.ts'
import en from './catalogs/en/index.ts'

function flatten(value: Record<string, unknown>, prefix = '', result: Record<string, string> = {}) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === 'object') flatten(child as Record<string, unknown>, path, result)
    else result[path] = String(child)
  }
  return result
}

test('English and Spanish catalogs keep the same translation keys', () => {
  assert.deepEqual(Object.keys(flatten(en)).sort(), Object.keys(flatten(es)).sort())
})

test('English catalog does not contain known Spanish UI examples', () => {
  const english = Object.values(flatten(en)).join('\n')
  assert.doesNotMatch(english, /usuario=|color=azul|Clic para|No hay variables disponibles/i)
})
