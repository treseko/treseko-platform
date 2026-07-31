import { useCallback, useEffect, useMemo } from "react";
import { createAuthClient } from "../features/auth/authClient";
import { createProjectLoaders } from "../features/proyectos/projectLoaders";
import { API_BASE } from "./constants";
import { mapBackendUserToSession } from "./mappers";
import { canAccessCapability as canAccessCapabilityForUser, canAccessModule as canAccessModuleForUser } from "./rbac/permissions";
import { useAppPlatformState } from "./useAppPlatformState";

export function useAppAuthRuntime(options: any): any {
  const { t, translationRef, loggedUser, isAuthenticated, setLoggedUser, setIsAuthenticated, setLoginError, projectsSource, currentCompId, componentsList, setComponentsList, setBuildsList, setBuildCaseIds, setCurrentCompId, setNewTestComponent, setCurrentBuildId, setProjectSyncMessage, setLoginLoading, setActiveTab } = options;
  const authClient = useMemo(() => createAuthClient({ setLoggedUser, setIsAuthenticated, setLoginError, t: (key: string, params: any) => translationRef.current(key, params) }), []);
  const canAccessModule = useCallback((moduleId: any, level: any = "read") => canAccessModuleForUser(loggedUser, moduleId, level), [loggedUser]);
  const canAccessCapability = useCallback((capabilityId: any, level: any = "read") => canAccessCapabilityForUser(loggedUser, capabilityId, level), [loggedUser]);
  const platform = useAppPlatformState({ isAuthenticated, loggedUser, fetchWithAuth: authClient.fetchWithAuth, t });
  const loaders = createProjectLoaders({ projectsSource, currentCompId, componentsList, fetchWithAuth: authClient.fetchWithAuth, setComponentsList, setBuildsList, setBuildCaseIds, setCurrentCompId, setNewTestComponent, setCurrentBuildId, setProjectSyncMessage });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const exchangeCode = params.get("ad_exchange_code");
    if (!exchangeCode || isAuthenticated) return;
    setLoginLoading(true);
    fetch(`${API_BASE}/auth/ad/exchange/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: exchangeCode }) })
      .then(async (response) => { if (!response.ok) throw new Error(await response.text()); return response.json(); })
      .then(async (tokenPayload) => {
        localStorage.setItem("qa_access_token", tokenPayload.access_token);
        try { const payload = JSON.parse(atob(String(tokenPayload.access_token || "").split(".")[1] || "")); const exp = Number(payload.exp || 0); if (exp > 0) localStorage.setItem("qa_session_expires_at", new Date(exp * 1000).toISOString()); } catch { localStorage.removeItem("qa_session_expires_at"); }
        const userResponse = await fetch(`${API_BASE}/users/me/`, { headers: { Authorization: `Bearer ${tokenPayload.access_token}` } });
        if (!userResponse.ok) throw new Error("No se pudo sincronizar el usuario AD.");
        authClient.persistSession(mapBackendUserToSession(await userResponse.json()));
        window.history.replaceState({}, document.title, window.location.pathname);
        setActiveTab("dashboard");
      }).catch(() => setLoginError("No se pudo completar el login con Active Directory.")).finally(() => setLoginLoading(false));
  }, [isAuthenticated, authClient.persistSession]);
  return { ...authClient, ...platform, ...loaders, canAccessModule, canAccessCapability };
}
