import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import es from '../../i18n/catalogs/es/index.ts'
import en from '../../i18n/catalogs/en/index.ts'
import pt from '../../i18n/catalogs/pt/index.ts'

const keys = ['mcpTitle', 'mcpLoadError', 'mcpCreated', 'mcpRevokeTitle', 'mcpRevokeMessage', 'mcpRevoked']

test('MCP hook resolves every message through the configuracion namespace', () => {
  const source = readFileSync(new URL('./hooks/useMcpConfiguration.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /t\('(mcp|revoke)'/)
  for (const key of keys) assert.match(source, new RegExp(`t\\('configuracion\\.${key}'`))
})

test('MCP translations are localized in Spanish, English, and Portuguese', () => {
  for (const key of keys) {
    assert.notEqual(es.configuracion[key], key)
    assert.notEqual(en.configuracion[key], es.configuracion[key])
    assert.notEqual(pt.configuracion[key], es.configuracion[key])
  }
})
