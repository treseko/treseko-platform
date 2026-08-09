import { Badge, Button, Dropdown, Form } from "react-bootstrap";
import { Filter, FolderPlus, Folders, RefreshCw, Search } from "lucide-react";

type Props = { context: any };

export function CaseSuiteExplorer({ context }: Props) {
  const {
    t, suiteExplorerWidth, mobileExplorerOpen, caseArchiveView, caseArchiveCounts,
    setCaseArchiveView, setSelectedSubSuiteId, setTestSearchQuery, setCaseEditorOpen,
    setEditingCasoMasterId, setSelectedTest, testSearchQuery, canEditSuites,
    openCreateSuiteModal, authoringInitialLoading, visibleSuiteTree, authoringRefreshing,
    renderAuthoringSuiteTree, canEditCases, openCloneCaseModal, canEditSuites: canEditSuitesValue,
    openCloneSuiteModal, openMoveCaseModal, startSuiteExplorerResize, setMobileExplorerOpen,
  } = context;
  const canCreateSuites = canEditSuitesValue ?? canEditSuites;
  return (
<div className={`authoring-sidebar border-end bg-light shadow-sm text-start d-flex flex-column z-1 position-relative ${mobileExplorerOpen ? 'is-open' : ''}`} style={{ width: `${suiteExplorerWidth}px`, minWidth: '260px', maxWidth: '560px', flexShrink: 0 }}>
  <div className="p-3 bg-white border-bottom fw-bold text-muted small d-flex flex-column gap-3 shadow-sm">
    <div className="d-flex justify-content-between align-items-center">
      <span className="text-uppercase" style={{ letterSpacing: '0.5px' }}>{t('casos.suiteExplorer')}</span>
      <div className="d-flex align-items-center gap-2">
        <Dropdown align="end">
          <Dropdown.Toggle
            variant="link"
            size="sm"
            className="p-0 text-decoration-none x-small fw-bold text-secondary hover-text-primary d-flex align-items-center gap-1 shadow-none border-0"
            title={t('casos.filterTests')}
          >
            <Filter size={13} />
            {caseArchiveView === 'archived' ? t('casos.archived') : caseArchiveView === 'all' ? t('casos.all') : t('casos.active')}
          </Dropdown.Toggle>
          <Dropdown.Menu className="shadow-sm border-light-subtle app-small">
            {[
              ['active', t('casos.active'), caseArchiveCounts.active],
              ['archived', t('casos.archived'), caseArchiveCounts.archived],
              ['all', t('casos.all'), caseArchiveCounts.all]
            ].map(([value, label, count]: any) => (
              <Dropdown.Item
                key={value}
                active={caseArchiveView === value}
                onClick={() => setCaseArchiveView?.(value)}
                className="d-flex align-items-center justify-content-between gap-3"
              >
                <span>{label}</span>
                <span className="badge bg-light text-secondary border">{count}</span>
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown>
        <Button variant="link" size="sm" className="p-0 text-decoration-none x-small fw-bold text-secondary hover-text-primary" onClick={() => {
          setSelectedSubSuiteId(null); setTestSearchQuery(''); setCaseEditorOpen(false); setEditingCasoMasterId(null); setSelectedTest(null);
        }}>{t('casos.clear')}</Button>
      </div>
    </div>
    <div className="input-group input-group-sm">
      <span className="input-group-text bg-light border-end-0 text-muted"><Search size={14} /></span>
      <Form.Control name="a11y-casesuiteexplorertsx-57" aria-label="Campo de formulario" type="text" placeholder={t('casos.searchPlaceholder')} className="bg-light border-start-0 shadow-none ps-0" value={testSearchQuery} onChange={(e) => setTestSearchQuery(e.target.value)} />
    </div>
    {canEditSuites && (
      <Button variant="primary" size="sm" className="w-100 fw-bold d-flex justify-content-center align-items-center gap-2 shadow-sm rounded-pill" onClick={() => openCreateSuiteModal()}>
        <FolderPlus size={16} /> {t('casos.newRootSuite')}
      </Button>
    )}
  </div>

  <div className="p-3 overflow-auto flex-grow-1 pb-5">
    {authoringInitialLoading ? (
      <div className="text-center text-muted p-4 small"><div className="spinner-border spinner-border-sm text-primary mb-2"></div><br/>{t('casos.loadingStructure')}</div>
    ) : visibleSuiteTree.length === 0 ? (
      <div className="text-center text-muted p-4 small border rounded-3 border-dashed bg-white">
        <Folders size={24} className="mb-2 opacity-50"/>
        <p className="mb-2">{t('casos.repoEmpty')}</p>
        {canEditSuites && <Button size="sm" variant="outline-primary" className="rounded-pill px-3" onClick={() => openCreateSuiteModal()}>{t('casos.createFirstSuite')}</Button>}
      </div>
    ) : (
      <>
        {authoringRefreshing && (
          <div className="d-flex align-items-center gap-2 text-primary x-small fw-bold mb-2">
            <RefreshCw size={12} className="animate-pulse" />
            {t('casos.updating')}
          </div>
        )}
        {renderAuthoringSuiteTree(
          visibleSuiteTree,
          canEditCases ? openCloneCaseModal : undefined,
          canEditSuites ? openCloneSuiteModal : undefined,
          canEditCases ? openMoveCaseModal : undefined,
        )}
      </>
    )}
  </div>
  <div
    onMouseDown={startSuiteExplorerResize}
    title={t('casos.resizeExplorer')}
    style={{ position: 'absolute', top: 0, right: -4, width: 8, height: '100%', cursor: 'col-resize', zIndex: 5 }}
  />
</div>
  );
}
