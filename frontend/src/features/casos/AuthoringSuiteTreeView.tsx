import { SuiteTree } from '../../SuiteTree'
import type { CaseFormat } from './caseFormat'

type AuthoringSuiteTreeViewProps = {
  canEditSuites?: boolean
  canEditCases?: boolean
  canViewVersions?: boolean
  reorderSuite?: (suiteId: string, direction: 'up' | 'down') => void
  suites: any[]
  expandedSuites: Record<string, boolean>
  selectedSuiteId: string
  selectedSubSuiteId: string | null
  selectedTest: any
  casosList: any[]
  organizationCases?: any[]
  currentCompId: string
  testSearchQuery: string
  selectSuiteTarget: (suiteId: string) => void
  setExpandedSuites: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void
  openCreateCaseInSuite: (suiteId: string, format?: CaseFormat) => void
  openCreateSuiteModal: (parentId?: string | null) => void
  openEditSuiteModal: (suiteId: string) => void
  openCloneSuiteModal: (suite: any) => void
  openMoveSuiteModal: (suiteId: string) => void
  handleArchiveSuite?: (suite: any) => void
  handleRestoreSuite?: (suite: any) => void
  handleDeleteSuite: (suiteId: string) => void
  openEditCase: (test: any) => void
  beforeOpenEditCase?: (test: any) => boolean | Promise<boolean>
  openCloneCaseModal: (test: any) => void
  openMoveCaseModal: (test: any) => void
  organizeCase?: (test: any, targetSuiteId: string | null, position: number) => Promise<boolean | void> | boolean | void
  handleArchiveCaso?: (test: any) => void
  handleRestoreCaso?: (test: any) => void
  loadCasoVersions: (masterId: string, test?: any) => void
  handleDeleteCaso: (test: any) => void
}

export function AuthoringSuiteTreeView({
  canEditSuites, canEditCases, canViewVersions, reorderSuite,
  suites,
  expandedSuites,
  selectedSuiteId,
  selectedSubSuiteId,
  selectedTest,
  casosList,
  organizationCases,
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
  beforeOpenEditCase,
  openCloneCaseModal,
  openMoveCaseModal,
  organizeCase,
  handleArchiveCaso,
  handleRestoreCaso,
  loadCasoVersions,
  handleDeleteCaso
}: AuthoringSuiteTreeViewProps) {
  return (
    <SuiteTree
      canEditSuites={canEditSuites} canEditCases={canEditCases} canViewVersions={canViewVersions}
      onReorderSuite={reorderSuite}
      suites={suites}
      expandedSuites={expandedSuites}
      selectedSuiteId={selectedSuiteId}
      selectedSubSuiteId={selectedSubSuiteId}
      selectedTest={selectedTest}
      casosList={casosList}
      organizationCases={organizationCases}
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
      onSelectTest={async (test, suiteId) => {
        if (beforeOpenEditCase && !(await beforeOpenEditCase(test))) return
        selectSuiteTarget(suiteId)
        openEditCase(test)
      }}
      onEditCase={async (test) => {
        if (beforeOpenEditCase && !(await beforeOpenEditCase(test))) return
        openEditCase(test)
      }}
      onCloneCase={openCloneCaseModal}
      onMoveCase={openMoveCaseModal}
      onOrganizeCase={organizeCase}
      onArchiveCase={handleArchiveCaso}
      onRestoreCase={handleRestoreCaso}
      onViewVersions={(test) => loadCasoVersions(test.masterId, test)}
      onDeleteCase={handleDeleteCaso}
    />
  )
}
