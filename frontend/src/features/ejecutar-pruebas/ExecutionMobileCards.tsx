import { Alert, Badge, Button, Form } from "react-bootstrap";
import { Bug, Clock, PlayCircle } from "lucide-react";

const getTrend = (test: any) => {
  if (!test.history || test.history.length < 2) return null;
  const current = test.lastResult;
  const previous = test.history[1]?.status;
  if (!previous) return null;
  const isPassed = (status: string) => status === "PASO" || status === "OK";
  const isFailed = (status: string) =>
    status === "FALLO" || status === "FALLIDO";
  if (isPassed(current) && isFailed(previous)) return "up";
  if (isFailed(current) && isPassed(previous)) return "down";
  if (current === previous) return "same";
  return "neutral";
};

const getLastResultColor = (test: any) => {
  if (test.lastResult === "PASO" || test.lastResult === "OK") return "success";
  if (test.lastResult === "FALLO" || test.lastResult === "FALLIDO") return "danger";
  if (test.lastResult === "BLOQUEADO") return "primary";
  return "secondary";
};

export function ExecutionMobileCards({ options }: { options: any }) {
  const {
    visibleTests,
    selectedTest,
    handleSelectTestForExecution,
    activeBuildResultsLoading,
    activeBuildResultsLoaded,
    getOpenBugsForCase,
    isRetestBug,
    renderOpenBugBadge,
    isOutdatedExecutionCase,
    selectedExecutionTestIds,
    toggleExecutionSelection,
    canStartAnyExecution,
    openSingleCaseExecutionSelector,
    getExecutionActionLabel,
    renderInternalBugButton,
    executionInitialLoading,
    bugCaseFilter,
  } = options;

  return (
    <div className="execution-mobile-cards">
      {visibleTests.map((test: any) => {
        const isSelected = selectedTest?.id === test.id;
        const lastResultColor = getLastResultColor(test);
        const trend = getTrend(test);
        const isResultHydrating =
          activeBuildResultsLoading && !activeBuildResultsLoaded;
        const openBugs = getOpenBugsForCase(test);
        return (
          <div
            key={test.id}
            className={`execution-case-card p-3 ${isSelected ? "border-primary" : ""}`}
            onClick={() => handleSelectTestForExecution(test)}
          >
            <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
              <div className="min-w-0">
                <div className="font-monospace fw-bold x-small text-secondary">
                  {test.code || test.id.slice(0, 8).toUpperCase()}
                </div>
                <div className="fw-bold text-dark text-break">{test.title}</div>
                <div className="x-small text-muted mt-1">
                  v{test.version} actual - {test.type}
                </div>
              </div>
              <div onClick={(event) => event.stopPropagation()}>
                <Form.Check name="a11y-executionmobilecardstsx-72" aria-label="Campo de formulario"
                  checked={selectedExecutionTestIds.includes(test.id)}
                  onChange={() => toggleExecutionSelection(test.id)}
                />
              </div>
            </div>

            <div className="d-flex flex-wrap gap-2 mb-3">
              <Badge bg="light" text="dark" className="border">{test.component}</Badge>
              <Badge
                bg={test.priority === "ALTA" || test.priority === "CRITICA" ? "danger" : test.priority === "BAJA" ? "secondary" : "warning"}
                text={test.priority === "MEDIA" ? "dark" : undefined}
              >{test.priority || "-"}</Badge>
              <Badge
                bg={test.criticality === "CRITICA" ? "danger" : test.criticality === "ALTA" ? "warning" : "light"}
                text="dark"
                className="border"
              >{test.criticality || "-"}</Badge>
              {test.stepsCount != null && <Badge bg="light" text="dark" className="border">{test.stepsCount} pasos</Badge>}
              {isOutdatedExecutionCase(test) && <Badge bg="warning" text="dark" className="border">Nueva v{test.latestVersion}</Badge>}
              {renderOpenBugBadge(test)}
            </div>

            {openBugs.length > 0 && (
              <Alert variant={openBugs.some(isRetestBug) ? "warning" : "danger"} className="py-2 px-3 x-small mb-3">
                {openBugs.some(isRetestBug)
                  ? "Tiene bug pendiente de retest en esta prueba."
                  : `Tiene ${openBugs.length} bug${openBugs.length > 1 ? "s" : ""} abierto${openBugs.length > 1 ? "s" : ""} relacionado${openBugs.length > 1 ? "s" : ""}.`}
              </Alert>
            )}

            <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
              {test.lastResult ? (
                <Badge bg={lastResultColor} className="text-uppercase">
                  {test.lastResult}{test.lastExecutedVersion ? ` - v${test.lastExecutedVersion}` : ""}
                </Badge>
              ) : isResultHydrating ? (
                <span className="text-muted small">Cargando resultado...</span>
              ) : (
                <Badge bg="light" text="secondary" className="border">Sin correr</Badge>
              )}
              {trend && (
                <Badge bg="light" text="dark" className="border">
                  Tendencia: {trend === "up" ? "mejoro" : trend === "down" ? "empeoro" : "igual"}
                </Badge>
              )}
            </div>

            <div className="d-flex flex-column gap-2">
              {test.lastExecutedAt && (
                <div className="x-small text-muted">
                  <Clock size={12} className="me-1" />
                  {test.lastExecutedAt}{test.lastExecutedBy ? ` - ${test.lastExecutedBy}` : ""}
                </div>
              )}
              {canStartAnyExecution && (
                <Button
                  variant="outline-success"
                  size="sm"
                  className="fw-bold"
                  onClick={(event) => {
                    event.stopPropagation();
                    openSingleCaseExecutionSelector(test);
                  }}
                >
                  <PlayCircle size={15} className="me-1" /> {getExecutionActionLabel(test)}
                </Button>
              )}
              {renderInternalBugButton(test)}
            </div>
          </div>
        );
      })}
      {executionInitialLoading && visibleTests.length === 0 && (
        <div className="text-center py-5 text-muted small">Cargando pruebas del proyecto...</div>
      )}
      {!executionInitialLoading && visibleTests.length === 0 && (
        <div className="text-center py-5 text-muted small">
          {bugCaseFilter === "open"
            ? "No hay pruebas con bugs abiertos en esta vista."
            : bugCaseFilter === "retest"
              ? "No hay pruebas pendientes de retest en esta vista."
              : "No se encontraron pruebas."}
        </div>
      )}
    </div>
  );
}
