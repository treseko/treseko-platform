import { SuiteTree } from '../../SuiteTree'

type AuthoringSuiteTreeViewProps = {
  suites: any[]
  expandedSuites: Record<string, boolean>
  selectedSuiteId: string
  selectedSubSuiteId: string | null
  selectedTest: any
  casosList: any[]
  currentCompId: string
  testSearchQuery: string
  selectSuiteTarget: (suiteId: string) => void
  setExpandedSuites: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void
  openCreateCaseInSuite: (suiteId: string) => void
  openCreateSuiteModal: (parentId?: string | null) => void
  openEditSuiteModal: (suiteId: string) => void
  openCloneSuiteModal: (suite: any) => void
  openMoveSuiteModal: (suiteId: string) => void
  handleArchiveSuite?: (suite: any) => void
  handleRestoreSuite?: (suite: any) => void
  handleDeleteSuite: (suiteId: string) => void
  openEditCase: (test: any) => void
  openCloneCaseModal: (test: any) => void
  openMoveCaseModal: (test: any) => void
  handleArchiveCaso?: (test: any) => void
  handleRestoreCaso?: (test: any) => void
  loadCasoVersions: (masterId: string, test?: any) => void
  handleDeleteCaso: (test: any) => void
}

export function AuthoringSuiteTreeView({
  suites,
  expandedSuites,
  selectedSuiteId,
  selectedSubSuiteId,
  selectedTest,
  casosList,
  currentCompId,
  testSearchQuery,
  selectSuiteTarget,
  setExpandedSuites,
  openCreateCaseInSuite,
  openCreateSuiteModal,
  openEditSuiteModal,
  openCloneSuiteModal,
  openMoveSuiteModal,
  handleArchiveSuite,
  handleRestoreSuite,
  handleDeleteSuite,
  openEditCase,
  openCloneCaseModal,
  openMoveCaseModal,
  handleArchiveCaso,
  handleRestoreCaso,
  loadCasoVersions,
  handleDeleteCaso
}: AuthoringSuiteTreeViewProps) {
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
      onSelectSuite={selectSuiteTarget}
      onToggleSuite={(suiteId) => setExpandedSuites(prev => ({ ...prev, [suiteId]: !prev[suiteId] }))}
      onCreateCase={openCreateCaseInSuite}
      onCreateSuite={openCreateSuiteModal}
      onEditSuite={openEditSuiteModal}
      onCloneSuite={openCloneSuiteModal}
      onMoveSuite={(suite) => openMoveSuiteModal(suite.id)}
      onArchiveSuite={handleArchiveSuite}
      onRestoreSuite={handleRestoreSuite}
      onDeleteSuite={handleDeleteSuite}
      onSelectTest={(test, suiteId) => {
        selectSuiteTarget(suiteId)
        openEditCase(test)
      }}
      onEditCase={openEditCase}
      onCloneCase={openCloneCaseModal}
      onMoveCase={openMoveCaseModal}
      onArchiveCase={handleArchiveCaso}
      onRestoreCase={handleRestoreCaso}
      onViewVersions={(test) => loadCasoVersions(test.masterId, test)}
      onDeleteCase={handleDeleteCaso}
    />
  )
}
