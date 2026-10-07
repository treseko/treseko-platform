type ExecutionProjectContext = {
  buildsList?: Array<{ id?: string; projectId?: string }>
  currentBuildId?: string
  currentProjectId?: string
  managingProjectId?: string | null
}

/** The selected build is the source of truth for the project used by a run. */
export function resolveExecutionProjectId({
  buildsList = [],
  currentBuildId = '',
  currentProjectId = '',
  managingProjectId = '',
}: ExecutionProjectContext): string {
  if (currentBuildId) {
    return buildsList.find(build => String(build.id) === String(currentBuildId))?.projectId || ''
  }
  return currentProjectId || managingProjectId || ''
}
