import { useCallback } from "react";
import type { AttachmentMeta } from "../EvidenceUpload";
import { normalizeBugText } from "./bugPayloadPayload";
export function useExecutionBugController(context: any): any {
  const { useCallback: _useCallback, ...ctx } = context;
  const { loadBuildCaseExecutionStatus, currentBuildId, activeBuildCaseIds, buildCaseIds, setBuildCaseResultHistoryByBuild, currentProjectId, activeTab, setActiveTab, setViewMode, setSelectedTest, setExecutionBugDetailId, showFeedback, t, fetchWithAuth, authHeaders, API_BASE, loggedUser, selectedTest, currentExecutionRun, isValidUUID, getLatestFailureExecutionContext, isFailureStatus, buildInternalBugPayloadFromContext, setCreatingInternalBugContextId, setOpenBugsByCase, setOpenBugsLoading, openBugsByCase, relatedCaseBugs, setRelatedCaseBugs, setRelatedCaseBugsLoading, getStatusColor, normalizeExecutionHistory, uniqueAttachmentList, attachmentIds, setSnapshotAttachments, setSnapshotNotes, setGeneralExecutionAttachments, setGeneralExecutionNote, setGeneralExecutionStatus, setGeneralExecutionSnapshot, setShowRedminePrompt, setRedmineDecisionByExecution, setInternalBugDraft, setInternalBugAdditionalContext, setInternalBugEvidence, internalBugDraft, internalBugAdditionalContext, internalBugEvidence, canAccessCapability, setBugTrackerRefreshToken, setRelatedBugDecision, relatedBugDecision, setCurrentExecutionCase, setShowRedmineDrawer, setExecutionMode, setAutomationMonitor, aiDryRunInFlightRef, setAiDryRunRunning, setIaLogs, stringifyFeedbackMessage, buildsList, projectsList, componentsList, currentCompId, currentProjectEnvironments, selectedExecutionEnvironmentId, executionDatasetPreview, generateBugDescription, stepResults, generalExecutionStatus, snapshotNotes, generalExecutionNote, executionSnapshots, currentExecutionCase, snapshotAttachments, generalExecutionAttachments, generalExecutionSnapshot, getExecutionCompletionPlan, advanceToNextTest, relatedBugDecisionResolverRef, createExecutionDryRunActions, readBackendError, isOpenBugState, ...rest } = ctx;
  const selectedExecutionDatasetId = (ctx as any).selectedExecutionDatasetId;
  const advanceApiCase = (reportedTest: any) => {
    const tests = currentExecutionRun?.apiExecutionResults?.tests || [];
    const index = tests.findIndex((item: any) => String(item?.id) === String(reportedTest?.id));
    const next = index >= 0 ? tests[index + 1] : null;
    if (next) setSelectedTest(next);
    else setViewMode?.('list');
    return next;
  };
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
  const setDryRunMonitor = (update: any) => setAutomationMonitor((previous: any) => {
    const current = previous?.dryRun || { show: false, mode: 'dry-run', run: null, jobs: [] };
    const next = typeof update === 'function' ? update(current) : update;
    return { ...previous, dryRun: next };
  });
  const { handleRunSavedAutomatedCaseFromEditor, handleRunAiDryRunFromEditor } =
    createExecutionDryRunActions({
      currentProjectId,
      fetchWithAuth,
      setDryRunMonitor,
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
      if (!test?.id) return;
      const relatedResponse = await fetchWithAuth(
        `${API_BASE}/casos/${test.id}/bugs/relacionados/?include_closed=true`,
      );
      if (!relatedResponse.ok) return;
      const relatedBugs = await relatedResponse.json();
      const visibleBugs = Array.isArray(relatedBugs)
        ? enrichBugsDisplayContext(relatedBugs)
        : [];
      setRelatedCaseBugs(
        selectedTest?.id && String(test.id) === String(selectedTest.id)
          ? visibleBugs
          : relatedCaseBugs,
      );
      setOpenBugsByCase((prev) => ({
        ...prev,
        [test.id]: visibleBugs.filter((item: any) => isOpenBugState(item?.estado)),
      }));
    };
    const mergeBugIntoRelatedState = (rawBug: any) => {
      if (!rawBug?.id || !test?.id) return;
      const bug = enrichBugDisplayContext(rawBug);
      if (selectedTest?.id && String(test.id) === String(selectedTest.id)) {
        setRelatedCaseBugs((prev) => [
          bug,
          ...prev.filter((item: any) => String(item?.id) !== String(bug.id)),
        ]);
      }
      setOpenBugsByCase((prev) => {
        const current = prev[test.id] || [];
        return {
          ...prev,
          [test.id]: [
            bug,
            ...current.filter((item: any) => String(item?.id) !== String(bug.id)),
          ],
        };
      });
    };
    setCreatingInternalBugContextId(contextId);
    try {
      const isApiCase = String(test?.formato_prueba || test?.format || "").toUpperCase() === "API";
      const forceNewBug = isApiCase && Boolean(payloadOverride?.metadata_json?.force_new_bug);
      const lookupParams = new URLSearchParams({ limit: "20" });
      // API bugs are rooted in the execution because api_resultado and the
      // frozen API configuration live there. A SnapshotPaso is only a
      // secondary step reference and must not hide an existing execution bug.
      if (isApiCase && targetExecutionId) lookupParams.set("ejecucion_id", targetExecutionId);
      else if (targetSnapshotId) lookupParams.set("snapshot_id", targetSnapshotId);
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
        if (existingBug && !forceNewBug) {
          mergeBugIntoRelatedState(existingBug);
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
      const endpoint = targetSnapshotId && !isApiCase
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
      mergeBugIntoRelatedState(bug);
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
    chatbotTurnIndex,
    chatbotFindingType,
    contextType,
  }: {
    executionId?: string | null;
    snapshotId?: string | null;
    chatbotTurnIndex?: number | null;
    chatbotFindingType?: string | null;
    contextType?: "CLASICO" | "CONVERSACIONAL" | "API" | null;
  }) => {
    if (!currentProjectId || (!executionId && !snapshotId)) return null;
    const references = contextType === "API"
      ? [
          ...(executionId ? [{ key: "ejecucion_id", value: executionId }] : []),
          ...(snapshotId ? [{ key: "snapshot_id", value: snapshotId }] : []),
        ]
      : [
          snapshotId
            ? { key: "snapshot_id", value: snapshotId }
            : { key: "ejecucion_id", value: executionId },
        ];
    for (const reference of references) {
      const lookupParams = new URLSearchParams({ limit: "20", [reference.key]: reference.value });
      if (chatbotTurnIndex !== undefined && chatbotTurnIndex !== null) lookupParams.set("chatbot_turn_index", String(chatbotTurnIndex));
      if (chatbotFindingType) lookupParams.set("chatbot_finding_type", chatbotFindingType);
      if (contextType && contextType !== "API") lookupParams.set("tipo_contexto", contextType);
      const response = await fetchWithAuth(
        `${API_BASE}/proyectos/${currentProjectId}/bugs/?${lookupParams.toString()}`,
      );
      if (!response.ok) continue;
      const payload = await response.json();
      const existing = Array.isArray(payload?.items)
        ? payload.items.find((item: any) => isOpenBugState(item?.estado)) || null
        : null;
      if (existing) return existing;
    }
    return null;
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
  const linkExecutionToExistingBug = async (bug: any, comentario?: string, chatbotContext?: { turnIndex?: number | null; findingType?: string | null }, executionContext?: { executionId?: string | null; test?: any; api?: boolean }) => {
    const effectiveExecutionId = executionContext?.executionId || currentExecutionCase?.id;
    const effectiveTest = executionContext?.test || selectedTest;
    if (!bug?.id || !effectiveExecutionId) {
      showFeedback(
        "Actualizar seguimiento",
        t('common.noActiveBugExecution'),
        "warning",
      );
      return null;
    }
    const completionPlan = getExecutionCompletionPlan();
    const conclusiveSnapshot = executionContext?.api
      ? null
      : completionPlan?.firstConclusive?.snapshot ||
        generalExecutionSnapshot ||
        null;
    const snapshotId = conclusiveSnapshot?.id || null;
    const evidenceAttachments = executionContext?.api
      ? []
      : snapshotId
      ? snapshotAttachments[snapshotId] || []
      : generalExecutionAttachments;
    const linkedAttachmentIds = attachmentIds(evidenceAttachments);
    const storedChatbotResult = currentExecutionCase?.chatbot_resultado || {};
    const storedChatbotTurns = Array.isArray(storedChatbotResult?.turns) ? storedChatbotResult.turns : [];
    const isChatbotExecution = !executionContext?.api && (String(effectiveTest?.formato_prueba || effectiveTest?.format || "").toUpperCase() === "CONVERSACIONAL" || storedChatbotTurns.length > 0);
    const turnIndex = chatbotContext?.turnIndex ?? (isChatbotExecution && storedChatbotTurns.length > 0 ? storedChatbotTurns.length - 1 : null);
    const executionStatus = String(currentExecutionCase?.estado_resultado || "").toUpperCase();
    const findingType = chatbotContext?.findingType || (isChatbotExecution ? (executionStatus === "BLOQUEADO" ? "NO_RESPONSE" : "INVALID_RESPONSE") : null);
    setCreatingInternalBugContextId(snapshotId || effectiveExecutionId);
    try {
      const response = await fetchWithAuth(
        `${API_BASE}/bugs/${bug.id}/link-execution/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ejecucion_id: effectiveExecutionId,
            snapshot_id: snapshotId,
            chatbot_turn_index: turnIndex,
            chatbot_finding_type: findingType,
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
        [effectiveExecutionId]: "reported",
      }));
      setBugTrackerRefreshToken((value) => value + 1);
      const enrichedBug = enrichBugDisplayContext(updatedBug);
      setRelatedCaseBugs((prev) => {
        const present = prev.some((item) => String(item?.id) === String(updatedBug.id));
        return present
          ? prev.map((item) => (String(item?.id) === String(updatedBug.id) ? enrichedBug : item))
          : [enrichedBug, ...prev];
      });
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
        if (executionContext?.api) advanceApiCase(effectiveTest);
        else if (isChatbotExecution && selectedTest?.id) await advanceToNextTest(selectedTest.id, executionStatus || "FALLO", { preferPending: true }); else await advanceToNextTest();
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
    (result: "create" | "cancel" | "linked" = "cancel") => {
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
    (bugs: any[], canLink: boolean, chatbotContext?: { turnIndex?: number | null; findingType?: string | null }) =>
      new Promise<"create" | "cancel" | "linked">((resolve) => {
        relatedBugDecisionResolverRef.current = resolve;
        setRelatedBugDecision({
          show: true,
          bugs,
          viewingBug: null,
          linkingBugId: null,
          canLink,
          chatbotContext: chatbotContext || null,
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
      const isApiExecution = String(
        selectedTest?.formato_prueba || selectedTest?.format || "",
      ).toUpperCase() === "API";
      const updated = await linkExecutionToExistingBug(
        bug,
        "El defecto sigue ocurriendo en esta build. Se registra como seguimiento del mismo bug.",
        relatedBugDecision?.chatbotContext || undefined,
        isApiExecution
          ? {
              executionId: currentExecutionCase?.id || null,
              test: selectedTest,
              api: true,
            }
          : undefined,
      );
      if (updated) {
        closeRelatedBugDecision("linked");
        return;
      }
      setRelatedBugDecision((prev: any) => ({ ...prev, linkingBugId: null }));
    },
    [
      closeRelatedBugDecision,
      currentExecutionCase?.id,
      linkExecutionToExistingBug,
      relatedBugDecision,
      selectedTest,
    ],
  );
  return { refreshCurrentBuildExecutionStatus, handleRunSavedAutomatedCaseFromEditor, handleRunAiDryRunFromEditor, getCurrentBuildFailureContext, buildInternalBugPayload, createInternalBugForExecution, findOpenBugForExecutionContext, loadOpenBugsForCase, getActiveExecutionBugEvidence, loadSnapshotBugEvidence, linkExecutionToExistingBug, enrichBugDisplayContext, enrichBugsDisplayContext, closeRelatedBugDecision, requestRelatedBugDecision, viewRelatedBugFromDecision, backToRelatedBugDecisionList, linkBugFromDecision };
}
import { createExecutionDryRunActions } from "../features/ejecucion/dryRunActions";
