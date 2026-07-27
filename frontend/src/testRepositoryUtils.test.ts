import assert from 'node:assert/strict'
import test from 'node:test'

import { orderTestsBySuiteTree } from './testOrdering'
import {
  findSuiteById,
  flattenSuites,
  getRootSuiteId,
  getSuiteAndDescendantIds,
  getSuiteDepth,
  getSuiteParentMap
} from './testRepositoryUtils'

type SuiteNode = {
  id: string
  name: string
  children: SuiteNode[]
}

type ExpectedNode = {
  id: string
  parentId: string | null
  rootId: string
  depth: number
  descendants: string[]
}

const makeControlledTree = (seed: number) => {
  let state = seed >>> 0
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }
  let sequence = 0
  const expected = new Map<string, ExpectedNode>()

  const build = (depth: number, parentId: string | null, rootId?: string): SuiteNode => {
    const id = `seed-${seed}-suite-${sequence++}`
    const resolvedRoot = rootId || id
    const childCount = depth >= 3 ? 0 : next() % 4
    const children = Array.from({ length: childCount }, () => build(depth + 1, id, resolvedRoot))
    const descendants = [id, ...children.flatMap(child => expected.get(child.id)?.descendants || [])]
    expected.set(id, { id, parentId, rootId: resolvedRoot, depth, descendants })
    return { id, name: `Suite ${String(next() % 29).padStart(2, '0')}`, children }
  }

  const roots = Array.from({ length: 1 + (next() % 4) }, () => build(0, null))
  return { roots, expected }
}

for (let seed = 1; seed <= 128; seed += 1) {
  test(`repositorio de suites conserva invariantes con semilla controlada ${seed}`, () => {
    const { roots, expected } = makeControlledTree(seed)
    const snapshot = JSON.stringify(roots)
    const flattened = flattenSuites(roots)
    const parentMap = getSuiteParentMap(roots)

    assert.equal(flattened.length, expected.size)
    assert.equal(new Set(flattened.map(node => node.id)).size, expected.size)
    for (const node of expected.values()) {
      assert.equal(findSuiteById(roots, node.id)?.id, node.id)
      assert.equal(parentMap[node.id], node.parentId)
      assert.equal(getRootSuiteId(roots, node.id), node.rootId)
      assert.equal(getSuiteDepth(roots, node.id), node.depth)
      assert.deepEqual(getSuiteAndDescendantIds(roots, node.id), node.descendants)
    }
    assert.equal(findSuiteById(roots, `missing-${seed}`), null)
    assert.deepEqual(getSuiteAndDescendantIds(roots, `missing-${seed}`), [`missing-${seed}`])
    assert.equal(JSON.stringify(roots), snapshot, 'las consultas no deben mutar el árbol')
  })

  test(`orden visual de casos es estable con semilla controlada ${seed}`, () => {
    const { roots, expected } = makeControlledTree(seed)
    const cases = [...expected.values()].flatMap(node => {
      const ordinal = Number(node.id.split('-').at(-1))
      return [
        { id: `${node.id}-b`, suiteId: node.id, title: `Caso ${ordinal} 10`, code: `TC-${ordinal}-10` },
        { id: `${node.id}-a`, suiteId: node.id, title: `Caso ${ordinal} 2`, code: `TC-${ordinal}-02` }
      ]
    })
    cases.push({ id: `unsuited-${seed}`, suiteId: '', title: 'Sin suite', code: 'TC-0' })
    cases.push({ id: `orphan-${seed}`, suiteId: `unknown-${seed}`, title: 'Huérfano', code: 'TC-999' })
    const treeSnapshot = JSON.stringify(roots)
    const caseSnapshot = JSON.stringify(cases)

    const first = orderTestsBySuiteTree(cases, roots)
    const second = orderTestsBySuiteTree(cases, roots)
    assert.deepEqual(first, second)
    assert.equal(first.length, cases.length)
    assert.equal(new Set(first.map(item => item.id)).size, cases.length)
    assert.equal(first[0].id, `unsuited-${seed}`)
    assert.equal(first.at(-1)?.id, `orphan-${seed}`)
    for (const node of expected.values()) {
      const related = first.filter(item => item.suiteId === node.id)
      assert.deepEqual(related.map(item => item.title), [
        `Caso ${Number(node.id.split('-').at(-1))} 2`,
        `Caso ${Number(node.id.split('-').at(-1))} 10`
      ])
    }
    assert.equal(JSON.stringify(roots), treeSnapshot)
    assert.equal(JSON.stringify(cases), caseSnapshot)
  })
}
