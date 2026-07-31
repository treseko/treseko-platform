import { SuiteTree } from '../../SuiteTree'
import { useI18n } from '../../i18n'

type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'

type ExecutionSuiteTreeViewProps = {
  suites: any[]
  expandedSuites: Record<string, boolean>
  selectedSuiteId: string
  selectedSubSuiteId: string | null
  selectedTest: any
  casosList: any[]
  currentCompId: string
  testSearchQuery: string
  getSuiteExecutionMetrics: (suiteId: string) => any
  selectSuiteTarget: (suiteId: string) => void
  setExpandedSuites: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void
  handleSelectTestForExecution: (test: any) => void
  showFeedback: (title: string, message: string, variant?: FeedbackVariant) => void
}

export function ExecutionSuiteTreeView({
  suites,
  expandedSuites,
  selectedSuiteId,
  selectedSubSuiteId,
  selectedTest,
  casosList,
  currentCompId,
  testSearchQuery,
  getSuiteExecutionMetrics,
  selectSuiteTarget,
  setExpandedSuites,
  handleSelectTestForExecution,
  showFeedback
}: ExecutionSuiteTreeViewProps) {
  const { t } = useI18n()
  const showUnavailableAction = (message: string) =>
    showFeedback(t('ejecutarPruebas.unavailableAction'), message, 'info')

  return (
    <SuiteTree
      suites={suites}
      expandedSuites={expandedSuites}
      selectedSuiteId={selectedSuiteId}
      selectedSubSuiteId={selectedSubSuiteId}
      selectedTest={selectedTest}
      casosList={casosList}
      currentCompId={currentCompId}
      testSearchQuery={testSearchQuery}
      showActions={false}
      showMetrics
      getSuiteMetrics={getSuiteExecutionMetrics}
      onSelectSuite={selectSuiteTarget}
      onToggleSuite={(suiteId) => setExpandedSuites(prev => ({ ...prev, [suiteId]: !prev[suiteId] }))}
      onCreateCase={() => showUnavailableAction(t('ejecutarPruebas.createCasesFrom'))}
      onCreateSuite={() => showUnavailableAction(t('ejecutarPruebas.manageFoldersFrom'))}
      onEditSuite={() => showUnavailableAction(t('ejecutarPruebas.manageFoldersFrom'))}
      onDeleteSuite={() => showUnavailableAction(t('ejecutarPruebas.manageFoldersFrom'))}
      onSelectTest={(test, suiteId) => {
        selectSuiteTarget(suiteId)
        handleSelectTestForExecution(test)
      }}
      onEditCase={() => showUnavailableAction(t('ejecutarPruebas.createCasesFrom'))}
      onDeleteCase={() => showUnavailableAction(t('ejecutarPruebas.createCasesFrom'))}
    />
  )
}
