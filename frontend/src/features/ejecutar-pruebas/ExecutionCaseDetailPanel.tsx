import { Alert, Badge, Button } from "react-bootstrap";
import { AlertCircle, Bug, CheckCircle2, Clock, FileText, History, ImagePlus, Info, PlayCircle, User, XCircle } from "lucide-react";
import type { AttachmentMeta } from "../../EvidenceUpload";
import { isImageAsset, resolveAssetUrl } from "../../shared/utils/assets";
import { isEvidenceAvailable } from "../../shared/utils/evidenceAvailability";
import { getExecutionHistoryStats, getStatusColor, normalizeExecutionHistory } from "../ejecucion/executionUtils";
import { getBugPriorityPresentation } from "../bugs/bugPresentation";
import { ExecutionHistoryPanel } from "./ExecutionHistoryPanel";

export function ExecutionCaseDetailPanel({ options }: { options: any }) {
  const { selectedTest, t, setSelectedTest, currentBuildId, buildsList, canStartAnyExecution, isOutdatedExecutionCase, openSingleCaseExecutionSelector, getExecutionActionLabel, renderInternalBugButton, getBugStatusBadge, getBugSeverityBadge, getBugCriticalityBadge, getOpenBugsForCase, getStatusColor: _getStatusColor, onOpenRunHistory, onOpenEvidence, setZoomImage, showFeedback, onOpenBugTracker } = options;
  if (!selectedTest) return null;
            <div
  className="execution-detail-panel border-start bg-white d-flex flex-column text-start animate__animated animate__fadeInRight"
  style={{
    width: "320px",
    minWidth: "320px",
    boxShadow: "-4px 0 16px rgba(0,0,0,0.06)",
  }}
            >
  <div className="p-3 border-bottom d-flex justify-content-between align-items-start bg-primary bg-gradient text-white">
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        className="x-small opacity-75 text-uppercase fw-bold mb-1"
        style={{ letterSpacing: "0.8px" }}
      >
        {selectedTest.code}
      </div>
      <div
        className="fw-bold"
        style={{ fontSize: "var(--app-font-size-small)", lineHeight: "1.3" }}
      >
        {selectedTest.title}
      </div>
    </div>
    <Button
      variant="link"
      size="sm"
      className="p-0 ms-2 text-white opacity-75"
      onClick={() => setSelectedTest(null)}
    >
      <XCircle size={18} />
    </Button>
  </div>

  <div className="flex-grow-1 overflow-auto p-0">
    {selectedTest.lastResult && (
      <div className="p-3 border-bottom">
        <div
          className="x-small fw-bold text-muted text-uppercase mb-2"
          style={{ letterSpacing: "0.7px" }}
        >
          {t('ejecutarPruebas.lastExecution')}
        </div>
        <div
          className={`rounded-2 p-2 x-small
          ${
            selectedTest.lastResult === "PASO" ||
            selectedTest.lastResult === "OK"
              ? "bg-success bg-opacity-10 text-success"
              : selectedTest.lastResult === "FALLO" ||
                  selectedTest.lastResult === "FALLIDO"
                ? "bg-danger bg-opacity-10 text-danger"
                : selectedTest.lastResult === "BLOQUEADO"
                  ? "bg-primary bg-opacity-10 text-primary"
                  : "bg-warning bg-opacity-10 text-warning"
          }`}
        >
          <div
            className="d-flex align-items-center gap-2 fw-bold text-uppercase"
            style={{ letterSpacing: "0.4px" }}
          >
            {(selectedTest.lastResult === "PASO" ||
              selectedTest.lastResult === "OK") && (
              <CheckCircle2 size={14} />
            )}
            {(selectedTest.lastResult === "FALLO" ||
              selectedTest.lastResult === "FALLIDO") && (
              <XCircle size={14} />
            )}
            {selectedTest.lastResult === "BLOQUEADO" && (
              <AlertCircle size={14} />
            )}
            <span>{selectedTest.lastResult}</span>
            {selectedTest.lastExecutedVersion ? (
              <Badge
                bg="light"
                text="dark"
                className="border ms-auto x-small"
              >
                Ejecutada como v{selectedTest.lastExecutedVersion}
              </Badge>
            ) : (
              <Badge
                bg="light"
                text="dark"
                className="border ms-auto x-small"
              >
                {t('ejecutarPruebas.unregisteredVersion')}
              </Badge>
            )}
          </div>
          <div className="d-flex flex-column gap-1 mt-2 text-muted">
            {selectedTest.lastExecutedAt && (
              <span>
                <Clock size={11} className="me-1" />
                {selectedTest.lastExecutedAt}
              </span>
            )}
            {selectedTest.lastExecutedBy && (
              <span>
                <User size={11} className="me-1" />
                {selectedTest.lastExecutedBy}
              </span>
            )}
          </div>
        </div>
      </div>
    )}

    <div className="p-3 border-bottom">
      <div
        className="x-small fw-bold text-muted text-uppercase mb-2"
        style={{ letterSpacing: "0.7px" }}
      >
        Caso actual
      </div>
      <div className="x-small text-muted mb-2">
        <span className="fw-semibold text-dark">
          {t('ejecutarPruebas.currentVersion')}
        </span>{" "}
        v{selectedTest.version}
      </div>
      <div className="d-flex flex-wrap gap-1 mb-2">
        <Badge
          bg={
            selectedTest.priority === "ALTA" ||
            selectedTest.priority === "CRITICA"
              ? "danger"
              : selectedTest.priority === "BAJA"
                ? "secondary"
                : "warning"
          }
          text={
            selectedTest.priority === "MEDIA" ? "dark" : undefined
          }
          className="x-small"
        >
          Prior. {selectedTest.priority || "—"}
        </Badge>
        <Badge
          bg={
            selectedTest.criticality === "CRITICA"
              ? "danger"
              : selectedTest.criticality === "ALTA"
                ? "warning"
                : "light"
          }
          text="dark"
          className="border x-small"
        >
          Criti. {selectedTest.criticality || "—"}
        </Badge>
        <Badge
          bg={
            selectedTest.caseStatus === "EN_REVISION"
              ? "info"
              : selectedTest.caseStatus === "DEPRECADO" ||
                  selectedTest.caseStatus === "ARCHIVADO"
                ? "secondary"
                : "success"
          }
          className="x-small"
        >
          {selectedTest.caseStatus || "ACTIVO"}
        </Badge>
        <Badge bg="light" text="dark" className="border x-small">
          {selectedTest.type}
        </Badge>
      </div>
      <div className="x-small text-muted d-flex flex-column gap-1">
        <div>
          <span className="fw-semibold text-dark">Componente:</span>{" "}
          {selectedTest.component}
        </div>
        {isOutdatedExecutionCase(selectedTest) && (
          <div className="text-warning fw-semibold">
            {t('ejecutarPruebas.newVersionAvailable')} v{selectedTest.latestVersion}
          </div>
        )}
        {selectedTest.stepsCount != null && (
          <div>
            <span className="fw-semibold text-dark">Pasos:</span>{" "}
            {selectedTest.stepsCount}
          </div>
        )}
      </div>
    </div>

    {getOpenBugsForCase(selectedTest).length > 0 && (
      <div className="p-3 border-bottom">
        <div
          className="x-small fw-bold text-muted text-uppercase mb-2 d-flex align-items-center justify-content-between"
          style={{ letterSpacing: "0.7px" }}
        >
          <span className="d-flex align-items-center gap-1">
            <Bug size={13} /> {t('ejecutarPruebas.relatedBugs')}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="p-0 text-primary shadow-none"
              title={t('ejecutarPruebas.relatedBugsInfo')}
              aria-label={t('ejecutarPruebas.relatedBugsInfo')}
              onClick={() =>
                showFeedback(
                  t('ejecutarPruebas.relatedBugs'),
                  t('ejecutarPruebas.relatedBugsDetail'),
                  "info",
                )
              }
            >
              <Info size={13} />
            </Button>
          </span>
          <Badge bg="danger" className="x-small">
            {getOpenBugsForCase(selectedTest).length}
          </Badge>
        </div>
        <div className="d-flex flex-column gap-2">
          {getOpenBugsForCase(selectedTest)
            .slice(0, 4)
            .map((bug: any) => {
              const statusBadge = getBugStatusBadge(bug);
              const severityBadge = getBugSeverityBadge(
                bug.severidad,
              );
              const priorityBadge = getBugPriorityPresentation(
                bug.prioridad,
              );
              const criticalityBadge = getBugCriticalityBadge(
                bug.criticidad,
              );
              const detailBadges = [
                severityBadge,
                priorityBadge,
                criticalityBadge,
              ].filter(Boolean);
              return (
                <div
                  key={bug.id || bug.codigo}
                  className="rounded-2 border p-2 bg-light x-small"
                >
                  <div className="d-flex align-items-center justify-content-between gap-2">
                    <span className="fw-bold text-dark">
                      {bug.codigo}
                    </span>
                    <Badge
                      bg={statusBadge.bg}
                      text={statusBadge.text}
                      className="x-small"
                    >
                      {statusBadge.label}
                    </Badge>
                  </div>
                  {detailBadges.length > 0 && (
                    <div className="d-flex flex-wrap gap-1 mt-2">
                      {detailBadges.map((badge: any) => (
                        <Badge
                          key={badge.label}
                          bg={badge.bg}
                          text={badge.text}
                          title={badge.title || badge.label}
                          className={`x-small ${badge.bg === "light" ? "border" : ""}`}
                        >
                          {badge.label}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div
                    className="text-dark mt-1 text-truncate"
                    title={bug.titulo}
                  >
                    {bug.titulo}
                  </div>
                  <div className="text-muted mt-1">
                    {bug.build_code ||
                    bug.metadata_json?.build_name ||
                    bug.build_id
                      ? `Origen: ${bug.build_code || bug.metadata_json?.build_name || String(bug.build_id).slice(0, 8)}`
                      : "Origen de build no registrado"}
                  </div>
                </div>
              );
            })}
          {getOpenBugsForCase(selectedTest).length > 4 && (
            <div className="text-muted x-small text-center">
              + {getOpenBugsForCase(selectedTest).length - 4} bugs
              relacionados
            </div>
          )}
          {onOpenBugTracker && (
            <Button
              variant="outline-danger"
              size="sm"
              className="fw-bold d-flex align-items-center justify-content-center gap-1"
              onClick={onOpenBugTracker}
            >
              <Bug size={14} /> Ver en Bug Tracker
            </Button>
          )}
        </div>
      </div>
    )}

    <div className="p-3 border-bottom">
      <div
        className="x-small fw-bold text-muted text-uppercase mb-1"
        style={{ letterSpacing: "0.7px" }}
      >
        {t('ejecutarPruebas.descriptionObjective')}
      </div>
      <p
        className={`x-small mb-0 ${selectedTest.description ? "text-dark" : "text-muted fst-italic"}`}
        style={{ lineHeight: "1.5" }}
      >
        {selectedTest.description || t('ejecutarPruebas.noDescription')}
      </p>
    </div>

    {selectedTest.pre && (
      <div className="p-3 border-bottom">
        <div
          className="x-small fw-bold text-muted text-uppercase mb-1"
          style={{ letterSpacing: "0.7px" }}
        >
          Precondiciones
        </div>
        <p
          className="x-small text-dark mb-0"
          style={{ lineHeight: "1.5" }}
        >
          {selectedTest.pre}
        </p>
      </div>
    )}

    {selectedTest.post && (
      <div className="p-3 border-bottom">
        <div
          className="x-small fw-bold text-muted text-uppercase mb-1"
          style={{ letterSpacing: "0.7px" }}
        >
          Postcondiciones
        </div>
        <p
          className="x-small text-dark mb-0"
          style={{ lineHeight: "1.5" }}
        >
          {selectedTest.post}
        </p>
      </div>
    )}

  <ExecutionHistoryPanel options={{ selectedTest, t, onOpenRunHistory, onOpenEvidence }} />

  <div className="p-3 border-top bg-light d-flex flex-column gap-2">
    {isOutdatedExecutionCase(selectedTest) && (
      <Alert
        variant="warning"
        className="py-2 px-3 x-small mb-0 border-0"
      >
        {t('ejecutarPruebas.updateVersionNotice', { current: selectedTest.version, latest: selectedTest.latestVersion })}
      </Alert>
    )}
    {canStartAnyExecution && (
      <Button
        variant="primary"
        className="w-100 fw-bold d-flex align-items-center justify-content-center gap-2 shadow-sm rounded-pill border-0"
        onClick={() =>
          openSingleCaseExecutionSelector(selectedTest)
        }
      >
        <PlayCircle size={18} />{" "}
        {getExecutionActionLabel(selectedTest)}
      </Button>
    )}
    {renderInternalBugButton(selectedTest)}
    <div className="x-small text-muted text-center">
      Build activa:{" "}
      <span className="fw-semibold text-dark">
        {buildsList.find((build) => build.id === currentBuildId)
          ?.name || "—"}
      </span>
    </div>
  </div>
  </div>
            </div>
}
