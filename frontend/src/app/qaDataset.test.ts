import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeQaDatasetEntries, qaDatasetEntriesFromBug } from './qaDataset'

test('normalizes QA dataset values without technical environment context', () => {
  assert.deepEqual(
    normalizeQaDatasetEntries([
      { key: 'qa_email', value: 'qa@example.test' },
      { key: 'ENV.URL', value: 'http://frontend' },
      { key: 'COMPONENT.NAME', value: 'WEB' },
      { key: 'account', value: 'demo' },
    ]),
    [
      { key: 'qa_email', value: 'qa@example.test' },
      { key: 'account', value: 'demo' },
    ],
  )
})

test('prefers canonical resolved values and falls back to legacy metadata', () => {
  assert.deepEqual(
    qaDatasetEntriesFromBug({ metadata_json: {
      dataset_resolved_values: [{ key: 'qa_email', value: 'qa@example.test' }],
      dataset_variables: { ENV: 'ignored', stale: 'legacy' },
    } }),
    [{ key: 'qa_email', value: 'qa@example.test' }],
  )
  assert.deepEqual(
    qaDatasetEntriesFromBug({ metadata_json: { dataset_variables: { qa_email: 'legacy@example.test' } } }),
    [{ key: 'qa_email', value: 'legacy@example.test' }],
  )
})
