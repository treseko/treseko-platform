import { toDateTimeLocalInput } from '../../../shared/utils/dateTime'

type UseWorkflowSchedulerLauncherParams = {
  t: (key: `configuracion.${string}`, params?: Record<string, string | number>) => string
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
  t,
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
      showFeedback(t('configuracion.noExecutableCases'), t('configuracion.noExecutableCasesMessage'), 'warning')
      return
    }
    setIaSchedulerOpenedFromBuilder(true)
    setSelectedTestsForIa([])
    setSchedulerSearch('')
    setExecName(`${t('configuracion.aiRun')} - ${new Date().toISOString().slice(0, 10)}`)
    const now = new Date()
    now.setMinutes(now.getMinutes() + 5)
    setScheduledTime(toDateTimeLocalInput(now.toISOString()))
    setShowIaScheduler(true)
  }
}
