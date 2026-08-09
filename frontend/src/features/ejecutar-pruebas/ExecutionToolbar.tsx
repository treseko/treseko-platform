import { Badge, Button, Form } from 'react-bootstrap'
import { Bug, Folders, History, PlayCircle, RefreshCw, Search } from 'lucide-react'
import { findSuiteById } from '../../testRepositoryUtils'

export function ExecutionToolbar({ options }: { options: any }) {
  const { testSearchQuery, suitesTree, selectedSuiteId, t, visibleTests, canViewBugs, openBugsLoading, openBugTotal, bugCaseFilter, setBugCaseFilter, openBugCaseCount, retestBugCaseCount, executionRefreshing, getExecutionStatusKey, mobileExplorerOpen, setMobileExplorerOpen, selectedExecutionTests, canViewBuildHistory, onOpenBuildHistory, canStartAnyExecution, openExecutionSelector } = options
  return (
        <div
          className="p-3 bg-white border-bottom d-flex justify-content-between align-items-center sticky-top z-1 app-toolbar"
          style={{ flexWrap: "wrap", gap: "8px" }}
        >
          <div className="d-flex align-items-center gap-3">
            <h6 className="m-0 fw-bold text-dark">
              {testSearchQuery.trim() !== "" ? (
                <span className="text-primary">
                  <Search size={16} className="me-1" />"{testSearchQuery}"
                </span>
              ) : (
                <>
                  {findSuiteById(suitesTree, selectedSuiteId)?.nombre ||
                    t('ejecutarPruebas.allCases')}
                </>
              )}
            </h6>
            <div className="d-flex gap-2 align-items-center">
              <span
                className="badge rounded-pill"
                style={{
                  background: "#e9ecef",
                  color: "#495057",
                  fontSize: "var(--app-font-size-meta)",
                }}
              >
                {visibleTests.length} casos
              </span>
              {canViewBugs &&
                (openBugsLoading ||
                  openBugTotal > 0 ||
                  bugCaseFilter !== "all") && (
                  <div className="d-flex align-items-center gap-1">
                    <Bug size={13} className="text-danger" />
                    <Form.Select name="a11y-executiontoolbartsx-42" aria-label="Campo de formulario"
                      size="sm"
                      value={bugCaseFilter}
                      disabled={openBugsLoading}
                      onChange={(event) =>
                        setBugCaseFilter(
                          event.target.value as "all" | "open" | "retest",
                        )
                      }
                      className={`x-small fw-bold py-0 ${bugCaseFilter === "all" ? "border-danger text-danger" : "bg-danger text-white border-danger"}`}
                      style={{ width: 190, height: 24 }}
                      title={t('ejecutarPruebas.filterRelatedBugs')}
                    >
                      <option value="all">
                        {openBugsLoading
                          ? t('ejecutarPruebas.loadingBugs')
                          : `${t('ejecutarPruebas.allBugs')} (${openBugTotal} bug${openBugTotal === 1 ? "" : "s"})`}
                      </option>
                      <option value="open">
                        Con bugs abiertos ({openBugCaseCount} caso
                        {openBugCaseCount === 1 ? "" : "s"})
                      </option>
                      <option value="retest">
                        Pendientes retest ({retestBugCaseCount} caso
                        {retestBugCaseCount === 1 ? "" : "s"})
                      </option>
                    </Form.Select>
                  </div>
                )}
              {executionRefreshing && (
                <span
                  className="badge rounded-pill bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 d-flex align-items-center gap-1"
                  style={{ fontSize: "var(--app-font-size-meta)" }}
                >
                  <RefreshCw size={10} className="animate-pulse" /> Actualizando
                </span>
              )}
              {visibleTests.some(
                (test) => getExecutionStatusKey(test) === "passed",
              ) && (
                <span
                  className="badge rounded-pill bg-success bg-opacity-10 text-success border border-success border-opacity-25"
                  style={{ fontSize: "var(--app-font-size-meta)" }}
                >
                  ✓{" "}
                  {
                    visibleTests.filter(
                      (test) => getExecutionStatusKey(test) === "passed",
                    ).length
                  }{" "}
                  pasados
                </span>
              )}
              {visibleTests.some(
                (test) => getExecutionStatusKey(test) === "failed",
              ) && (
                <span
                  className="badge rounded-pill bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25"
                  style={{ fontSize: "var(--app-font-size-meta)" }}
                >
                  ✗{" "}
                  {
                    visibleTests.filter(
                      (test) => getExecutionStatusKey(test) === "failed",
                    ).length
                  }{" "}
                  fallidos
                </span>
              )}
              {visibleTests.some(
                (test) => getExecutionStatusKey(test) === "pending",
              ) && (
                <span
                  className="badge rounded-pill bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-25"
                  style={{ fontSize: "var(--app-font-size-meta)" }}
                >
                  —{" "}
                  {
                    visibleTests.filter(
                      (test) => getExecutionStatusKey(test) === "pending",
                    ).length
                  }{" "}
                  sin correr
                </span>
              )}
            </div>
          </div>
          <div className="d-flex align-items-center gap-2">
            <Button
              variant="outline-primary"
              size="sm"
              className="mobile-only align-items-center justify-content-center gap-1 fw-bold"
              onClick={() => setMobileExplorerOpen((current) => !current)}
            >
              <Folders size={14} />{" "}
              {mobileExplorerOpen ? "Ocultar explorador" : "Explorador"}
            </Button>
            <Badge bg="light" text="dark" className="border">
              {selectedExecutionTests.length} sel.
            </Badge>
            {canViewBuildHistory && (
              <Button
                variant="outline-secondary"
                size="sm"
                className="fw-bold d-flex align-items-center gap-1"
                onClick={onOpenBuildHistory}
              >
                <History size={14} /> {t('ejecutarPruebas.buildHistory')}
              </Button>
            )}
            {canStartAnyExecution && (
              <Button
                variant="primary"
                size="sm"
                className="fw-bold px-4 shadow-sm border-0"
                disabled={selectedExecutionTests.length === 0}
                title={
                  selectedExecutionTests.length === 0
                    ? "Selecciona al menos un caso ejecutable"
                    : undefined
                }
                onClick={openExecutionSelector}
              >
                <PlayCircle size={15} className="me-1" /> {t('ejecutarPruebas.startExecution')}
              </Button>
            )}
          </div>
        </div>


  )
}
