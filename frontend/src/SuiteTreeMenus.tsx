import { Dropdown } from 'react-bootstrap'
import { Archive, ArrowDown, ArrowUp, ClipboardCopy, Edit, FolderPlus, History, MoreVertical, MoveRight, RotateCcw, Settings, Trash2 } from 'lucide-react'
import { useI18n } from './i18n'
import { UNSUITED_CASES_ROOT_ID } from './testRepositoryUtils'
import { caseCreationFormats, caseFormatPresentation } from './features/casos/caseFormat'

export function SuiteActionsMenu({ props, suite, canRetireSuite }: any) {
  const { t } = useI18n()
  const { showActions = true, canEditSuites = true, canEditCases = true, openSuiteDropdown,
    onToggleSuiteDropdown, onCreateCase, onCreateSuite, onEditSuite, onCloneSuite,
    onMoveSuite, onReorderSuite, onRestoreSuite, onArchiveSuite, onDeleteSuite } = props
  const isUnsuitedRoot = suite.id === UNSUITED_CASES_ROOT_ID
  const suiteMenuOpen = openSuiteDropdown === suite.id
  return (<>
{showActions && (canEditSuites || canEditCases) && !isUnsuitedRoot && <div className="ms-auto pl-2 flex-shrink-0">
          <Dropdown show={suiteMenuOpen} onToggle={(isOpen) => onToggleSuiteDropdown?.(isOpen ? suite.id : null)} onClick={(e) => e.stopPropagation()}>
            <Dropdown.Toggle variant="link" size="sm" className="p-1 text-muted shadow-none border-0 hover-text-primary d-flex align-items-center flex-shrink-0">
              <Settings size={14} />
            </Dropdown.Toggle>
            <Dropdown.Menu className="shadow-sm border-light-subtle app-small">
              {canEditCases && !suite.archivado && <Dropdown.Header className="px-3 pb-1 text-uppercase x-small text-muted">{t('common.newTestCase')}</Dropdown.Header>}
              {canEditCases && !suite.archivado && caseCreationFormats.map((format) => {
                const FormatIcon = caseFormatPresentation[format].icon
                const label = t(caseFormatPresentation[format].labelKey)
                return (
                  <Dropdown.Item
                    key={format}
                    onClick={() => onCreateCase(suite.id, format)}
                    className="d-flex align-items-center gap-2 text-dark"
                  >
                    <FormatIcon size={14} style={{ color: caseFormatPresentation[format].color }} aria-hidden="true" />
                    {label}
                  </Dropdown.Item>
                )
              })}
              {canEditSuites && <>
              <Dropdown.Divider />
              {!suite.archivado && <>
              <Dropdown.Item onClick={() => onCreateSuite(suite.id)} className="d-flex align-items-center gap-2 text-dark"><FolderPlus size={14}/> {t('common.newSubfolder')}</Dropdown.Item>
              <Dropdown.Item onClick={() => onEditSuite(suite)} className="d-flex align-items-center gap-2 text-dark"><Edit size={14}/> {t('common.editFolder')}</Dropdown.Item>
              {canEditCases && onCloneSuite && (
                <Dropdown.Item onClick={() => onCloneSuite(suite)} className="d-flex align-items-center gap-2 text-dark">
                  <ClipboardCopy size={14} className="flex-shrink-0" aria-hidden="true" />
                  <span className="text-truncate">{t('common.copySuite')}</span>
                </Dropdown.Item>
              )}
              {onMoveSuite && (
                <Dropdown.Item onClick={() => onMoveSuite(suite)} className="d-flex align-items-center gap-2 text-dark"><MoveRight size={14}/> {t('common.moveFolder')}</Dropdown.Item>
              )}
              {onReorderSuite && <>
                <Dropdown.Item onClick={() => onReorderSuite(suite.id, 'up')}><ArrowUp size={14} /> {t('casos.moveSuiteUp')}</Dropdown.Item>
                <Dropdown.Item onClick={() => onReorderSuite(suite.id, 'down')}><ArrowDown size={14} /> {t('casos.moveSuiteDown')}</Dropdown.Item>
              </>}
              </>}
              {canRetireSuite && (onArchiveSuite || onRestoreSuite) && <Dropdown.Divider />}
              {suite.archivado ? (
                canRetireSuite && onRestoreSuite && (
                  <Dropdown.Item onClick={() => onRestoreSuite(suite)} className="d-flex align-items-center gap-2 text-dark"><RotateCcw size={14}/> {t('common.restoreSuite')}</Dropdown.Item>
                )
              ) : (
                canRetireSuite && onArchiveSuite && (
                  <Dropdown.Item onClick={() => onArchiveSuite(suite)} className="d-flex align-items-center gap-2 text-dark"><Archive size={14}/> {t('common.archiveSuite')}</Dropdown.Item>
                )
              )}
              <Dropdown.Divider />
              {canRetireSuite && <Dropdown.Item onClick={() => onDeleteSuite(suite.id)} className="d-flex align-items-center gap-2 text-danger"><Trash2 size={14}/> {t('common.deleteFolder')}</Dropdown.Item>}
              </>}
            </Dropdown.Menu>
          </Dropdown>
        </div>}
  </>)
}

