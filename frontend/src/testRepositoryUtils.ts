export const findSuiteById = (suites: any[], id: string): any => {
  for (const suite of suites) {
    if (suite.id === id) return suite
    if (suite.children && suite.children.length > 0) {
      const found = findSuiteById(suite.children, id)
      if (found) return found
    }
  }
  return null
}

export const flattenSuites = (suites: any[]): any[] => {
  const result: any[] = []
  for (const suite of suites) {
    result.push(suite)
    if (suite.children && suite.children.length > 0) {
      result.push(...flattenSuites(suite.children))
    }
  }
  return result
}

export const getSuiteParentMap = (suites: any[], parentId: string | null = null): Record<string, string | null> => {
  return suites.reduce((map, suite) => {
    map[suite.id] = parentId
    if (suite.children?.length) {
      Object.assign(map, getSuiteParentMap(suite.children, suite.id))
    }
    return map
  }, {} as Record<string, string | null>)
}

export const getRootSuiteId = (suites: any[], suiteId: string) => {
  const parentMap = getSuiteParentMap(suites)
  let current = suiteId
  while (parentMap[current]) {
    current = parentMap[current] as string
  }
  return current
}

export const getSuiteDepth = (suites: any[], suiteId: string) => {
  const parentMap = getSuiteParentMap(suites)
  let depth = 0
  let current = suiteId
  while (parentMap[current]) {
    depth += 1
    current = parentMap[current] as string
  }
  return depth
}

export const getSuiteAndDescendantIds = (suites: any[], suiteId: string): string[] => {
  const suite = findSuiteById(suites, suiteId)
  if (!suite) return suiteId ? [suiteId] : []
  return flattenSuites([suite]).map(item => item.id)
}
