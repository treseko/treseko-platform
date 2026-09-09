import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeImportedTheme, normalizeAppearance, normalizeCustomThemes, normalizeImportedProjectTheme } from './themeCustomization'

test('normaliza un tema importado usando solo colores hexadecimales', () => {
  const theme = normalizeImportedTheme({
    name: 'Océano',
    tokens: { background: '#102030', primary: '#0b5ed7' },
  })

  assert.match(theme.id, /^imported-oceano-/)
  assert.equal(theme.tokens.background, '#102030')
  assert.equal(theme.tokens.primary, '#0b5ed7')
  assert.equal(theme.tokens.text, '#111827')
  assert.equal(theme.source, 'third-party')
})

test('rechaza colores o temas no seguros', () => {
  assert.throws(() => normalizeImportedTheme({ name: 'Invalido', tokens: { primary: 'red' } }), /formato hexadecimal/)
  assert.throws(() => normalizeImportedTheme({ name: 'Invalido', css: 'body { color: red }' }), /CSS ni JavaScript/)
})

test('normaliza fondos y limita temas personalizados a entradas reconocibles', () => {
  assert.equal(normalizeAppearance({ wallpaper: 'sunset' }).wallpaper, 'sunset')
  assert.equal(normalizeAppearance({ wallpaper: 'url' }).wallpaper, 'none')
  const valid = normalizeImportedTheme({ name: 'Uno', tokens: {} })
  assert.equal(normalizeCustomThemes([valid, { id: 'builtin', name: 'No' }]).length, 1)
})

test('normaliza un tema de proyecto con gradiente y limita su opacidad', () => {
  const theme = normalizeImportedProjectTheme({
    name: 'Proyecto océano',
    background: '#102030',
    surface: '#182a3a',
    primary: '#0b5ed7',
    gradient: { enabled: true, start: '#0b5ed7', end: '#7c3aed', direction: '225deg', opacity: 140 },
  })
  assert.equal(theme.gradientEnabled, true)
  assert.equal(theme.gradientDirection, '225deg')
  assert.equal(theme.gradientOpacity, 100)
  assert.equal(theme.surface, '#182a3a')
})
