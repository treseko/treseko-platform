import { useEffect } from "react";
import { API_BASE } from "./constants";

export function usePublicAdConfig(isAuthenticated: boolean, setAdConfig: any): void {
  useEffect(() => {
    if (isAuthenticated) return;
    let cancelled = false;
    fetch(`${API_BASE}/auth/ad/config/public/`).then((response) => response.ok ? response.json() : null).then((payload) => { if (!cancelled && payload) setAdConfig((current: any) => ({ ...current, ...payload })); }).catch(() => {});
    return () => { cancelled = true; };
  }, [isAuthenticated, setAdConfig]);
}
