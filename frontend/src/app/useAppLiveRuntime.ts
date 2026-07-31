import { useCallback, useEffect } from "react";
import { API_BASE } from "./constants";
import { useAppRealtime } from "./useAppRealtime";
export function useAppLiveRuntime({ options }: { options: any }) {
  const { activeBuildCaseIds,activeTab,bugTrackerRefreshToken,buildCaseIds,canAccessCapability,currentBuildId,currentCompId,currentProjectId,enrichBugDisplayContext,enrichBugsDisplayContext,environmentActions,fetchWithAuth,filteredTests,hasSystemFeature,hasUnsavedCaseChanges,historialInitialFilters,isAuthenticated,isOpenBugState,isValidUUID,lastRelatedCaseIdRef,loadBuildCaseExecutionStatus,loadBuildCases,loadProjectMetrics,loadProjectRunHistory,loggedUser,projectInnerTab,projectsSource,refreshCurrentTestContext,runHistory,selectedTest,setBugTrackerRefreshToken,setOpenBugsByCase,setOpenBugsLoading,setProjectSyncMessage,setRelatedCaseBugs,setRelatedCaseBugsLoading,setTraceabilityRefreshToken,viewMode } = options;
  const loadOpenBugsByCase = useCallback(
    async (options?: { silent?: boolean }) => {
      if (
        !isAuthenticated ||
        !currentProjectId ||
        !isValidUUID(currentProjectId) ||
        !canAccessCapability("bugs.ver", "read")
      ) {
        setOpenBugsByCase({});
        setOpenBugsLoading(false);
        return;
      }
      const silent = Boolean(options?.silent);
      if (!silent) setOpenBugsLoading(true);
      try {
        let skip = 0;
        const limit = 200;
        let total = 0;
        const bugs: any[] = [];
        do {
          const params = new URLSearchParams({
            skip: String(skip),
            limit: String(limit),
          });
          const response = await fetchWithAuth(
            `${API_BASE}/proyectos/${currentProjectId}/bugs/?${params.toString()}`,
          );
          if (!response.ok)
            throw new Error(`Backend respondio ${response.status}`);
          const payload = await response.json();
          const items = Array.isArray(payload?.items) ? payload.items : [];
          total = Number(payload?.total ?? items.length);
          bugs.push(...items);
          skip += items.length;
          if (items.length === 0) break;
        } while (skip < total);
        const grouped = bugs
          .filter((bug: any) => bug?.caso_id && isOpenBugState(bug.estado))
          .reduce((acc: Record<string, any[]>, bug: any) => {
            const caseId = String(bug.caso_id);
            acc[caseId] = [
              ...(acc[caseId] || []),
              enrichBugDisplayContext(bug),
            ];
            return acc;
          }, {});
        const executionCases =
          activeTab === "ejecutar"
            ? filteredTests.filter(
                (test: any) => test?.id && isValidUUID(test.id),
              )
            : [];
        if (executionCases.length > 0) {
          const relatedEntries = await Promise.all(
            executionCases.map(async (test: any) => {
              const response = await fetchWithAuth(
                `${API_BASE}/casos/${test.id}/bugs/relacionados/?include_closed=false`,
              );
              if (!response.ok)
                return [test.id, grouped[test.id] || []] as const;
              const payload = await response.json();
              const related = Array.isArray(payload)
                ? payload
                    .filter((bug: any) => isOpenBugState(bug?.estado))
                    .map(enrichBugDisplayContext)
                : [];
              return [test.id, related] as const;
            }),
          );
          for (const [caseId, related] of relatedEntries) {
            grouped[caseId] = related;
          }
        }
        setOpenBugsByCase(grouped);
      } catch {
        setOpenBugsByCase({});
      } finally {
        if (!silent) setOpenBugsLoading(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [
      isAuthenticated,
      currentProjectId,
      bugTrackerRefreshToken,
      loggedUser,
      hasSystemFeature,
    ],
  );

  useEffect(() => {
    void loadOpenBugsByCase();
  }, [activeTab, loadOpenBugsByCase]);

  const loadRelatedBugsForSelectedCase = useCallback(
    async (caseId = selectedTest?.id, options?: { silent?: boolean }) => {
      if (
        !isAuthenticated ||
        !currentProjectId ||
        !caseId ||
        !isValidUUID(caseId) ||
        !canAccessCapability("bugs.ver", "read")
      ) {
        setRelatedCaseBugs([]);
        setRelatedCaseBugsLoading(false);
        return [];
      }
      const silent = Boolean(options?.silent);
      if (!silent) setRelatedCaseBugsLoading(true);
      try {
        const response = await fetchWithAuth(
          `${API_BASE}/casos/${caseId}/bugs/relacionados/?include_closed=true`,
        );
        if (!response.ok)
          throw new Error(`Backend respondio ${response.status}`);
        const bugs = await response.json();
        const items = Array.isArray(bugs) ? enrichBugsDisplayContext(bugs) : [];
        setRelatedCaseBugs(items);
        return items;
      } catch {
        setRelatedCaseBugs([]);
        return [];
      } finally {
        if (!silent) setRelatedCaseBugsLoading(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [
      isAuthenticated,
      currentProjectId,
      selectedTest?.id,
      bugTrackerRefreshToken,
      loggedUser,
      hasSystemFeature,
    ],
  );

  useEffect(() => {
    if (
      activeTab === "ejecutar" &&
      viewMode === "manual_exec" &&
      selectedTest?.id
    ) {
      const caseId = String(selectedTest.id);
      const isSameCase = lastRelatedCaseIdRef.current === caseId;
      lastRelatedCaseIdRef.current = caseId;
      void loadRelatedBugsForSelectedCase(selectedTest.id, {
        silent: isSameCase,
      });
      return;
    }
    lastRelatedCaseIdRef.current = null;
    setRelatedCaseBugs([]);
  }, [activeTab, viewMode, selectedTest?.id, loadRelatedBugsForSelectedCase]);

  const refreshExecutionLiveData = useCallback(async () => {
    if (currentBuildId && isValidUUID(currentBuildId)) {
      const ids = await loadBuildCases(currentBuildId, { silent: true });
      await loadBuildCaseExecutionStatus(
        currentBuildId,
        ids.length ? ids : buildCaseIds[currentBuildId] || activeBuildCaseIds,
        { silent: true },
      );
    }
    await loadOpenBugsByCase({ silent: true });
    if (selectedTest?.id)
      await loadRelatedBugsForSelectedCase(selectedTest.id, { silent: true });
  }, [
    activeBuildCaseIds,
    buildCaseIds,
    currentBuildId,
    loadBuildCaseExecutionStatus,
    loadBuildCases,
    loadOpenBugsByCase,
    loadRelatedBugsForSelectedCase,
    selectedTest?.id,
  ]);

  const refreshProjectBuildLiveData = useCallback(async () => {
    await refreshCurrentTestContext(currentCompId, { silent: true });
    if (currentBuildId && isValidUUID(currentBuildId)) {
      const ids = await loadBuildCases(currentBuildId, { silent: true });
      await loadBuildCaseExecutionStatus(
        currentBuildId,
        ids.length ? ids : buildCaseIds[currentBuildId] || [],
        { silent: true },
      );
    }
    await loadOpenBugsByCase({ silent: true });
  }, [
    buildCaseIds,
    currentBuildId,
    currentCompId,
    loadBuildCaseExecutionStatus,
    loadBuildCases,
    loadOpenBugsByCase,
    refreshCurrentTestContext,
  ]);

  const refreshReportesLiveData = useCallback(async () => {
    await loadProjectMetrics(undefined, { silent: true });
  }, [loadProjectMetrics]);

  const { livePollingFallbackActive } = useAppRealtime({
    isAuthenticated,
    projectsSource,
    currentProjectId,
    currentBuildId,
    currentCompId,
    activeTab,
    projectInnerTab,
    runHistory,
    hasUnsavedCaseChanges,
    historialInitialFilters,
    environmentActions,
    loadOpenBugsByCase,
    loadProjectRunHistory,
    refreshCurrentTestContext,
    refreshExecutionLiveData,
    refreshProjectBuildLiveData,
    refreshReportesLiveData,
    setProjectSyncMessage,
    setTraceabilityRefreshToken,
    setBugTrackerRefreshToken,
  });
  return { loadOpenBugsByCase, loadRelatedBugsForSelectedCase, refreshExecutionLiveData, refreshProjectBuildLiveData, refreshReportesLiveData, livePollingFallbackActive };
}
