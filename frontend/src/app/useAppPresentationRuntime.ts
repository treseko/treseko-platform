import { useCallback, useEffect } from "react";
import { API_BASE } from "./constants";
import { mapBackendUserToSession } from "./mappers";
import { stringifyFeedbackMessage } from "./errorMessages";
import { normalizeInternalReportBugLinks } from "./internalReportLinks";

export function useAppPresentationRuntime(options: any): any {
  const {
    t, isAuthenticated, internalReportToken, fetchWithAuth,
    setInternalReportLoading, setInternalReportError, setInternalReportHtml,
    setLoggedUser, setDeepLinkBugId, canAccessCapability, setActiveTab,
    setInternalReportToken, activeTab, setFeedbackModal, confirmResolverRef,
    setConfirmDialog, suiteExplorerResizeCleanupRef, suiteExplorerWidth,
    setSuiteExplorerWidth,
  } = options;

  useEffect(() => {
    if (!isAuthenticated || !internalReportToken) return;
    let cancelled = false;
    setInternalReportLoading(true);
    setInternalReportError("");
    fetchWithAuth(`${API_BASE}/reports/internal/${encodeURIComponent(internalReportToken)}`)
      .then(async (response: Response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.text();
      })
      .then((html: string) => {
        if (cancelled) return;
        const normalizedHtml = normalizeInternalReportBugLinks(html);
        const baseTag = `<base href="${window.location.origin}${API_BASE}/reports/internal/${encodeURIComponent(internalReportToken)}">`;
        const withBase = normalizedHtml.match(/<head[^>]*>/i)
          ? normalizedHtml.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`)
          : normalizedHtml;
        setInternalReportHtml(withBase);
      })
      .catch((error: any) => {
        if (!cancelled) setInternalReportError(error?.message || t('common.internalReportOpenError'));
      })
      .finally(() => {
        if (!cancelled) setInternalReportLoading(false);
      });
    return () => { cancelled = true; };
  }, [isAuthenticated, internalReportToken, fetchWithAuth]);

  const handleLoggedUserUpdated = (backendUser: any) => {
    const mapped = mapBackendUserToSession(backendUser);
    setLoggedUser(mapped);
    localStorage.setItem("qa_session_user", JSON.stringify(mapped));
  };
  const handleLoggedUserPreferencesUpdated = (preferences: any) => {
    setLoggedUser((prev: any) => {
      const next = { ...prev, personalTheme: preferences.personal_theme || prev.personalTheme, profileSettings: preferences.profile_settings || prev.profileSettings, projectThemeOverrides: preferences.project_theme_overrides || prev.projectThemeOverrides };
      localStorage.setItem("qa_session_user", JSON.stringify(next));
      return next;
    });
  };

  const startSuiteExplorerResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    suiteExplorerResizeCleanupRef.current?.();
    const startX = event.clientX;
    const startWidth = suiteExplorerWidth;
    const onMouseMove = (moveEvent: MouseEvent) => setSuiteExplorerWidth(Math.min(560, Math.max(260, startWidth + moveEvent.clientX - startX)));
    const cleanup = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      suiteExplorerResizeCleanupRef.current = null;
    };
    const onMouseUp = () => cleanup();
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    suiteExplorerResizeCleanupRef.current = cleanup;
  };
  useEffect(() => () => { suiteExplorerResizeCleanupRef.current?.(); }, []);

  const showFeedback = (title: string, message: string, variant: "success" | "danger" | "warning" | "info" = "info") => {
    setFeedbackModal({ show: true, title, message: stringifyFeedbackMessage(message), variant });
  };
  const consumeDeepLinkBug = useCallback(() => {
    setDeepLinkBugId("");
    const url = new URL(window.location.href);
    if (!url.searchParams.has("bug_id")) return;
    url.searchParams.delete("bug_id");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  const openBugTrackerDetail = useCallback((bug: any) => {
    const bugId = bug?.id ? String(bug.id) : "";
    if (!bugId) { showFeedback(t('common.bugTracker'), t('common.selectedBugNotIdentified'), "warning"); return; }
    if (!canAccessCapability("bugs.ver", "read")) { showFeedback(t('common.noPermission'), t('common.noBugDetailPermission'), "warning"); return; }
    setDeepLinkBugId(bugId);
    setActiveTab("bugs");
  }, [canAccessCapability]);
  const closeInternalReportViewer = () => {
    setInternalReportToken("");
    setInternalReportHtml("");
    setInternalReportError("");
    const url = new URL(window.location.href);
    url.searchParams.delete("internal_report");
    url.searchParams.set("tab", activeTab || "reportes");
    if (url.pathname.startsWith("/informes-internos/")) url.pathname = "/";
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };
  const closeConfirmDialog = useCallback((confirmed: boolean) => {
    confirmResolverRef.current?.(confirmed);
    confirmResolverRef.current = null;
    setConfirmDialog((prev: any) => ({ ...prev, show: false }));
  }, []);
  const confirmAction = useCallback((options: any) => {
    confirmResolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmDialog({ show: true, variant: options.variant || "warning", title: options.title, message: stringifyFeedbackMessage(options.message), confirmLabel: options.confirmLabel || (options.variant === "info" ? t('common.understood') : t('common.confirm')), cancelLabel: options.cancelLabel === undefined ? t('common.cancel') : options.cancelLabel });
    });
  }, []);
  return { handleLoggedUserUpdated, handleLoggedUserPreferencesUpdated, startSuiteExplorerResize, showFeedback, consumeDeepLinkBug, openBugTrackerDetail, closeInternalReportViewer, closeConfirmDialog, confirmAction };
}
