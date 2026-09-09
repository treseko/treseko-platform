import { Badge, Button } from "react-bootstrap";
import { Clock, FileText, History, ImagePlus, User } from "lucide-react";
import type { AttachmentMeta } from "../../EvidenceUpload";
import { isImageAsset, resolveAssetUrl } from "../../shared/utils/assets";
import { isEvidenceAvailable } from "../../shared/utils/evidenceAvailability";
import { getExecutionHistoryStats, getStatusColor, normalizeExecutionHistory } from "../ejecucion/executionUtils";
import { executionStatusLabel } from './executionPresentation';

const VISIBLE_HISTORY_LIMIT = 5;

function getLocalizedHistoryStatus(status: unknown, t: (key: any) => string) {
  return executionStatusLabel(status, t);
}

export function ExecutionHistoryPanel({ options }: { options: any }) {
  const { selectedTest, t, onOpenRunHistory, onOpenEvidence } = options;
  return (
  <div className="p-3 border-bottom">
    {(() => {
      const executionHistory =
        normalizeExecutionHistory(selectedTest);
      const computedStats = getExecutionHistoryStats(executionHistory);
      const persistedStats = selectedTest?.historyStats || {};
      const total = Number(selectedTest?.historyTotal || persistedStats.total || computedStats.total);
      const passed = Number(persistedStats.passed ?? computedStats.passed);
      const failed = Number(persistedStats.failed ?? computedStats.failed);
      const blocked = Number(persistedStats.blocked ?? 0);
      const successRate = total > 0 ? Math.round((passed / total) * 100) : 0;
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
                {total} {t('ejecutarPruebas.executions')}
              </Badge>
            )}
          </div>

          {total > 0 && (
            <div className="d-flex flex-wrap gap-2 mb-3">
              <div
                className="flex-grow-1 p-2 rounded-2 text-center"
                style={{
                  background: "var(--app-status-success-bg)",
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
                  background: "var(--app-status-neutral-bg)",
                  fontSize: "var(--app-font-size-meta)",
                }}
              >
                <div className="fw-bold text-dark">{total}</div>
                <div className="text-muted x-small">{t('ejecutarPruebas.total')}</div>
              </div>
              <div
                className="flex-grow-1 p-2 rounded-2 text-center"
                style={{
                  background: "var(--app-status-success-bg)",
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
                  background: failed > 0
                    ? "var(--app-status-danger-bg)"
                    : "var(--app-status-neutral-bg)",
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
                <div className="text-muted x-small">{t('ejecutarPruebas.failed')}</div>
              </div>
              <div
                className="flex-grow-1 p-2 rounded-2 text-center"
                style={{
                  background: blocked > 0
                    ? "var(--app-status-info-bg)"
                    : "var(--app-status-neutral-bg)",
                  fontSize: "var(--app-font-size-meta)",
                }}
              >
                <div className={blocked > 0 ? "fw-bold text-primary" : "fw-bold text-muted"}>
                  {blocked}
                </div>
                <div className="text-muted x-small">{t('ejecutarPruebas.blockedPlural')}</div>
              </div>
            </div>
          )}

          {total > 0 ? (
            <div className="d-flex flex-column gap-2">
              {executionHistory
                .slice(0, VISIBLE_HISTORY_LIMIT)
                .map((historyItem: any, index: number) => {
                  const statusColor =
                    historyItem.status === "PASO" ||
                    historyItem.status === "OK"
                      ? "var(--app-success)"
                      : historyItem.status === "FALLO" ||
                          historyItem.status === "FALLIDO"
                        ? "var(--app-danger)"
                        : historyItem.status === "BLOQUEADO"
                          ? "var(--app-primary)"
                          : "var(--app-muted)";
                  return (
                    <div
                      key={`${historyItem.date || "hist"}-${index}`}
                      className="d-flex align-items-start gap-2 p-2 rounded-2"
                      style={{
                        background: "var(--app-status-neutral-bg)",
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
                              {getLocalizedHistoryStatus(historyItem.status, t)}
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
                            {t('ejecutarPruebas.observationLabel')}:
                          </span>{" "}
                          {historyItem.observation ||
                            t('ejecutarPruebas.noObservations')}
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
                            {t('ejecutarPruebas.viewExecution')}
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
                                      aria-label={t('ejecutarPruebas.viewEvidenceFile', {
                                        filename: attachment.filename_original || t('ejecutarPruebas.attachedEvidence'),
                                      })}
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
                                        t('ejecutarPruebas.viewEvidence')}
                                      {!isEvidenceAvailable(
                                        attachment,
                                      ) && (
                                        <Badge
                                          bg="warning"
                                          text="dark"
                                        >
                                          {t('ejecutarPruebas.unavailableFile')}
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
                                <ImagePlus size={13} /> {t('ejecutarPruebas.attachedEvidence')}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

              {total > VISIBLE_HISTORY_LIMIT && (
                <div className="text-center x-small text-muted mt-2">
                  + {total - VISIBLE_HISTORY_LIMIT} {t('ejecutarPruebas.previousExecutions')}
                </div>
              )}
            </div>
          ) : (
            <div
              className="text-muted x-small d-flex align-items-center gap-2 p-3 rounded-2"
              style={{ background: "var(--app-status-neutral-bg)" }}
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
