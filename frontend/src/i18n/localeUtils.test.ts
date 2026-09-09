import test from 'node:test'
import assert from 'node:assert/strict'
import { getInitialLocale, normalizeLocale, LOCALE_STORAGE_KEY } from './localeUtils.ts'

test('normalizes Portuguese locale variants to the canonical pt value', () => {
  assert.equal(normalizeLocale('pt'), 'pt')
  assert.equal(normalizeLocale('pt-BR'), 'pt')
  assert.equal(normalizeLocale('pt_br'), 'pt')
  assert.equal(normalizeLocale(' PT-br '), 'pt')
})

test('keeps English detection and safely falls back to Spanish', () => {
  assert.equal(normalizeLocale('en-US'), 'en')
  assert.equal(normalizeLocale('fr-FR'), 'es')
  assert.equal(normalizeLocale(undefined), 'es')
})

test('prefers a stored canonical locale over the browser locale', () => {
  const storage = { getItem: (key: string) => key === LOCALE_STORAGE_KEY ? 'pt_br' : null }
  assert.equal(getInitialLocale(storage), 'pt')
})
