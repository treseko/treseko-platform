import { Badge, Button, Form, Table } from "react-bootstrap";
import { CheckCircle2, ChevronRight, PlayCircle, RefreshCw, Search, User } from "lucide-react";

const getTrend = (test: any) => {
  if (!test.history || test.history.length < 2) return null;
  const current = test.lastResult; const previous = test.history[1]?.status;
  if (!previous) return null;
  const passed = (status: string) => status === "PASO" || status === "OK";
  const failed = (status: string) => status === "FALLO" || status === "FALLIDO";
  if (passed(current) && failed(previous)) return "up"; if (failed(current) && passed(previous)) return "down";
  if (current === previous) return "same"; return "neutral";
};
const getLastResultColor = (test: any) => test.lastResult === "PASO" || test.lastResult === "OK" ? "success" : test.lastResult === "FALLO" || test.lastResult === "FALLIDO" ? "danger" : test.lastResult === "BLOQUEADO" ? "primary" : "secondary";

export function ExecutionTestsTable({ options }: { options: any }) {
  const { visibleTests, t, allVisibleExecutionTestsSelected, toggleVisibleExecutionSelection, selectedTest, handleSelectTestForExecution, activeBuildResultsLoading, activeBuildResultsLoaded, selectedExecutionTestIds, toggleExecutionSelection, isOutdatedExecutionCase, renderOpenBugBadge, canStartAnyExecution, renderInternalBugButton, openSingleCaseExecutionSelector, executionInitialLoading, bugCaseFilter } = options;
  return (
  <Table
    hover
    size="sm"
    className="execution-desktop-table mb-0 align-middle border-0"
    style={{ tableLayout: "fixed" }}
  >
    <thead
      className="bg-light text-dark sticky-top"
      style={{ top: 0 }}
    >
      <tr className="x-small text-muted text-uppercase border-bottom">
        <th className="ps-3 py-3 border-0" style={{ width: "40px" }}>
          <Form.Check
            checked={allVisibleExecutionTestsSelected}
            onChange={(event) =>
              toggleVisibleExecutionSelection(event.target.checked)
            }
          />
        </th>
        <th className="py-3 border-0" style={{ width: "80px" }}>
          {t('ejecutarPruebas.code')}
        </th>
        <th className="border-0" style={{ width: "300px" }}>
          Nombre
        </th>
        <th className="border-0" style={{ width: "80px" }}>
          Prior.
        </th>
        <th className="border-0" style={{ width: "80px" }}>
          Criti.
        </th>
        <th
          className="border-0"
          style={{ width: "55px", textAlign: "center" }}
        >
          Pasos
        </th>
        <th className="border-0" style={{ width: "120px" }}>
          {t('ejecutarPruebas.lastResult')}
        </th>
        <th
          className="border-0"
          style={{ width: "90px", textAlign: "center" }}
        >
          Tendencia
        </th>
        <th className="border-0" style={{ width: "140px" }}>
          {t('ejecutarPruebas.lastExecution')}
        </th>
        <th
          className="border-0 text-end pe-3"
          style={{ width: "150px" }}
        >
          Acciones
        </th>
      </tr>
    </thead>
    <tbody className="text-dark">
      {visibleTests.map((test) => {
        const isSelected = selectedTest?.id === test.id;
        const lastResultColor = getLastResultColor(test);
        const trend = getTrend(test);
        const isResultHydrating =
          activeBuildResultsLoading && !activeBuildResultsLoaded;
        const testCode =
          test.code || test.id.slice(0, 8).toUpperCase();
        const testFullName = String(test.title || "Sin nombre");
        const testTooltip = `${testCode} - ${testFullName}`;
        return (
          <tr
            key={test.id}
            className={`cursor-pointer border-bottom ${isSelected ? "table-primary" : ""}`}
            onClick={() => handleSelectTestForExecution(test)}
            style={{ transition: "background 0.1s" }}
          >
            <td
              className="ps-3"
              onClick={(event) => event.stopPropagation()}
            >
              <Form.Check
                checked={selectedExecutionTestIds.includes(test.id)}
                onChange={() => toggleExecutionSelection(test.id)}
              />
            </td>
            <td
              className="fw-bold text-secondary font-monospace"
              style={{ fontSize: "var(--app-font-size-micro)" }}
            >
              {testCode}
            </td>
            <td>
              <div
                className="fw-semibold text-dark small text-truncate"
                style={{ maxWidth: "290px" }}
                title={testTooltip}
                aria-label={testTooltip}
              >
                <span
                  className="text-truncate"
                  title={testTooltip}
                  aria-label={testTooltip}
                >
                  {testFullName}
                </span>
              </div>
              <div className="x-small text-muted d-flex align-items-center gap-1 flex-wrap">
                <span>
                  v{test.version} actual · {test.type}
                </span>
                {isOutdatedExecutionCase(test) && (
                  <Badge
                    bg="warning"
                    text="dark"
                    className="border x-small"
                  >
                    Nueva v{test.latestVersion}
                  </Badge>
                )}
                {renderOpenBugBadge(test)}
              </div>
            </td>
            <td>
              <Badge
                bg={
                  test.priority === "ALTA" ||
                  test.priority === "CRITICA"
                    ? "danger"
                    : test.priority === "BAJA"
                      ? "secondary"
                      : "warning"
                }
                text={test.priority === "MEDIA" ? "dark" : undefined}
                className="x-small"
              >
                {test.priority || "—"}
              </Badge>
            </td>
            <td>
              <Badge
                bg={
                  test.criticality === "CRITICA"
                    ? "danger"
                    : test.criticality === "ALTA"
                      ? "warning"
                      : "light"
                }
                text={
                  test.criticality === "CRITICA" ? undefined : "dark"
                }
                className="border x-small"
              >
                {test.criticality || "—"}
              </Badge>
            </td>
            <td className="text-center">
              {test.stepsCount != null ? (
                <span className="badge rounded-pill bg-light text-dark border x-small fw-bold">
                  {test.stepsCount}
                </span>
              ) : (
                <span className="text-muted x-small">—</span>
              )}
            </td>
            <td>
              {test.lastResult ? (
                <Badge
                  bg={lastResultColor}
                  className="x-small text-uppercase w-100 text-center"
                  style={{ letterSpacing: "0.5px" }}
                >
                  {test.lastResult === "PASO" ||
                  test.lastResult === "OK"
                    ? t('ejecutarPruebas.passed')
                    : test.lastResult === "FALLO" ||
                        test.lastResult === "FALLIDO"
                      ? t('ejecutarPruebas.failedResult')
                      : test.lastResult}
                  {test.lastExecutedVersion
                    ? ` · v${test.lastExecutedVersion}`
                    : ""}
                </Badge>
              ) : isResultHydrating ? (
                <span className="text-muted x-small">
                  Cargando...
                </span>
              ) : (
                <span className="text-muted x-small">Sin correr</span>
              )}
            </td>
            <td className="text-center">
              {trend === "up" && (
                <div
                  className="d-flex flex-column align-items-center"
                  title={t('ejecutarPruebas.improvedSincePrevious')}
                >
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "50%",
                      background: "#e8f5e9",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <ChevronRight
                      size={14}
                      className="text-success"
                      style={{ transform: "rotate(-90deg)" }}
                    />
                  </div>
                  <div
                    className="x-small text-success fw-bold"
                    style={{ fontSize: "var(--app-font-size-meta)" }}
                  >
                    {t('ejecutarPruebas.improved')}
                  </div>
                </div>
              )}
              {trend === "down" && (
                <div
                  className="d-flex flex-column align-items-center"
                  title={t('ejecutarPruebas.worsenedSincePrevious')}
                >
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "50%",
                      background: "#ffebee",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <ChevronRight
                      size={14}
                      className="text-danger"
                      style={{ transform: "rotate(90deg)" }}
                    />
                  </div>
                  <div
                    className="x-small text-danger fw-bold"
                    style={{ fontSize: "var(--app-font-size-meta)" }}
                  >
                    {t('ejecutarPruebas.worsened')}
                  </div>
                </div>
              )}
              {trend === "same" && (
                <div
                  className="d-flex flex-column align-items-center"
                  title={t('ejecutarPruebas.sameAsPrevious')}
                >
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "50%",
                      background: "#f8f9fa",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <div
                      style={{
                        width: "10px",
                        height: "2px",
                        background: "#6c757d",
                      }}
                    />
                  </div>
                  <div
                    className="x-small text-muted fw-bold"
                    style={{ fontSize: "var(--app-font-size-meta)" }}
                  >
                    IGUAL
                  </div>
                </div>
              )}
              {!trend && (
                <span className="text-muted x-small">—</span>
              )}
            </td>
            <td>
              {test.lastExecutedAt ? (
                <div>
                  <div
                    className="x-small text-dark text-truncate"
                    style={{ maxWidth: "120px" }}
                    title={test.lastExecutedAt}
                  >
                    {test.lastExecutedAt}
                  </div>
                  {test.lastExecutedBy && (
                    <div
                      className="x-small text-muted text-truncate"
                      style={{ maxWidth: "120px" }}
                      title={test.lastExecutedBy}
                    >
                      <User size={10} className="me-1" />
                      {test.lastExecutedBy}
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-muted x-small">—</span>
              )}
            </td>
            <td className="text-end pe-3">
              <div className="d-inline-flex align-items-center justify-content-end gap-2">
                {renderInternalBugButton(test, true)}
                {canStartAnyExecution && (
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0 text-success shadow-none"
                    title={t('ejecutarPruebas.quickManualRun')}
                    onClick={(event) => {
                      event.stopPropagation();
                      openSingleCaseExecutionSelector(test);
                    }}
                  >
                    <PlayCircle size={16} />
                  </Button>
                )}
              </div>
            </td>
          </tr>
        );
      })}
      {executionInitialLoading && visibleTests.length === 0 && (
        <tr>
          <td
            colSpan={10}
            className="text-center py-5 text-muted small"
          >
            <RefreshCw
              size={24}
              className="mb-2 opacity-50 d-block mx-auto animate-pulse"
            />
            Cargando pruebas del proyecto...
          </td>
        </tr>
      )}
      {!executionInitialLoading && visibleTests.length === 0 && (
        <tr>
          <td
            colSpan={10}
            className="text-center py-5 text-muted small"
          >
            <Search
              size={24}
              className="mb-2 opacity-50 d-block mx-auto"
            />
            {bugCaseFilter === "open"
              ? "No hay pruebas con bugs abiertos en esta vista."
              : bugCaseFilter === "retest"
                ? "No hay pruebas pendientes de retest en esta vista."
                : "No se encontraron pruebas."}
          </td>
        </tr>
      )}
  </tbody>
</Table>
  );
}
