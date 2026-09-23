const naturalCompare = (left: any, right: any) =>
  String(left || '').localeCompare(String(right || ''), undefined, {
    numeric: true,
    sensitivity: 'base'
  })

export const compareTestsBySuiteOrder = (left: any, right: any) =>
  (Number(left.position ?? left.order ?? left.orden) - Number(right.position ?? right.order ?? right.orden)) ||
  naturalCompare(left.title, right.title)
  || naturalCompare(left.code, right.code)
  || naturalCompare(left.createdAt || left.fecha_creacion, right.createdAt || right.fecha_creacion)
  || naturalCompare(left.id, right.id)

export const compareSuitesByOrder = (left: any, right: any) => {
  const leftOrder = Number(left?.orden ?? left?.order ?? left?.position)
  const rightOrder = Number(right?.orden ?? right?.order ?? right?.position)
  const ordered = (Number.isFinite(leftOrder) ? leftOrder : Number.MAX_SAFE_INTEGER)
    - (Number.isFinite(rightOrder) ? rightOrder : Number.MAX_SAFE_INTEGER)
  return ordered || naturalCompare(left?.nombre || left?.name, right?.nombre || right?.name)
    || naturalCompare(left?.id, right?.id)
}

/** Matches the visual suite tree: sorted sub-suites first, then direct cases. */
export const orderTestsBySuiteTree = (tests: any[], suites: any[]) => {
  const testsBySuite = new Map<string, any[]>()
  const ordered: any[] = []
  const visitedSuiteIds = new Set<string>()

  tests.forEach(test => {
    const suiteId = String(test?.suiteId || '')
    const cases = testsBySuite.get(suiteId) || []
    cases.push(test)
    testsBySuite.set(suiteId, cases)
  })

  const visitSuite = (suite: any) => {
    if (!suite?.id || visitedSuiteIds.has(suite.id)) return
    visitedSuiteIds.add(suite.id)
    ;(suite.children || []).slice().sort(compareSuitesByOrder).forEach(visitSuite)
    ordered.push(...(testsBySuite.get(String(suite.id)) || []).slice().sort(compareTestsBySuiteOrder))
  }

  suites.slice().sort(compareSuitesByOrder).forEach(visitSuite)

  const unsuitedTests = tests
    .filter(test => !test?.suiteId)
    .sort(compareTestsBySuiteOrder)
  const casesOutsideTree = tests
    .filter(test => test?.suiteId && !visitedSuiteIds.has(test.suiteId))
    .sort(compareTestsBySuiteOrder)

  return [
    ...unsuitedTests,
    ...ordered,
    ...casesOutsideTree
  ]
}
