import { useEffect, useState } from 'react'
import { API_BASE } from '../../app/constants'
import { useTraceabilityHistory } from './useTraceabilityHistory'

export function useTraceabilityViewState(options: any) {
  const {
    active, projectId, refreshToken, requirements, stories, setRequirements, setStories,
    fetchWithAuth, readJson, showFeedback, confirmAction, t, tx, loadedProjectId,
    generationBusy, generationRun, generationStep, setGenerationElapsedSeconds,
    setGenerationRun, setGenerationCandidates, hasSimilarStory,
  } = options
  const [loading, setLoading] = useState(false);
  const {
    historyEntries, historyKind, historyTitle, historyCode, historyDiff, openHistory,
    historyDisplayActor, openHistoryDiff, historyDiffRows, setHistoryEntries,
    setHistoryKind, setHistoryTitle, setHistoryCode, setHistoryDiff,
  } = useTraceabilityHistory({ t, tx, fetchWithAuth, readJson, showFeedback })
  const [requirementStateFilter, setRequirementStateFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [archiveVisibility, setArchiveVisibility] = useState<"active" | "archived" | "all">("active");
  const [storySearch, setStorySearch] = useState("");
  const [storyRequirementFilter, setStoryRequirementFilter] = useState("");
  const [storyStateFilter, setStoryStateFilter] = useState("");
  const load = async (force = false, visibility = archiveVisibility) => {
    if (!projectId || (!force && loadedProjectId.current === projectId)) return;
    if (loadedProjectId.current !== projectId) {
      setRequirements([]);
      setStories([]);
    }
    setLoading(true);
    try {
      const archiveQuery = visibility === "active" ? "" : "?include_archived=true";
      const requirementsRequest = fetchWithAuth(
        `${API_BASE}/proyectos/${projectId}/requisitos/${archiveQuery}`,
      )
        .then(readJson)
        .then(setRequirements);
      const storiesRequest = fetchWithAuth(
        `${API_BASE}/proyectos/${projectId}/historias/${archiveQuery}`,
      )
        .then(readJson)
        .then(setStories);
      const outcomes = await Promise.allSettled([
        requirementsRequest,
        storiesRequest,
      ]);
      const failure = outcomes.find(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === "rejected",
      );
      if (failure) throw failure.reason;
      loadedProjectId.current = projectId;
    } catch (error: any) {
      showFeedback(
        t('proyectos.tabRequirements'),
        error.message || tx("noRequirements"),
        "danger",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (active) void load(refreshToken > 0);
  }, [active, projectId, refreshToken]);

  useEffect(() => {
    if (!generationBusy) {
      setGenerationElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setGenerationElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [generationBusy]);

  useEffect(() => {
    if (!generationBusy || !generationRun?.id || generationStep !== "configuration") return;
    let cancelled = false;
    const refreshProgress = async () => {
      try {
        const response = await fetchWithAuth(`${API_BASE}/generaciones-historias/${generationRun.id}`);
        const run = await readJson(response);
        if (cancelled) return;
        setGenerationRun(run);
        if (Array.isArray(run.propuestas) && run.propuestas.length) {
          setGenerationCandidates((previous) => run.propuestas.map((item: any) => ({
            ...item,
            selected: previous.find((candidate) => candidate.local_id === item.local_id)?.selected
              ?? (item.quality?.testability === "PASS" && !hasSimilarStory(item)),
          })));
        }
      } catch {
        // The final generation request surfaces errors to the user. Polling is
        // best effort and must not create duplicate feedback messages.
      }
    };
    void refreshProgress();
    const timer = window.setInterval(() => void refreshProgress(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [fetchWithAuth, generationBusy, generationRun?.id, generationStep]);


  const setArchived = async (
    item: any,
    kind: "requisitos" | "historias",
    archived: boolean,
  ) => {
    const resourceLabel = kind === "requisitos" ? tx("requirementResource") : tx("storyResource");
    const confirmed = await confirmAction({
      title: tx("archiveAction", { action: archived ? tx("archiveLabel") : tx("restoreLabel"), resource: resourceLabel }),
      message: archived
        ? tx("archiveMessage", { code: item.codigo })
        : tx("restoreMessage", { code: item.codigo }),
      variant: archived ? "warning" : "info",
      confirmLabel: tx("archiveAction", { action: archived ? tx("archiveLabel") : tx("restoreLabel"), resource: resourceLabel }),
    });
    if (!confirmed) return;
    try {
      await readJson(
        await fetchWithAuth(`${API_BASE}/${kind}/${item.id}/archive`, {
          method: "POST",
          body: JSON.stringify({ archivado: archived }),
        }),
      );
      await load(true);
    } catch (error: any) {
      showFeedback(tx("saveFailed"), error.message, "danger");
    }
  };

  const changeStoryState = async (story: any, estado: string) => {
    if (estado === story.estado) return;
    try {
      const updated = await fetchWithAuth(`${API_BASE}/historias/${story.id}`, {
        method: "PATCH",
        body: JSON.stringify({ estado }),
      }).then(readJson);
      setStories((previous) => previous.map((item) => item.id === updated.id ? updated : item));
      showFeedback(tx("stateUpdated"), tx("updateStateMessage", { code: updated.codigo, state: updated.estado.replaceAll("_", " ") }), "success");
    } catch (error: any) {
      showFeedback(tx("stateUpdateFailed"), error.message || tx("tryAgain"), "danger");
    }
  };
  return {
    loading,
    setLoading,
    archiveVisibility,
    setArchiveVisibility,
    requirementStateFilter,
    setRequirementStateFilter,
    priorityFilter,
    setPriorityFilter,
    storySearch,
    setStorySearch,
    storyRequirementFilter,
    setStoryRequirementFilter,
    storyStateFilter,
    setStoryStateFilter,
    load,
    historyEntries,
    historyKind,
    historyTitle,
    historyCode,
    historyDiff,
    openHistory,
    historyDisplayActor,
    openHistoryDiff,
    historyDiffRows,
    setHistoryEntries,
    setHistoryKind,
    setHistoryTitle,
    setHistoryCode,
    setHistoryDiff,
    setArchived,
    changeStoryState,
  }
}
