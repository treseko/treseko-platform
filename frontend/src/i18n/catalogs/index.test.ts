import test from 'node:test'
import assert from 'node:assert/strict'
import { fallbackCatalog, loadCatalog } from './index.ts'

test('loads the Portuguese catalog with conversational editor labels', async () => {
  const portugueseCatalog = await loadCatalog('pt')
  assert.notEqual(portugueseCatalog, fallbackCatalog)
  assert.equal(portugueseCatalog.casos?.connectionType, 'Tipo de conexão')
})

test('continues loading the existing English catalog', async () => {
  const englishCatalog = await loadCatalog('en')
  assert.notEqual(englishCatalog, fallbackCatalog)
  assert.equal(typeof englishCatalog.common?.language, 'string')
})
