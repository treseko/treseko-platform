import { Badge, Button } from "react-bootstrap";
import { Clock, FileText, History, ImagePlus, User } from "lucide-react";
import type { AttachmentMeta } from "../../EvidenceUpload";
import { isImageAsset, resolveAssetUrl } from "../../shared/utils/assets";
import { isEvidenceAvailable } from "../../shared/utils/evidenceAvailability";
import { getExecutionHistoryStats, getStatusColor, normalizeExecutionHistory } from "../ejecucion/executionUtils";

export function ExecutionHistoryPanel({ options }: { options: any }) {
  const { selectedTest, t, onOpenRunHistory, onOpenEvidence } = options;
  return (
  <div className="p-3 border-bottom">
    {(() => {
      const executionHistory =
        normalizeExecutionHistory(selectedTest);
      const { total, passed, failed, successRate } =
        getExecutionHistoryStats(executionHistory);
      return (
        <>
          <div
            className="x-small fw-bold text-muted text-uppercase mb-2 d-flex align-items-center justify-content-between"
            style={{ letterSpacing: "0.7px" }}
          >
            <div className="d-flex align-items-center gap-1">
              <History size={13} /> {t('ejecutarPruebas.executionHistory')}
            </div>
            {total > 0 && (
              <Badge
                bg="light"
                text="dark"
                className="border x-small"
              >
                {total} ejecuciones
              </Badge>
            )}
          </div>

          {total > 0 && (
            <div className="d-flex gap-2 mb-3">
              <div
                className="flex-grow-1 p-2 rounded-2 text-center"
                style={{
                  background: "#e8f5e9",
                  fontSize: "var(--app-font-size-meta)",
                }}
              >
                <div className="fw-bold text-success">
                  {successRate}%
                </div>
                <div className="text-muted x-small">
                  {t('ejecutarPruebas.successRate')}
                </div>
              </div>
              <div
                className="flex-grow-1 p-2 rounded-2 text-center"
                style={{
                  background: "#f8f9fa",
                  fontSize: "var(--app-font-size-meta)",
                }}
              >
                <div className="fw-bold text-dark">{total}</div>
                <div className="text-muted x-small">{t('ejecutarPruebas.total')}</div>
              </div>
              <div
                className="flex-grow-1 p-2 rounded-2 text-center"
                style={{
                  background: "#e8f5e9",
                  fontSize: "var(--app-font-size-meta)",
                }}
              >
                <div className="fw-bold text-success">
                  {passed}
                </div>
                <div className="text-muted x-small">{t('ejecutarPruebas.passed')}</div>
              </div>
              <div
                className="flex-grow-1 p-2 rounded-2 text-center"
                style={{
                  background: failed > 0 ? "#ffebee" : "#f8f9fa",
                  fontSize: "var(--app-font-size-meta)",
                }}
              >
                <div
                  className={
                    failed > 0
                      ? "fw-bold text-danger"
                      : "fw-bold text-muted"
                  }
                >
                  {failed}
                </div>
                <div className="text-muted x-small">Fallidos</div>
              </div>
            </div>
          )}

          {total > 0 ? (
            <div className="d-flex flex-column gap-2">
              {executionHistory
                .slice(0, 5)
                .map((historyItem: any, index: number) => {
                  const statusColor =
                    historyItem.status === "PASO" ||
                    historyItem.status === "OK"
                      ? "#198754"
                      : historyItem.status === "FALLO" ||
                          historyItem.status === "FALLIDO"
                        ? "#dc3545"
                        : historyItem.status === "BLOQUEADO"
                          ? "#0d6efd"
                          : "#6c757d";
                  return (
                    <div
                      key={`${historyItem.date || "hist"}-${index}`}
                      className="d-flex align-items-start gap-2 p-2 rounded-2"
                      style={{
                        background: "#f8f9fa",
                        fontSize: "var(--app-font-size-meta)",
                        opacity: 0.9,
                      }}
                    >
                      <div
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          flexShrink: 0,
                          marginTop: "4px",
                          background: statusColor,
                        }}
                      />
                      <div className="flex-grow-1">
                        <div className="d-flex justify-content-between align-items-center">
                          <div className="d-flex align-items-center gap-1">
                            <Badge
                              bg={getStatusColor(
                                historyItem.status,
                              )}
                              className="x-small"
                            >
                              {historyItem.status?.toUpperCase()}
                            </Badge>
                            {historyItem.versionExecuted && (
                              <Badge
                                bg="light"
                                text="dark"
                                className="border x-small"
                              >
                                v{historyItem.versionExecuted}
                              </Badge>
                            )}
                          </div>
                          <div
                            className="text-muted"
                            style={{ fontSize: "var(--app-font-size-meta)" }}
                          >
                            {historyItem.date}
                          </div>
                        </div>
                        {historyItem.executedBy && (
                          <div
                            className="text-muted mt-1 d-flex align-items-center gap-1"
                            style={{ fontSize: "var(--app-font-size-meta)" }}
                          >
                            <User size={9} />
                            <span>{historyItem.executedBy}</span>
                          </div>
                        )}
                        {historyItem.duration && (
                          <div
                            className="text-muted mt-1"
                            style={{ fontSize: "var(--app-font-size-meta)" }}
                          >
                            <Clock size={9} className="me-1" />
                            <span>{historyItem.duration}</span>
                          </div>
                        )}
                        <div
                          className="text-muted mt-1"
                          style={{ fontSize: "var(--app-font-size-meta)" }}
                        >
                          <span className="fw-semibold text-dark">
                            Obs:
                          </span>{" "}
                          {historyItem.observation ||
                            "Sin observaciones registradas"}
                        </div>
                        {historyItem.testRunId && (
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 x-small text-decoration-none fw-bold mt-1"
                            onClick={() =>
                              onOpenRunHistory(
                                historyItem.testRunId,
                                historyItem.executionId,
                              )
                            }
                          >
                            Ver ejecucion
                          </Button>
                        )}
                        {(historyItem.evidenceUrl ||
                          historyItem.evidencias?.length > 0) && (
                          <div className="d-flex flex-wrap gap-2 mt-2 pt-2 border-top border-light-subtle">
                            {historyItem.evidencias?.length >
                            0 ? (
                              historyItem.evidencias.map(
                                (attachment: AttachmentMeta) =>
                                  isEvidenceAvailable(
                                    attachment,
                                  ) &&
                                  isImageAsset(attachment) ? (
                                    <button
                                      type="button"
                                      key={attachment.id}
                                      className="border rounded-2 bg-white p-0"
                                      title={
                                        attachment.filename_original
                                      }
                                      onClick={() =>
                                        onOpenEvidence(attachment)
                                      }
                                    >
                                      <img
                                        src={resolveAssetUrl(
                                          attachment.public_url,
                                        )}
                                        alt={
                                          attachment.filename_original
                                        }
                                        className="rounded-2"
                                        style={{
                                          width: 34,
                                          height: 34,
                                          objectFit: "cover",
                                        }}
                                      />
                                    </button>
                                  ) : (
                                    <Button
                                      key={attachment.id}
                                      variant={
                                        isEvidenceAvailable(
                                          attachment,
                                        )
                                          ? "link"
                                          : "outline-warning"
                                      }
                                      size="sm"
                                      className={`${isEvidenceAvailable(attachment) ? "p-0" : "py-0 px-1"} x-small text-decoration-none d-flex align-items-center gap-1 fw-bold`}
                                      onClick={() =>
                                        onOpenEvidence(attachment)
                                      }
                                    >
                                      <FileText size={13} />{" "}
                                      {attachment.filename_original ||
                                        "Ver evidencia"}
                                      {!isEvidenceAvailable(
                                        attachment,
                                      ) && (
                                        <Badge
                                          bg="warning"
                                          text="dark"
                                        >
                                          Archivo no disponible
                                        </Badge>
                                      )}
                                    </Button>
                                  ),
                              )
                            ) : (
                              <Button
                                variant="link"
                                size="sm"
                                className="p-0 x-small text-decoration-none d-flex align-items-center gap-1 fw-bold"
                                onClick={() =>
                                  onOpenEvidence(
                                    historyItem.evidenceUrl,
                                  )
                                }
                              >
                                <ImagePlus size={13} /> Ver
                                evidencia adjunta
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

              {total > 5 && (
                <div className="text-center x-small text-muted mt-2">
                  + {total - 5} ejecuciones anteriores
                </div>
              )}
            </div>
          ) : (
            <div
              className="text-muted x-small d-flex align-items-center gap-2 p-3 rounded-2"
              style={{ background: "#f8f9fa" }}
            >
              <Clock size={14} className="opacity-50" />
              <span>{t('ejecutarPruebas.noExecutionsYet')}</span>
            </div>
          )}
        </>
      );
    })()}
  </div>
  );
}
