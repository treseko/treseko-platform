import { useEffect } from "react";
import { API_BASE } from "./constants";
import { UPDATE_MAINTENANCE_EVENT, announceUpdateMaintenance, clearUpdateMaintenanceSignal, readUpdateMaintenanceSignal, updateMaintenanceConnectionState } from "../features/configuracion/updateMaintenance";
export function useAppMaintenanceState({ options }: { options: any }): void {
  const { fetchWithAuth, updateMaintenanceState, setUpdateMaintenanceState, t } = options;
  useEffect(() => {
    const refreshSignal = () => {
      const next = readUpdateMaintenanceSignal();
      setUpdateMaintenanceState((prev) => {
        const unchanged =
          prev.active === next.active &&
          prev.timedOut === next.timedOut &&
          prev.until === next.until &&
          prev.message === next.message &&
          prev.targetVersion === next.targetVersion &&
          prev.lastCheckedAt === next.lastCheckedAt &&
          prev.backendVersion === next.backendVersion;
        return unchanged ? prev : next;
      });
    };
    refreshSignal();
    const timer = window.setInterval(refreshSignal, 1000);
    window.addEventListener(UPDATE_MAINTENANCE_EVENT, refreshSignal);
    window.addEventListener("storage", refreshSignal);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(UPDATE_MAINTENANCE_EVENT, refreshSignal);
      window.removeEventListener("storage", refreshSignal);
    };
  }, []);

  useEffect(() => {
    if (!updateMaintenanceState.active && !updateMaintenanceState.timedOut)
      return undefined;
    let cancelled = false;

    const pollRestartState = async () => {
      const activeSignal = readUpdateMaintenanceSignal();
      if (!activeSignal.active && !activeSignal.timedOut) return;
      try {
        const statusResponse = await fetchWithAuth(
          `${API_BASE}/system/updates/status`,
        );
        const data = await statusResponse.json().catch(() => ({}));
        if (data?.status === "restarting") {
          const refreshed = announceUpdateMaintenance(
            undefined,
            data?.pending_version,
          );
          if (!cancelled) setUpdateMaintenanceState(refreshed);
          return;
        }
      } catch {
        // Backend can be temporarily unavailable while the update entrypoint restarts services.
      }

      try {
        const response = await fetchWithAuth(`${API_BASE}/system/version`);
        const versionPayload = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(versionPayload?.detail || "Backend no disponible");
        const backendVersion = String(versionPayload?.version || "");
        if (
          activeSignal.targetVersion &&
          backendVersion !== activeSignal.targetVersion
        ) {
          if (!cancelled) {
            setUpdateMaintenanceState(
              updateMaintenanceConnectionState({
                backendVersion,
                lastCheckedAt: Date.now(),
                message: `Backend respondio ${backendVersion}; esperando version ${activeSignal.targetVersion}.`,
              }),
            );
          }
          return;
        }
        clearUpdateMaintenanceSignal();
        window.location.reload();
      } catch {
        if (!cancelled) {
          setUpdateMaintenanceState(
            updateMaintenanceConnectionState({
              lastCheckedAt: Date.now(),
              message:
                t('common.backendUpdating'),
            }),
          );
        }
      }
    };

    void pollRestartState();
    const timer = window.setInterval(pollRestartState, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    fetchWithAuth,
    updateMaintenanceState.active,
    updateMaintenanceState.timedOut,
    updateMaintenanceState.until,
    updateMaintenanceState.targetVersion,
  ]);
}
