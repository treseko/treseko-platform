import { toDateTimeLocalInput } from '../../../shared/utils/dateTime'

type UseWorkflowSchedulerLauncherParams = {
  currentProjectCases: any[]
  belongsToCurrentComponent: (test: any) => boolean
  showFeedback: (title: string, message: string, variant?: string) => void
  setIaSchedulerOpenedFromBuilder: (opened: boolean) => void
  setSelectedTestsForIa: (ids: string[]) => void
  setSchedulerSearch: (value: string) => void
  setExecName: (value: string) => void
  setScheduledTime: (value: string) => void
  setShowIaScheduler: (show: boolean) => void
}

export function useWorkflowSchedulerLauncher({
  currentProjectCases,
  belongsToCurrentComponent,
  showFeedback,
  setIaSchedulerOpenedFromBuilder,
  setSelectedTestsForIa,
  setSchedulerSearch,
  setExecName,
  setScheduledTime,
  setShowIaScheduler,
}: UseWorkflowSchedulerLauncherParams) {
  return () => {
    const executableCases = currentProjectCases.filter(test => belongsToCurrentComponent(test))
    if (executableCases.length === 0) {
      showFeedback('Sin casos ejecutables', 'No hay casos del componente/build activos para ejecutar con IA.', 'warning')
      return
    }
    setIaSchedulerOpenedFromBuilder(true)
    setSelectedTestsForIa([])
    setSchedulerSearch('')
    setExecName(`Run IA - ${new Date().toISOString().slice(0, 10)}`)
    const now = new Date()
    now.setMinutes(now.getMinutes() + 5)
    setScheduledTime(toDateTimeLocalInput(now.toISOString()))
    setShowIaScheduler(true)
  }
}
