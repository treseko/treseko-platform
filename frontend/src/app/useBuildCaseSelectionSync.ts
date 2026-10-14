import { useEffect } from 'react'
import { isValidUUID } from './validation'

type BuildSelectionSyncOptions = {
  currentBuildId: string | null
  projectsSource: string
  buildsList: Array<{ id: string; componente_id?: string | null }>
  componentsList: Array<{ id: string }>
  loadBuildCases: (buildId: string) => Promise<string[]>
  setSelectedExecutionTestIds: (update: (current: string[]) => string[]) => void
  loadBuildCaseExecutionStatus: (buildId: string, caseIds: string[]) => void
}

export function useBuildCaseSelectionSync({
  currentBuildId,
  projectsSource,
  buildsList,
  componentsList,
  loadBuildCases,
  setSelectedExecutionTestIds,
  loadBuildCaseExecutionStatus,
}: BuildSelectionSyncOptions) {
  useEffect(() => {
    let cancelled = false
    if (currentBuildId && isValidUUID(currentBuildId)) {
      const componentId = buildsList.find((build) => build.id === currentBuildId)?.componente_id
      if (componentId && !componentsList.some((component) => String(component.id) === String(componentId))) {
        return () => { cancelled = true }
      }
      loadBuildCases(currentBuildId).then((ids) => {
        if (cancelled) return
        setSelectedExecutionTestIds((current) => current.filter((caseId) => ids.includes(caseId)))
        loadBuildCaseExecutionStatus(currentBuildId, ids)
      })
    }
    return () => { cancelled = true }
  }, [currentBuildId, projectsSource, buildsList, componentsList])
}
