const naturalCompare = (left: any, right: any) =>
  String(left || '').localeCompare(String(right || ''), undefined, {
    numeric: true,
    sensitivity: 'base'
  })

export const compareTestsBySuiteOrder = (left: any, right: any) =>
  naturalCompare(left.title, right.title)
  || naturalCompare(left.code, right.code)
  || naturalCompare(left.createdAt || left.fecha_creacion, right.createdAt || right.fecha_creacion)
  || naturalCompare(left.id, right.id)

const compareSuitesByName = (left: any, right: any) =>
  naturalCompare(left.nombre || left.name, right.nombre || right.name)
  || naturalCompare(left.id, right.id)

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
    ;(suite.children || []).slice().sort(compareSuitesByName).forEach(visitSuite)
    ordered.push(...(testsBySuite.get(String(suite.id)) || []).slice().sort(compareTestsBySuiteOrder))
  }

  suites.slice().sort(compareSuitesByName).forEach(visitSuite)

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
