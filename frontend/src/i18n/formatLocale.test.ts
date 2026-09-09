import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocaleFormatter } from './formatLocale.ts'

test('uses the Brazilian Portuguese regional format for canonical pt', () => {
  const formatter = createLocaleFormatter('pt')
  assert.equal(formatter.formatNumber(1234.5), '1.234,5')
})
