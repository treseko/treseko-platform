import assert from 'node:assert/strict'
import test from 'node:test'
import es from './catalogs/es/index.ts'
import en from './catalogs/en/index.ts'
import { interpolate } from './index.tsx'

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

test('catalog placeholders stay aligned and use the supported interpolation syntax', () => {
  const spanish = flatten(es)
  const english = flatten(en)
  const placeholderNames = (message: string) => [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

  for (const key of Object.keys(spanish)) {
    assert.deepEqual(placeholderNames(spanish[key]), placeholderNames(english[key]), key)
  }

  for (const key of ['casos.pendingReviewCount', 'casos.linkStory', 'casos.confirmReviewHttpFailed', 'casos.evidenceLoadFailed']) {
    assert.doesNotMatch(spanish[key], /\{\{/)
    assert.doesNotMatch(english[key], /\{\{/)
  }
})

test('interpolates real catalog parameters without leaving double braces', () => {
  assert.equal(interpolate(en.casos.pendingReviewCount, { count: 3 }), 'Pending review: 3')
  assert.equal(interpolate(en.casos.linkStory, { code: 'US-42' }), 'Link US-42')
  assert.equal(interpolate(en.casos.confirmReviewHttpFailed, { status: 404 }), 'Could not confirm the review (HTTP 404).')
  assert.equal(interpolate(en.casos.evidenceLoadFailed, { status: 500 }), 'Could not load the evidence (500).')
  assert.equal(interpolate('Value: {missing}', {}), 'Value: {missing}')
})
