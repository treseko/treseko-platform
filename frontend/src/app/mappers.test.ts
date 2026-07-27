import assert from 'node:assert/strict'
import test from 'node:test'
import { sortBuildsNewestFirst } from './buildSorting'

test('ordena builds semver descendente sin depender de fechas', () => {
  const builds = [
    { id: 'old', name: 'v1.0.0', createdAt: '2026-07-24T12:00:00Z' },
    { id: 'new', name: 'v1.2.0', createdAt: '2026-07-20T12:00:00Z' },
    { id: 'mid', name: 'v1.1.0', createdAt: '2026-07-23T12:00:00Z' },
  ]
  assert.deepEqual(sortBuildsNewestFirst(builds).map(build => build.name), ['v1.2.0', 'v1.1.0', 'v1.0.0'])
})

test('ordena release estable por encima de prereleases', () => {
  const builds = [
    { id: 'rc', name: 'v1.2.0-RC2' },
    { id: 'stable', name: 'v1.2.0' },
    { id: 'beta', name: 'v1.2.0-beta1' },
  ]
  assert.deepEqual(sortBuildsNewestFirst(builds).map(build => build.name), ['v1.2.0', 'v1.2.0-RC2', 'v1.2.0-beta1'])
})

test('ordena correctamente números de prerelease', () => {
  const builds = [{ name: 'v1.2.0-RC2' }, { name: 'v1.2.0-RC10' }]
  assert.deepEqual(sortBuildsNewestFirst(builds).map(build => build.name), ['v1.2.0-RC10', 'v1.2.0-RC2'])
})

test('usa fecha de creación para nombres no semver', () => {
  const builds = [
    { id: 'old', name: 'nightly', createdAt: '2026-07-20T12:00:00Z' },
    { id: 'new', name: 'release-candidate', createdAt: '2026-07-24T12:00:00Z' },
  ]
  assert.deepEqual(sortBuildsNewestFirst(builds).map(build => build.id), ['new', 'old'])
})