export function CaseActionsMenu({ props, suite, test, testTooltip, testIndex, testCount, canOrganize, organize, canonicalPositionForVisibleIndex }: any) {
  const { t } = useI18n()
  const { showActions = true, canEditCases = true, canViewVersions = true, openTestDropdown,
    onToggleTestDropdown, onViewVersions, onEditCase, onCloneCase, onOrganizeCase,
    onMoveCase, onArchiveCase, onRestoreCase, onDeleteCase } = props
  const isUnsuitedRoot = suite.id === UNSUITED_CASES_ROOT_ID
  return (<>
{showActions && (canEditCases || (canViewVersions && test.version > 1)) && <Dropdown show={openTestDropdown === test.id} onToggle={(isOpen) => onToggleTestDropdown?.(isOpen ? test.id : null)} onClick={(e) => e.stopPropagation()}>
                <Dropdown.Toggle
                  as="button"
                  type="button"
                  bsPrefix="suite-tree-case-actions-toggle"
                  className="text-muted suite-tree-case-actions d-inline-flex align-items-center justify-content-center"
                  title={t('common.caseOptions')}
                  aria-label={`${t('common.caseOptions')}: ${testTooltip}`}
                >
                  <MoreVertical size={14} />
                </Dropdown.Toggle>
                <Dropdown.Menu className="shadow-sm border-light-subtle app-small">
                  {canViewVersions && onViewVersions && test.version > 1 && (
                    <Dropdown.Item onClick={() => onViewVersions(test)} className="d-flex align-items-center gap-2 text-dark">
                      <History size={14} /> {t('common.viewChanges')}
                    </Dropdown.Item>
                  )}
                  {canEditCases && <>
                  <Dropdown.Item disabled={suite.archivado} onClick={() => onEditCase(test)} className="d-flex align-items-center gap-2 text-dark">
                    <Edit size={14} /> {t('common.editCase')}
                  </Dropdown.Item>
                  {onCloneCase && (
                    <Dropdown.Item disabled={suite.archivado} onClick={() => onCloneCase(test)} className="d-flex align-items-center gap-2 text-dark">
                      <ClipboardCopy size={14} /> {t('common.copyAsNewTest')}
                    </Dropdown.Item>
                  )}
                  {onOrganizeCase && (
                    <>
                      <Dropdown.Item disabled={!canOrganize || isUnsuitedRoot || testIndex === 0} onClick={() => void organize(test, suite.id, canonicalPositionForVisibleIndex(suite.id, testIndex - 1))} className="d-flex align-items-center gap-2 text-dark"><ArrowUp size={14} /> {t('casos.moveCaseUp')}</Dropdown.Item>
                      <Dropdown.Item disabled={!canOrganize || isUnsuitedRoot || testIndex === testCount - 1} onClick={() => void organize(test, suite.id, canonicalPositionForVisibleIndex(suite.id, testIndex + 1))} className="d-flex align-items-center gap-2 text-dark"><ArrowDown size={14} /> {t('casos.moveCaseDown')}</Dropdown.Item>
                    </>
                  )}
                  {onMoveCase && (
                    <Dropdown.Item disabled={suite.archivado} onClick={() => onMoveCase(test)} className="d-flex align-items-center gap-2 text-dark">
                      <MoveRight size={14} /> {t('common.moveTest')}
                    </Dropdown.Item>
                  )}
                  {(onArchiveCase || onRestoreCase) && <Dropdown.Divider />}
                  {test.caseStatus === 'ARCHIVADO' ? (
                    onRestoreCase && (
                      <Dropdown.Item disabled={suite.archivado} onClick={() => onRestoreCase(test)} className="d-flex align-items-center gap-2 text-dark">
                        <RotateCcw size={14} /> {t('common.restoreTest')}
                      </Dropdown.Item>
                    )
                  ) : (
                    onArchiveCase && (
                      <Dropdown.Item disabled={suite.archivado} onClick={() => onArchiveCase(test)} className="d-flex align-items-center gap-2 text-dark">
                        <Archive size={14} /> {t('common.archiveTest')}
                      </Dropdown.Item>
                    )
                  )}
                  <Dropdown.Divider />
                  <Dropdown.Item disabled={suite.archivado} onClick={() => onDeleteCase(test.id)} className="d-flex align-items-center gap-2 text-danger">
                    <Trash2 size={14} /> {t('common.deleteCase')}
                  </Dropdown.Item>
                  </>}
                </Dropdown.Menu>
              </Dropdown>}
  </>)
}
