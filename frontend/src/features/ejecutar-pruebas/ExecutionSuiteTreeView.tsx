import { SuiteTree } from '../../SuiteTree'

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
  const showUnavailableAction = (message: string) =>
    showFeedback('Acción no disponible', message, 'info')

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
      onCreateCase={() => showUnavailableAction('La creación de casos se realiza desde el módulo Añadir Pruebas.')}
      onCreateSuite={() => showUnavailableAction('La gestión de carpetas se realiza desde el módulo Añadir Pruebas.')}
      onEditSuite={() => showUnavailableAction('La edición de carpetas se realiza desde el módulo Añadir Pruebas.')}
      onDeleteSuite={() => showUnavailableAction('La eliminación de carpetas se realiza desde el módulo Añadir Pruebas.')}
      onSelectTest={(test, suiteId) => {
        selectSuiteTarget(suiteId)
        handleSelectTestForExecution(test)
      }}
      onEditCase={() => showUnavailableAction('La edición de casos se realiza desde el módulo Añadir Pruebas.')}
      onDeleteCase={() => showUnavailableAction('La eliminación de casos se realiza desde el módulo Añadir Pruebas.')}
    />
  )
}
