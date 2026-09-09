import assert from 'node:assert/strict'
import test from 'node:test'
import { caseCreationFormats, caseFormatPresentation, normalizeCaseFormat } from './caseFormat'

test('hides Performance from new case creation without removing its format support', () => {
  assert.deepEqual(caseCreationFormats, ['CLASICA', 'CONVERSACIONAL', 'API'])
  assert.equal(caseCreationFormats.includes('PERFORMANCE'), false)
  assert.equal(normalizeCaseFormat('PERFORMANCE'), 'PERFORMANCE')
  assert.ok(caseFormatPresentation.PERFORMANCE)
})
