import { useCallback } from "react";
import type { AttachmentMeta } from "../EvidenceUpload";
import { normalizeBugText } from "./bugPayloadPayload";

export function useExecutionBugController(context: any): any {
  const { useCallback: _useCallback, ...ctx } = context;
  const { loadBuildCaseExecutionStatus, currentBuildId, activeBuildCaseIds, buildCaseIds, setBuildCaseResultHistoryByBuild, currentProjectId, activeTab, setActiveTab, setExecutionBugDetailId, showFeedback, t, fetchWithAuth, authHeaders, API_BASE, loggedUser, selectedTest, currentExecutionRun, isValidUUID, getLatestFailureExecutionContext, isFailureStatus, buildInternalBugPayloadFromContext, setCreatingInternalBugContextId, setOpenBugsByCase, setOpenBugsLoading, openBugsByCase, relatedCaseBugs, setRelatedCaseBugs, setRelatedCaseBugsLoading, getStatusColor, normalizeExecutionHistory, uniqueAttachmentList, attachmentIds, setSnapshotAttachments, setSnapshotNotes, setGeneralExecutionAttachments, setGeneralExecutionNote, setGeneralExecutionStatus, setGeneralExecutionSnapshot, setShowRedminePrompt, setRedmineDecisionByExecution, setInternalBugDraft, setInternalBugAdditionalContext, setInternalBugEvidence, internalBugDraft, internalBugAdditionalContext, internalBugEvidence, canAccessCapability, setBugTrackerRefreshToken, setRelatedBugDecision, relatedBugDecision, setCurrentExecutionCase, setShowRedmineDrawer, setExecutionMode, setAutomationMonitor, aiDryRunInFlightRef, setAiDryRunRunning, setIaLogs, stringifyFeedbackMessage, buildsList, projectsList, componentsList, currentCompId, currentProjectEnvironments, selectedExecutionEnvironmentId, executionDatasetPreview, generateBugDescription, stepResults, generalExecutionStatus, snapshotNotes, generalExecutionNote, executionSnapshots, currentExecutionCase, snapshotAttachments, generalExecutionAttachments, generalExecutionSnapshot, getExecutionCompletionPlan, advanceToNextTest, relatedBugDecisionResolverRef, createExecutionDryRunActions, readBackendError, isOpenBugState, ...rest } = ctx;
  const selectedExecutionDatasetId = (ctx as any).selectedExecutionDatasetId;
  void _useCallback; void rest;
  const refreshCurrentBuildExecutionStatus = useCallback(async () => {
    if (!currentBuildId || !isValidUUID(currentBuildId)) return;
    const ids = buildCaseIds[currentBuildId]?.length
      ? buildCaseIds[currentBuildId]
      : activeBuildCaseIds;
    await loadBuildCaseExecutionStatus(currentBuildId, ids);
  }, [
    activeBuildCaseIds,
    buildCaseIds,
    currentBuildId,
    loadBuildCaseExecutionStatus,
  ]);

  const { handleRunSavedAutomatedCaseFromEditor, handleRunAiDryRunFromEditor } =
    createExecutionDryRunActions({
      currentProjectId,
      fetchWithAuth,
      setAutomationMonitor,
      aiDryRunInFlightRef,
      setAiDryRunRunning,
      setIaLogs,
      showFeedback,
      stringifyFeedbackMessage,
      t,
    });

  const getCurrentBuildFailureContext = (test: any, currentBuildOnly = false) =>
    getLatestFailureExecutionContext(test, currentBuildId, currentBuildOnly);

  const buildInternalBugPayload = (options: any = {}) => buildInternalBugPayloadFromContext({
    ...options,
    context: {
      getCurrentBuildFailureContext, buildsList, currentBuildId, projectsList,
      currentProjectId, componentsList, currentCompId, currentProjectEnvironments,
      currentExecutionRun,
      selectedExecutionEnvironmentId, executionDatasetPreview, selectedTest,
      generateBugDescription, stepResults, generalExecutionStatus, snapshotNotes,
      generalExecutionNote, executionSnapshots,
    },
  });
  const createInternalBugForExecution = async ({
    test = selectedTest,
    executionId,
    snapshotId,
    note,
    snapshot,
    openTracker = true,
    payloadOverride,
    evidenceAttachments = [],
  }: {
    test?: any;
    executionId?: string | null;
    snapshotId?: string | null;
    note?: string | null;
    snapshot?: any;
    openTracker?: boolean;
    payloadOverride?: Record<string, any> | null;
    evidenceAttachments?: AttachmentMeta[];
  } = {}) => {
    if (!currentProjectId || !test) {
      showFeedback(
        "Bug interno",
        "No hay caso o proyecto seleccionado para crear el bug.",
        "warning",
      );
      return null;
    }
    const historyContext = getCurrentBuildFailureContext(test);
    const shouldUseActiveExecution = Boolean(
      selectedTest?.id && test?.id === selectedTest.id,
    );
    const targetExecutionId =
      executionId ||
      (shouldUseActiveExecution ? currentExecutionCase?.id : null) ||
      historyContext.executionId;
    const targetSnapshotId = snapshotId || historyContext.snapshotId;
    if (!targetExecutionId && !targetSnapshotId) {
      showFeedback(
        "Bug interno",
        "No encuentro una ejecucion fallida guardada para registrar el bug.",
        "warning",
      );
      return null;
    }
    const contextId = targetSnapshotId || targetExecutionId || test.id;
    const refreshVisibleRelatedBugs = async () => {
      if (!test?.id || !selectedTest?.id || String(test.id) !== String(selectedTest.id)) return;
      const relatedResponse = await fetchWithAuth(
        `${API_BASE}/casos/${test.id}/bugs/relacionados/?include_closed=true`,
      );
      if (!relatedResponse.ok) return;
      const relatedBugs = await relatedResponse.json();
      setRelatedCaseBugs(
        Array.isArray(relatedBugs) ? enrichBugsDisplayContext(relatedBugs) : [],
      );
    };
    setCreatingInternalBugContextId(contextId);
    try {
      const lookupParams = new URLSearchParams({ limit: "20" });
      if (targetSnapshotId) lookupParams.set("snapshot_id", targetSnapshotId);
      else if (targetExecutionId)
        lookupParams.set("ejecucion_id", targetExecutionId);
      const existingResponse = await fetchWithAuth(
        `${API_BASE}/proyectos/${currentProjectId}/bugs/?${lookupParams.toString()}`,
      );
      if (existingResponse.ok) {
        const existingPayload = await existingResponse.json();
        const existingBug = Array.isArray(existingPayload?.items)
          ? existingPayload.items.find((item: any) =>
              isOpenBugState(item?.estado),
            )
          : null;
        if (existingBug) {
          await refreshVisibleRelatedBugs();
          setShowRedminePrompt(false);
          setShowRedmineDrawer(false);
          setInternalBugDraft(null);
          setInternalBugEvidence([]);
          if (targetExecutionId)
            setRedmineDecisionByExecution((prev) => ({
              ...prev,
              [targetExecutionId]: "reported",
            }));
          if (openTracker) setActiveTab("bugs");
          showFeedback(
            "Bug interno existente",
            `${existingBug.codigo} ya tiene seguimiento para esta ejecucion.`,
            "info",
          );
          return existingBug;
        }
      }
      const endpoint = targetSnapshotId
        ? `${API_BASE}/snapshots/${targetSnapshotId}/bugs/`
        : `${API_BASE}/ejecuciones/${targetExecutionId}/bugs/`;
      const bugNote = note || historyContext.note || generateBugDescription();
      const bugPayload = buildInternalBugPayload({
        test,
        snapshot,
        note: bugNote,
      });
      const finalPayload = {
        ...bugPayload,
        ...(payloadOverride || {}),
      };
      finalPayload.datos_prueba = normalizeBugText(finalPayload.datos_prueba);
      const mergedMetadata = {
        ...(bugPayload.metadata_json || {}),
        ...((payloadOverride?.metadata_json || {}) as Record<string, any>),
      };
      const response = await fetchWithAuth(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...finalPayload,
          metadata_json: mergedMetadata,
          resultado_obtenido:
            payloadOverride?.resultado_obtenido ||
            bugPayload.resultado_obtenido ||
            bugNote ||
            "Fallo observado durante la ejecucion guardada.",
          notas_qa:
            payloadOverride &&
            Object.prototype.hasOwnProperty.call(payloadOverride, "notas_qa")
              ? payloadOverride.notas_qa || null
              : bugPayload.notas_qa || bugNote || null,
        }),
      });
      if (!response.ok)
        throw new Error(
          await readBackendError(
            response,
            `Backend respondio ${response.status}`,
          ),
        );
      const bug = await response.json();
      for (const attachment of uniqueAttachmentList(evidenceAttachments)) {
        if (!attachment?.id) continue;
        await fetchWithAuth(`${API_BASE}/bugs/${bug.id}/attachments/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attachment_id: attachment.id,
            tipo: "BUG_EVIDENCE",
          }),
        });
      }
      setShowRedminePrompt(false);
      setShowRedmineDrawer(false);
      setInternalBugDraft(null);
      setInternalBugEvidence([]);
      if (targetExecutionId)
        setRedmineDecisionByExecution((prev) => ({
          ...prev,
          [targetExecutionId]: "reported",
        }));
      await refreshVisibleRelatedBugs();
      setBugTrackerRefreshToken((value) => value + 1);
      if (openTracker) setActiveTab("bugs");
      showFeedback(
        "Bug interno creado",
        `${bug.codigo} quedo asociado a la ejecucion fallida.`,
        "success",
      );
      return bug;
    } catch (error: any) {
      showFeedback(
        "Bug interno",
        error?.message || "No se pudo crear el bug.",
        "danger",
      );
      return null;
    } finally {
      setCreatingInternalBugContextId(null);
    }
  };

  const findOpenBugForExecutionContext = async ({
    executionId,
    snapshotId,
  }: {
    executionId?: string | null;
    snapshotId?: string | null;
  }) => {
    if (!currentProjectId || (!executionId && !snapshotId)) return null;
    const lookupParams = new URLSearchParams({ limit: "20" });
    if (snapshotId) lookupParams.set("snapshot_id", snapshotId);
    else if (executionId) lookupParams.set("ejecucion_id", executionId);
    const response = await fetchWithAuth(
      `${API_BASE}/proyectos/${currentProjectId}/bugs/?${lookupParams.toString()}`,
    );
    if (!response.ok) return null;
    const payload = await response.json();
    return Array.isArray(payload?.items)
      ? payload.items.find((item: any) => isOpenBugState(item?.estado)) || null
      : null;
  };

  const loadOpenBugsForCase = async (caseId?: string | null) => {
    if (!currentProjectId || !caseId) return [];
    const response = await fetchWithAuth(
      `${API_BASE}/casos/${caseId}/bugs/relacionados/?include_closed=false`,
    );
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload)
      ? payload.filter((item: any) => isOpenBugState(item?.estado))
      : [];
  };

  const getActiveExecutionBugEvidence = (snapshotId?: string | null) => {
    const snapshotEvidence = snapshotId
      ? uniqueAttachmentList(snapshotAttachments[snapshotId] || [])
      : [];
    if (snapshotEvidence.length > 0) {
      return {
        attachments: snapshotEvidence,
        backendLinkedAttachmentIds: attachmentIds(snapshotEvidence),
      };
    }
    const generalEvidence = uniqueAttachmentList(generalExecutionAttachments);
    return {
      attachments: generalEvidence,
      backendLinkedAttachmentIds: [],
    };
  };

  const loadSnapshotBugEvidence = async (snapshotId?: string | null) => {
    if (!snapshotId)
      return {
        attachments: [] as AttachmentMeta[],
        backendLinkedAttachmentIds: [] as string[],
      };
    const response = await fetchWithAuth(
      `${API_BASE}/snapshots/${snapshotId}/attachments/`,
    );
    if (!response.ok)
      return {
        attachments: [] as AttachmentMeta[],
        backendLinkedAttachmentIds: [] as string[],
      };
    const payload = await response.json().catch(() => []);
    const attachments = uniqueAttachmentList(
      (Array.isArray(payload) ? payload : [])
        .map((item: any) => item?.attachment || item)
        .filter(Boolean),
    );
    return {
      attachments,
      backendLinkedAttachmentIds: attachmentIds(attachments),
    };
  };

  const linkExecutionToExistingBug = async (bug: any, comentario?: string) => {
    if (!bug?.id || !currentExecutionCase?.id) {
      showFeedback(
        "Actualizar seguimiento",
        t('common.noActiveBugExecution'),
        "warning",
      );
      return null;
    }
    const completionPlan = getExecutionCompletionPlan();
    const conclusiveSnapshot =
      completionPlan?.firstConclusive?.snapshot ||
      generalExecutionSnapshot ||
      null;
    const snapshotId = conclusiveSnapshot?.id || null;
    const evidenceAttachments = snapshotId
      ? snapshotAttachments[snapshotId] || []
      : generalExecutionAttachments;
    const linkedAttachmentIds = attachmentIds(evidenceAttachments);
    setCreatingInternalBugContextId(snapshotId || currentExecutionCase.id);
    try {
      const response = await fetchWithAuth(
        `${API_BASE}/bugs/${bug.id}/link-execution/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ejecucion_id: currentExecutionCase.id,
            snapshot_id: snapshotId,
            attachment_ids: linkedAttachmentIds,
            comentario: comentario?.trim() || null,
          }),
        },
      );
      if (!response.ok)
        throw new Error(
          await readBackendError(
            response,
            `Backend respondio ${response.status}`,
          ),
        );
      const updatedBug = await response.json();
      setShowRedminePrompt(false);
      setShowRedmineDrawer(false);
      setInternalBugDraft(null);
      setInternalBugEvidence([]);
      setInternalBugAdditionalContext([]);
      setRedmineDecisionByExecution((prev) => ({
        ...prev,
        [currentExecutionCase.id]: "reported",
      }));
      setBugTrackerRefreshToken((value) => value + 1);
      const enrichedBug = enrichBugDisplayContext(updatedBug);
      setRelatedCaseBugs((prev) =>
        prev.map((item) => (item.id === updatedBug.id ? enrichedBug : item)),
      );
      if (selectedTest?.id) {
        setOpenBugsByCase((prev) => {
          const current = prev[selectedTest.id] || [];
          const alreadyPresent = current.some(
            (item: any) => String(item?.id) === String(enrichedBug?.id),
          );
          return {
            ...prev,
            [selectedTest.id]: alreadyPresent
              ? current.map((item: any) =>
                  String(item?.id) === String(enrichedBug?.id)
                    ? enrichedBug
                    : item,
                )
              : [enrichedBug, ...current],
          };
        });
      }
      showFeedback(
        "Bug actualizado",
        `${updatedBug.codigo || bug.codigo} actualizado con esta build.`,
        "success",
      );
      try {
        await advanceToNextTest();
      } catch (advanceError: any) {
        showFeedback(
          "Bug actualizado",
          advanceError?.message ||
            t('common.bugUpdatedExecutionNotClosed'),
          "warning",
        );
      }
      return enrichedBug;
    } catch (error: any) {
      showFeedback(
        "Actualizar seguimiento",
        error?.message || "No se pudo registrar el seguimiento del bug.",
        "danger",
      );
      return null;
    } finally {
      setCreatingInternalBugContextId(null);
    }
  };

  const enrichBugDisplayContext = useCallback(
    (bug: any) => {
      const build = buildsList.find(
        (item) => String(item.id) === String(bug?.build_id || ""),
      );
      const component = componentsList.find(
        (item) => String(item.id) === String(bug?.componente_id || ""),
      );
      const metadata = bug?.metadata_json || {};
      return {
        ...bug,
        _display_build_name:
          bug?.version_app ||
          metadata.build_name ||
          build?.name ||
          (build as any)?.nombre ||
          bug?.build_code ||
          metadata.build_code ||
          "Build origen no registrada",
        _display_component_name:
          bug?.modulo_funcional ||
          metadata.component_name ||
          component?.name ||
          (component as any)?.nombre ||
          "Componente no registrado",
      };
    },
    [buildsList, componentsList],
  );

  const enrichBugsDisplayContext = useCallback(
    (bugs: any[]) => bugs.map(enrichBugDisplayContext),
    [enrichBugDisplayContext],
  );

  const closeRelatedBugDecision = useCallback(
    (result: "create" | "cancel" = "cancel") => {
      relatedBugDecisionResolverRef.current?.(result);
      relatedBugDecisionResolverRef.current = null;
      setRelatedBugDecision((prev: any) => ({
        ...prev,
        show: false,
        viewingBug: null,
        linkingBugId: null,
      }));
    },
    [],
  );

  const requestRelatedBugDecision = useCallback(
    (bugs: any[], canLink: boolean) =>
      new Promise<"create" | "cancel">((resolve) => {
        relatedBugDecisionResolverRef.current = resolve;
        setRelatedBugDecision({
          show: true,
          bugs,
          viewingBug: null,
          linkingBugId: null,
          canLink,
        });
      }),
    [],
  );

  const viewRelatedBugFromDecision = useCallback((bug: any) => {
    setRelatedBugDecision((prev: any) => ({ ...prev, viewingBug: bug }));
  }, []);

  const backToRelatedBugDecisionList = useCallback(() => {
    setRelatedBugDecision((prev: any) => ({ ...prev, viewingBug: null }));
  }, []);

  const linkBugFromDecision = useCallback(
    async (bug: any) => {
      setRelatedBugDecision((prev: any) => ({
        ...prev,
        linkingBugId: bug?.id || null,
      }));
      const updated = await linkExecutionToExistingBug(
        bug,
        "El defecto sigue ocurriendo en esta build. Se registra como seguimiento del mismo bug.",
      );
      if (updated) {
        closeRelatedBugDecision("cancel");
        return;
      }
      setRelatedBugDecision((prev: any) => ({ ...prev, linkingBugId: null }));
    },
    [closeRelatedBugDecision, linkExecutionToExistingBug],
  );

  return { refreshCurrentBuildExecutionStatus, handleRunSavedAutomatedCaseFromEditor, handleRunAiDryRunFromEditor, getCurrentBuildFailureContext, buildInternalBugPayload, createInternalBugForExecution, findOpenBugForExecutionContext, loadOpenBugsForCase, getActiveExecutionBugEvidence, loadSnapshotBugEvidence, linkExecutionToExistingBug, enrichBugDisplayContext, enrichBugsDisplayContext, closeRelatedBugDecision, requestRelatedBugDecision, viewRelatedBugFromDecision, backToRelatedBugDecisionList, linkBugFromDecision };
}
import { createExecutionDryRunActions } from "../features/ejecucion/dryRunActions";
