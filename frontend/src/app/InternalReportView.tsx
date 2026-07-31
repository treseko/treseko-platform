import type { TranslationKey } from "../i18n";

type InternalReportViewProps = {
  token: string;
  html: string;
  loading: boolean;
  error: string;
  onClose: () => void;
  t: (key: TranslationKey) => string;
};

export function InternalReportView({
  token,
  html,
  loading,
  error,
  onClose,
  t,
}: InternalReportViewProps) {
  return (
    <div className="vh-100 d-flex flex-column bg-light">
      <div className="d-flex align-items-center justify-content-between gap-3 border-bottom bg-white px-3 py-2">
        <div className="min-w-0">
          <div className="fw-bold text-dark">{t("common.internalReport")}</div>
          <div className="small text-muted font-monospace text-truncate">{token}</div>
        </div>
        <div className="d-flex align-items-center gap-2">
          {html && (
            <button
              type="button"
              className="btn btn-outline-primary btn-sm fw-bold"
              onClick={() => window.print()}
            >
              {t("common.print")}
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm fw-bold"
            onClick={onClose}
          >
            {t("common.backToApp")}
          </button>
        </div>
      </div>
      {loading && (
        <div className="flex-grow-1 d-flex align-items-center justify-content-center text-muted">
          {t("common.loadingInternalReport")}
        </div>
      )}
      {!loading && error && (
        <div className="flex-grow-1 d-flex align-items-center justify-content-center p-4">
          <div className="alert alert-danger shadow-sm mb-0" role="alert">
            <div className="fw-bold mb-1">{t("common.internalReportOpenError")}</div>
            <div className="small">{error}</div>
          </div>
        </div>
      )}
      {!loading && !error && html && (
        <iframe
          title={t("common.internalReport")}
          srcDoc={html}
          className="border-0 flex-grow-1 w-100 bg-white"
          sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        />
      )}
    </div>
  );
}
