import { AuthoringSuiteTreeView } from '../features/casos/AuthoringSuiteTreeView'
import { ExecutionSuiteTreeView } from '../features/ejecutar-pruebas/ExecutionSuiteTreeView'

type SuiteTreeRendererOptions = {
  expandedSuites: any
  selectedSuiteId: any
  selectedSubSuiteId: any
  selectedTest: any
  visibleAuthoringCases: any[]
  currentProjectCases: any[]
  currentCompId: any
  currentBuildId: any
  buildCaseIds: any
  testSearchQuery: any
  canAccessCapability: (capability: string, level: string) => boolean
  selectSuiteTarget: (suiteId: string) => void
  setExpandedSuites: any
  openCreateCaseInSuite: any
  openCreateSuiteModal: any
  openEditSuiteModal: any
  openMoveSuiteModal: any
  updateSuiteArchiveStatus: any
  handleDeleteSuite: any
  openEditCase: any
  updateCaseArchiveStatus: any
  loadCasoVersions: any
  handleDeleteCaso: any
  getSuiteExecutionMetrics: any
  handleSelectTestForExecution: any
  showFeedback: any
}

export const createSuiteTreeRenderers = (options: SuiteTreeRendererOptions) => {
  const {
    expandedSuites, selectedSuiteId, selectedSubSuiteId, selectedTest,
    visibleAuthoringCases, currentProjectCases, currentCompId, currentBuildId,
    buildCaseIds, testSearchQuery, canAccessCapability, selectSuiteTarget,
    setExpandedSuites, openCreateCaseInSuite, openCreateSuiteModal, openEditSuiteModal,
    openMoveSuiteModal, updateSuiteArchiveStatus, handleDeleteSuite, openEditCase,
    updateCaseArchiveStatus, loadCasoVersions, handleDeleteCaso, getSuiteExecutionMetrics,
    handleSelectTestForExecution, showFeedback,
  } = options
  const canEditSuite = canAccessCapability('crear_pruebas.suites', 'edit')
  const canEditCase = canAccessCapability('crear_pruebas.casos', 'edit')

  const renderAuthoringSuiteTree = (
    suites: any[],
    openCloneCaseModal?: (test: any) => void,
    openCloneSuiteModal?: (suite: any) => void,
    openMoveCaseModal?: (test: any) => void,
  ) => (
    <AuthoringSuiteTreeView
      suites={suites} expandedSuites={expandedSuites} selectedSuiteId={selectedSuiteId}
      selectedSubSuiteId={selectedSubSuiteId} selectedTest={selectedTest}
      casosList={visibleAuthoringCases} currentCompId={currentCompId}
      testSearchQuery={testSearchQuery} selectSuiteTarget={selectSuiteTarget}
      setExpandedSuites={setExpandedSuites}
      openCreateCaseInSuite={canEditCase ? openCreateCaseInSuite : () => undefined}
      openCreateSuiteModal={canEditSuite ? openCreateSuiteModal : () => undefined}
      openEditSuiteModal={canEditSuite ? openEditSuiteModal : () => undefined}
      openCloneSuiteModal={openCloneSuiteModal || (() => undefined)}
      openMoveSuiteModal={canEditSuite ? openMoveSuiteModal : () => undefined}
      handleArchiveSuite={canEditSuite ? (suite) => updateSuiteArchiveStatus(suite, true) : undefined}
      handleRestoreSuite={canEditSuite ? (suite) => updateSuiteArchiveStatus(suite, false) : undefined}
      handleDeleteSuite={canEditSuite ? handleDeleteSuite : () => undefined}
      openEditCase={canEditCase ? openEditCase : () => undefined}
      openCloneCaseModal={openCloneCaseModal || (() => undefined)}
      openMoveCaseModal={openMoveCaseModal || (() => undefined)}
      handleArchiveCaso={canEditCase ? (test) => updateCaseArchiveStatus(test, 'ARCHIVADO') : undefined}
      handleRestoreCaso={canEditCase ? (test) => updateCaseArchiveStatus(test, 'ACTIVO') : undefined}
      loadCasoVersions={canAccessCapability('crear_pruebas.versiones', 'read') ? loadCasoVersions : () => undefined}
      handleDeleteCaso={canEditCase ? handleDeleteCaso : () => undefined}
    />
  )

  const renderExecutionSuiteTree = (suites: any[]) => (
    <ExecutionSuiteTreeView
      suites={suites} expandedSuites={expandedSuites} selectedSuiteId={selectedSuiteId}
      selectedSubSuiteId={selectedSubSuiteId} selectedTest={selectedTest}
      casosList={currentProjectCases.filter((test) => Boolean(currentBuildId && currentCompId) && test.componentId === currentCompId && (buildCaseIds[currentBuildId] || []).includes(test.id))}
      currentCompId={currentCompId} testSearchQuery={testSearchQuery}
      getSuiteExecutionMetrics={getSuiteExecutionMetrics} selectSuiteTarget={selectSuiteTarget}
      setExpandedSuites={setExpandedSuites} handleSelectTestForExecution={handleSelectTestForExecution}
      showFeedback={showFeedback}
    />
  )

  return { renderAuthoringSuiteTree, renderExecutionSuiteTree }
}
