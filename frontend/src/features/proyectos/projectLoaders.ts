import type { Dispatch, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { mapBackendBuildToItem, mapBackendComponentToItem } from '../../app/mappers'
import { isValidUUID } from '../../app/validation'

type CreateProjectLoadersParams = {
  projectsSource: 'local' | 'backend'
  currentCompId: string
  componentsList: any[]
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setComponentsList: Dispatch<SetStateAction<any[]>>
  setBuildsList: Dispatch<SetStateAction<any[]>>
  setBuildCaseIds: Dispatch<SetStateAction<Record<string, string[]>>>
  setCurrentCompId: (componentId: string) => void
  setNewTestComponent: (componentId: string) => void
  setCurrentBuildId: (buildId: string) => void
  setProjectSyncMessage: (message: string) => void
}

export function createProjectLoaders({
  projectsSource,
  currentCompId,
  componentsList,
  fetchWithAuth,
  setComponentsList,
  setBuildsList,
  setBuildCaseIds,
  setCurrentCompId,
  setNewTestComponent,
  setCurrentBuildId,
  setProjectSyncMessage
}: CreateProjectLoadersParams) {
  const loadComponentsForProject = async (projectId: string) => {
    if (!projectId || !isValidUUID(projectId) || projectsSource !== 'backend') return []
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${projectId}/componentes/`)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }

      const components = await response.json()
      const mapped = components.map(mapBackendComponentToItem)
      setComponentsList(prev => [
        ...prev.filter(component => component.projectId !== projectId),
        ...mapped
      ])
      if (mapped.length > 0) {
        const selectedComponentId = mapped.some((component: any) => component.id === currentCompId)
          ? currentCompId
          : mapped[0].id
        setCurrentCompId(selectedComponentId)
        setNewTestComponent(selectedComponentId)
      } else {
        setCurrentCompId('')
        setNewTestComponent('')
        setCurrentBuildId('')
      }
      return mapped
    } catch (error: any) {
      setProjectSyncMessage(`No se pudieron cargar componentes: ${error.message}.`)
      return []
    }
  }

  const loadBuildCaseIdsForBuilds = async (buildIds: string[]) => {
    const validBuildIds = [...new Set(buildIds)].filter(buildId => buildId && isValidUUID(buildId))
    if (validBuildIds.length === 0 || projectsSource !== 'backend') return
    try {
      const entries = await Promise.all(validBuildIds.map(async buildId => {
        const response = await fetchWithAuth(`${API_BASE}/builds/${buildId}/casos/?skip=0&limit=200`)
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }
        let cases = await response.json()
        let lastPageSize = cases.length
        for (let skip = lastPageSize; lastPageSize === 200; skip += 200) {
          const pageResponse = await fetchWithAuth(`${API_BASE}/builds/${buildId}/casos/?skip=${skip}&limit=200`)
          if (!pageResponse.ok) {
            const error = await pageResponse.json().catch(() => null)
            throw new Error(error?.detail || `Backend respondió ${pageResponse.status}`)
          }
          const page = await pageResponse.json()
          lastPageSize = page.length
          cases = [...cases, ...page]
        }
        return [buildId, cases.map((item: any) => item.id)] as const
      }))
      setBuildCaseIds(prev => ({ ...prev, ...Object.fromEntries(entries) }))
    } catch (error: any) {
      setProjectSyncMessage(`No se pudieron cargar conteos de casos por build: ${error.message}`)
    }
  }

  const loadBuildCaseIdsForProject = async (projectId: string, buildIds: string[]) => {
    const validBuildIds = [...new Set(buildIds)].filter(buildId => buildId && isValidUUID(buildId))
    if (!projectId || !isValidUUID(projectId) || validBuildIds.length === 0 || projectsSource !== 'backend') return
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${projectId}/build-casos/`)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const grouped = await response.json()
      const nextEntries = Object.fromEntries(validBuildIds.map(buildId => [buildId, grouped[buildId] || []]))
      setBuildCaseIds(prev => ({ ...prev, ...nextEntries }))
    } catch (error: any) {
      setProjectSyncMessage(`No se pudieron cargar conteos de casos por build: ${error.message}`)
    }
  }

  const loadBuildsForProject = async (projectId: string, projectComponents = componentsList, componentOverride = currentCompId) => {
    if (!projectId || projectsSource !== 'backend') return null
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${projectId}/builds/`)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }

      const builds = await response.json()
      const mapped = builds.map(mapBackendBuildToItem)
      setBuildsList(prev => [
        ...prev.filter(build => build.projectId !== projectId),
        ...mapped
      ])
      const projectComponentList = projectComponents.filter((component: any) => component.projectId === projectId)
      const componentId = projectComponentList.some((component: any) => component.id === componentOverride)
        ? componentOverride
        : projectComponentList[0]?.id || ''
      if (componentId && componentId !== currentCompId) {
        setCurrentCompId(componentId)
        setNewTestComponent(componentId)
      }
      const componentBuilds = mapped.filter((build: any) => build.componentId === componentId && !build.hidden)
      const activeBuild = componentBuilds.find((build: any) => build.active) || componentBuilds[0]
      setCurrentBuildId(activeBuild?.id || '')
      await loadBuildCaseIdsForProject(projectId, mapped.map((build: any) => build.id))
      return { builds: mapped, activeBuildId: activeBuild?.id || '', componentId }
    } catch (error: any) {
      setProjectSyncMessage(`No se pudieron cargar builds: ${error.message}.`)
      return null
    }
  }

  return {
    loadComponentsForProject,
    loadBuildsForProject,
    loadBuildCaseIdsForBuilds,
    loadBuildCaseIdsForProject
  }
}
