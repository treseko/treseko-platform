import { useEffect, useRef, useState } from 'react'
import { IS_DEV_ENV, DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD } from './constants'
import { createSessionUser } from './mappers'
import type { AuthMode, SessionUser } from './types'
import { readInternalReportTokenFromLocation, readStoredAuthentication } from './runtime/appEntryPresentation'

export function useAppSessionState({ setLocale }: { setLocale: (locale: 'es' | 'en') => void }) {
  const [isAuthenticated, setIsAuthenticated] = useState(readStoredAuthentication);
  const [authMode, setAuthMode] = useState<AuthMode>("local");
  const [loginForm, setLoginForm] = useState({
    email: IS_DEV_ENV ? DEV_ADMIN_EMAIL : "",
    password: IS_DEV_ENV ? DEV_ADMIN_PASSWORD : "",
    domain: "enterprise.local",
  });
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loggedUser, setLoggedUser] = useState<SessionUser>(() => {
    const saved = localStorage.getItem("qa_session_user");
    if (saved) {
      try {
        return JSON.parse(saved) as SessionUser;
      } catch {
        localStorage.removeItem("qa_session_user");
      }
    }
    return createSessionUser(IS_DEV_ENV ? DEV_ADMIN_EMAIL : "");
  });

  useEffect(() => {
    const language = loggedUser.profileSettings?.language;
    if (language === "es" || language === "en") setLocale(language);
  }, [loggedUser.id, loggedUser.profileSettings?.language, setLocale]);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [deepLinkBugId, setDeepLinkBugId] = useState(
    () => new URLSearchParams(window.location.search).get("bug_id") || "",
  );
  const [internalReportToken, setInternalReportToken] = useState(() =>
    readInternalReportTokenFromLocation(),
  );
  const [internalReportHtml, setInternalReportHtml] = useState("");
  const [internalReportLoading, setInternalReportLoading] = useState(false);
  const [internalReportError, setInternalReportError] = useState("");
  const initialBackendLoadKeyRef = useRef("");
  const organizationMembersLoadKeyRef = useRef("");
  const loadCasosFromBackendRef = useRef<
    null | ((projectId: string, componentsSnapshot?: any[]) => Promise<void>)
  >(null);
  const workspacePreferencesHydratedRef = useRef("");
  const workspaceNavigationInitializedRef = useRef(false);
  const workspaceNavigationPathRef = useRef("");
  const deepLinkPermissionNoticeRef = useRef("");
  const [workspacePreferencesHydrated, setWorkspacePreferencesHydrated] =
    useState(false);

  return {
    isAuthenticated,
    setIsAuthenticated,
    authMode,
    setAuthMode,
    loginForm,
    setLoginForm,
    loginError,
    setLoginError,
    loginLoading,
    setLoginLoading,
    loggedUser,
    setLoggedUser,
    activeTab,
    setActiveTab,
    deepLinkBugId,
    setDeepLinkBugId,
    internalReportToken,
    setInternalReportToken,
    internalReportHtml,
    setInternalReportHtml,
    internalReportLoading,
    setInternalReportLoading,
    internalReportError,
    setInternalReportError,
    initialBackendLoadKeyRef,
    organizationMembersLoadKeyRef,
    loadCasosFromBackendRef,
    workspacePreferencesHydratedRef,
    workspaceNavigationInitializedRef,
    workspaceNavigationPathRef,
    deepLinkPermissionNoticeRef,
    workspacePreferencesHydrated,
    setWorkspacePreferencesHydrated,
  }
}
