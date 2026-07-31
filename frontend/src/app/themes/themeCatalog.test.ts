import assert from 'node:assert/strict'
import test from 'node:test'
import { BUILTIN_THEMES } from './themeCatalog'
import { graphiteTheme } from './packages/graphite'

test('Grafito se registra como paquete aislado sin alterar los temas base', () => {
  assert.deepEqual(
    BUILTIN_THEMES.map(theme => theme.id),
    ['system', 'light', 'dark', 'pink-panther', 'graphite'],
  )
  assert.equal(BUILTIN_THEMES.at(-1), graphiteTheme)
  assert.equal(BUILTIN_THEMES.some(theme => theme.id === 'ocean'), false)
  assert.equal(BUILTIN_THEMES.some(theme => theme.id === 'high-contrast'), false)

  assert.deepEqual(
    BUILTIN_THEMES.slice(0, 4).map(theme => [theme.id, theme.tokens.background, theme.tokens.primary]),
    [
      ['system', '#f6f8fb', '#0d6efd'],
      ['light', '#f6f8fb', '#0d6efd'],
      ['dark', '#0f172a', '#38bdf8'],
      ['pink-panther', '#fff7fb', '#db2777'],
    ],
  )
})
