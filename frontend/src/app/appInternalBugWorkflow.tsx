import type { FormEvent } from "react";
import type { AttachmentMeta } from "../EvidenceUpload";
import { CaseReferenceList } from "../features/ejecutar-pruebas/CaseReferenceList";
export function createInternalBugWorkflow(context: any): any {
  const { confirmResolverRef, relatedBugDecisionResolverRef, ...ctx } = context;
  const { t, selectedTest, currentExecutionCase, stepResults, generalExecutionStatus, snapshotNotes, executionSnapshots, snapshotAttachments, generalExecutionAttachments, generalExecutionNote, generalExecutionSnapshot, currentBuildId, currentCompId, currentProjectId, buildsList, projectsList, componentsList, currentProjectEnvironments, selectedExecutionEnvironmentId, executionDatasetPreview, loggedUser, showFeedback, fetchWithAuth, authHeaders, API_BASE, getExecutionCompletionPlan, advanceToNextTest, setCurrentExecutionCase, setExecutionMode, setActiveTab, setShowRedminePrompt, setRedmineDecisionByExecution, setInternalBugDraft, setInternalBugAdditionalContext, setInternalBugEvidence, setShowRedmineDrawer, setCreatingInternalBugContextId, setBugTrackerRefreshToken, setRelatedBugDecision, setRelatedCaseBugs, setRelatedCaseBugsLoading, setOpenBugsByCase, setOpenBugsLoading, relatedCaseBugs, relatedBugDecision, openBugsByCase, canAccessCapability, createInternalBugForExecution, findOpenBugForExecutionContext, loadOpenBugsForCase, getActiveExecutionBugEvidence, loadSnapshotBugEvidence, linkExecutionToExistingBug, getCurrentBuildFailureContext, buildInternalBugPayload, enrichBugDisplayContext, enrichBugsDisplayContext, closeRelatedBugDecision, requestRelatedBugDecision, viewRelatedBugFromDecision, backToRelatedBugDecisionList, linkBugFromDecision, readBackendError, isOpenBugState, stringifyFeedbackMessage, normalizeExecutionHistory, generateBugDescription, attachmentIds, loadCasoExecutionHistory, isFailureStatus, isExecutionHistoryItemFromBuild, uniqueAttachmentList, internalBugEvidence, internalBugDraft, internalBugAdditionalContext, setZoomImage, ...rest } = ctx;
  void confirmResolverRef; void relatedBugDecisionResolverRef; void rest;
  const confirmNewBugWhenCaseHasOpenBugs = async (
    test: any,
    currentContextBug?: any,
  ) => {
    const openCaseBugs = enrichBugsDisplayContext(
      (await loadOpenBugsForCase(test?.id)).filter(
        (bug: any) => bug?.id !== currentContextBug?.id,
      ),
    );
    if (openCaseBugs.length === 0) return true;
    const completionPlan = getExecutionCompletionPlan();
    const status =
      completionPlan?.finalStatus ||
      currentExecutionCase?.estado_resultado ||
      generalExecutionStatus;
    const canLink = Boolean(
      currentExecutionCase?.id &&
      (status === "FALLO" || status === "BLOQUEADO"),
    );
    const decision = await requestRelatedBugDecision(openCaseBugs, canLink);
    return decision === "create";
  };
  const handleCreateInternalBugFromExecution = async () => {
    const completionPlan = getExecutionCompletionPlan();
    const conclusiveSnapshot = completionPlan?.firstConclusive?.snapshot;
    const conclusiveNote = conclusiveSnapshot
      ? snapshotNotes[conclusiveSnapshot.numero_paso] ||
        conclusiveSnapshot.comentarios ||
        conclusiveSnapshot.error_log ||
        null
      : generalExecutionNote || currentExecutionCase?.observaciones || null;
    const existingBug = await findOpenBugForExecutionContext({
      executionId: currentExecutionCase?.id || null,
      snapshotId:
        conclusiveSnapshot?.id || generalExecutionSnapshot?.id || null,
    });
    if (existingBug) {
      setShowRedminePrompt(false);
      setShowRedmineDrawer(false);
      showFeedback(
        "Bug interno existente",
        `${existingBug.codigo} ya reporta esta ejecucion.`,
        "info",
      );
      return;
    }
    const confirmed = await confirmNewBugWhenCaseHasOpenBugs(
      selectedTest,
      existingBug,
    );
    if (!confirmed) return;
    await createInternalBugForExecution({
      test: selectedTest,
      executionId: currentExecutionCase?.id || null,
      snapshotId:
        conclusiveSnapshot?.id || generalExecutionSnapshot?.id || null,
      snapshot: conclusiveSnapshot || generalExecutionSnapshot || null,
      note: conclusiveNote,
      openTracker: false,
    });
  };

  const openInternalBugReportFromPrompt = async () => {
    if (!selectedTest) {
      showFeedback(
        "Bug interno",
        "No hay caso seleccionado para preparar el bug.",
        "warning",
      );
      return;
    }
    const completionPlan = getExecutionCompletionPlan();
    const conclusiveSnapshot =
      completionPlan?.firstConclusive?.snapshot ||
      generalExecutionSnapshot ||
      null;
    const conclusiveNote = conclusiveSnapshot
      ? snapshotNotes[conclusiveSnapshot.numero_paso] ||
        conclusiveSnapshot.comentarios ||
        conclusiveSnapshot.error_log ||
        null
      : generalExecutionNote || currentExecutionCase?.observaciones || null;
    const existingBug = await findOpenBugForExecutionContext({
      executionId: currentExecutionCase?.id || null,
      snapshotId:
        conclusiveSnapshot?.id || generalExecutionSnapshot?.id || null,
    });
    if (existingBug) {
      setShowRedminePrompt(false);
      setShowRedmineDrawer(false);
      showFeedback(
        "Bug interno existente",
        `${existingBug.codigo} ya reporta esta ejecucion.`,
        "info",
      );
      return;
    }
    const confirmed = await confirmNewBugWhenCaseHasOpenBugs(
      selectedTest,
      existingBug,
    );
    if (!confirmed) return;
    const draft = buildInternalBugPayload({
      test: selectedTest,
      snapshot: conclusiveSnapshot,
      note: conclusiveNote,
    });
    const preloadedEvidence = getActiveExecutionBugEvidence(
      conclusiveSnapshot?.id || null,
    );
    setInternalBugDraft({
      ...draft,
      caso_id: selectedTest.id || null,
      case_code: selectedTest.code || selectedTest.codigo || null,
      ejecucion_id: currentExecutionCase?.id || null,
      snapshot_id: conclusiveSnapshot?.id || null,
      notas_qa: "",
      _context: {
        executionId: currentExecutionCase?.id || null,
        snapshotId: conclusiveSnapshot?.id || null,
        snapshot: conclusiveSnapshot,
        note: conclusiveNote,
        preloadedAttachmentIds: attachmentIds(preloadedEvidence.attachments),
        backendLinkedAttachmentIds:
          preloadedEvidence.backendLinkedAttachmentIds,
      },
    });
    setInternalBugAdditionalContext([]);
    setInternalBugEvidence(preloadedEvidence.attachments);
    setShowRedminePrompt(false);
    setShowRedmineDrawer(true);
  };

  const openInternalBugReportFromCase = async (test: any) => {
    if (!test) {
      showFeedback(
        "Bug interno",
        "No hay caso seleccionado para preparar el bug.",
        "warning",
      );
      return null;
    }
    let context = getCurrentBuildFailureContext(test, true);
    let hydratedTest = test;
    if (!context.executionId && test.id) {
      const history = await loadCasoExecutionHistory(test.id, currentBuildId);
      const latest = history[0];
      const latestFailure =
        latest &&
        isFailureStatus(latest.status) &&
        isExecutionHistoryItemFromBuild(latest, currentBuildId)
          ? latest
          : null;
      context = {
        executionId:
          latestFailure?.executionId ||
          latestFailure?.execution_id ||
          latestFailure?.id ||
          null,
        snapshotId:
          latestFailure?.snapshotId || latestFailure?.snapshot_id || null,
        note: latestFailure?.observation || null,
        historyItem: latestFailure || null,
      };
      hydratedTest = { ...test, history };
    }
    if (!context.executionId && !context.snapshotId) {
      showFeedback(
        "Bug interno",
        "Primero ejecuta esta prueba en la build actual y guarda un resultado fallido o bloqueado.",
        "warning",
      );
      return null;
    }
    const existingBug = await findOpenBugForExecutionContext({
      executionId: context.executionId,
      snapshotId: context.snapshotId,
    });
    if (existingBug) {
      showFeedback(
        "Bug interno existente",
        `${existingBug.codigo} ya reporta esta ejecucion.`,
        "info",
      );
      return existingBug;
    }
    const confirmed = await confirmNewBugWhenCaseHasOpenBugs(
      hydratedTest,
      existingBug,
    );
    if (!confirmed) return null;
    const draft = buildInternalBugPayload({
      test: hydratedTest,
      note: context.note,
    });
    const preloadedEvidence = await loadSnapshotBugEvidence(
      context.snapshotId || null,
    );
    setInternalBugDraft({
      ...draft,
      caso_id: hydratedTest.id || null,
      case_code: hydratedTest.code || hydratedTest.codigo || null,
      ejecucion_id: context.executionId || null,
      snapshot_id: context.snapshotId || null,
      notas_qa: "",
      _context: {
        fromCaseHistory: true,
        test: hydratedTest,
        executionId: context.executionId || null,
        snapshotId: context.snapshotId || null,
        snapshot: null,
        note: context.note || null,
        preloadedAttachmentIds: attachmentIds(preloadedEvidence.attachments),
        backendLinkedAttachmentIds:
          preloadedEvidence.backendLinkedAttachmentIds,
      },
    });
    setInternalBugAdditionalContext([]);
    setInternalBugEvidence(preloadedEvidence.attachments);
    setShowRedminePrompt(false);
    setShowRedmineDrawer(true);
    return null;
  };

  const handleInternalBugDraftChange = (field: string, value: any) => {
    setInternalBugDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const openManualInternalBugDrawer = () => {
    if (!currentProjectId) {
      showFeedback(
        "Bug interno",
        "Selecciona un proyecto para crear un bug.",
        "warning",
      );
      return;
    }
    const activeProject = projectsList.find(
      (project) => project.id === currentProjectId,
    );
    const activeBuild = buildsList.find((build) => build.id === currentBuildId);
    if (!activeBuild) {
      showFeedback(
        "Build requerida",
        "Selecciona una build activa antes de crear un bug manual.",
        "warning",
      );
      return;
    }
    const activeComponent = componentsList.find(
      (component) => component.id === currentCompId,
    );
    const activeEnvironment = currentProjectEnvironments.find(
      (env) => env.id === selectedExecutionEnvironmentId,
    );
    setInternalBugDraft({
      titulo: "",
      descripcion: "",
      resultado_esperado: "",
      resultado_obtenido: "",
      pasos_reproduccion: "",
      notas_qa: "",
      severidad: "MEDIA",
      prioridad: "P2",
      criticidad: "MEDIA",
      reproducibilidad: "no_reproducido",
      asignado_a: null,
      componente_id: currentCompId || null,
      build_id: currentBuildId || null,
      version_app:
        (activeBuild as any)?.name || (activeBuild as any)?.nombre || null,
      modulo_funcional:
        (activeComponent as any)?.name ||
        (activeComponent as any)?.nombre ||
        null,
      ambiente_nombre: (activeEnvironment as any)?.name || null,
      ambiente_url:
        (activeEnvironment as any)?.url ||
        (activeEnvironment as any)?.baseUrl ||
        null,
      metadata_json: {
        project_id: currentProjectId,
        project_name:
          (activeProject as any)?.name ||
          (activeProject as any)?.nombre ||
          null,
        build_name:
          (activeBuild as any)?.name || (activeBuild as any)?.nombre || null,
        build_code:
          (activeBuild as any)?.code || (activeBuild as any)?.codigo || null,
        component_name:
          (activeComponent as any)?.name ||
          (activeComponent as any)?.nombre ||
          null,
        component_code:
          (activeComponent as any)?.code ||
          (activeComponent as any)?.codigo ||
          null,
        environment_name: (activeEnvironment as any)?.name || null,
        environment_url:
          (activeEnvironment as any)?.url ||
          (activeEnvironment as any)?.baseUrl ||
          null,
        manual_bug: true,
        executed_steps: [],
      },
      _context: {
        manual: true,
      },
    });
    setInternalBugAdditionalContext([]);
    setInternalBugEvidence([]);
    setShowRedminePrompt(false);
    setShowRedmineDrawer(true);
  };

  const createManualInternalBug = async (
    editablePayload: Record<string, any>,
    additionalContext: { key: string; value: string }[],
  ) => {
    if (!currentProjectId) {
      showFeedback(
        "Bug interno",
        "No hay proyecto seleccionado para crear el bug.",
        "warning",
      );
      return null;
    }
    setCreatingInternalBugContextId("manual-bug");
    try {
      const response = await fetchWithAuth(`${API_BASE}/bugs/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editablePayload,
          proyecto_id: currentProjectId,
          componente_id: editablePayload.componente_id || currentCompId || null,
          build_id: editablePayload.build_id || currentBuildId || null,
          caso_id: editablePayload.caso_id || null,
          asignado_a: editablePayload.asignado_a || null,
          origen: "manual",
          metadata_json: {
            ...(editablePayload.metadata_json || {}),
            additional_context: additionalContext,
          },
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
      for (const attachment of uniqueAttachmentList(internalBugEvidence)) {
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
      setShowRedmineDrawer(false);
      setInternalBugDraft(null);
      setInternalBugEvidence([]);
      setInternalBugAdditionalContext([]);
      setBugTrackerRefreshToken((value) => value + 1);
      setActiveTab("bugs");
      showFeedback(
        "Bug interno creado",
        `${bug.codigo} quedo registrado en el Bug Tracker.`,
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

  const handleSubmitInternalBugReport = async (event: FormEvent) => {
    event.preventDefault();
    if (!internalBugDraft) {
      showFeedback(
        "Bug interno",
        "No hay datos preparados para crear el bug.",
        "warning",
      );
      return;
    }
    const context = internalBugDraft._context || {};
    const { _context, ...editablePayload } = internalBugDraft;
    const additionalContext = internalBugAdditionalContext
      .map((row) => ({ key: row.key.trim(), value: row.value.trim() }))
      .filter((row) => row.key || row.value);
    if (context.manual) {
      await createManualInternalBug(editablePayload, additionalContext);
      return;
    }
    const backendLinkedAttachmentIds = new Set<string>(
      (context.backendLinkedAttachmentIds || []).map((id: any) => String(id)),
    );
    const selectedAttachmentIds = new Set<string>(
      internalBugEvidence.map((item) => String(item?.id || "")).filter(Boolean),
    );
    const removedBackendLinkedAttachmentIds = Array.from(
      backendLinkedAttachmentIds,
    ).filter((id) => !selectedAttachmentIds.has(id));
    const extraEvidenceAttachments = uniqueAttachmentList(
      internalBugEvidence,
    ).filter(
      (attachment) => !backendLinkedAttachmentIds.has(String(attachment.id)),
    );
    const createdBug = await createInternalBugForExecution({
      test: context.test || selectedTest,
      executionId: context.executionId || currentExecutionCase?.id || null,
      snapshotId: context.snapshotId || null,
      snapshot: context.snapshot || null,
      note: context.note || editablePayload.notas_qa || null,
      payloadOverride: {
        ...editablePayload,
        asignado_a: editablePayload.asignado_a || null,
        metadata_json: {
          ...(editablePayload.metadata_json || {}),
          additional_context: additionalContext,
        },
      },
      evidenceAttachments: extraEvidenceAttachments,
      openTracker: false,
    });
    if (createdBug?.id && removedBackendLinkedAttachmentIds.length > 0) {
      try {
        await Promise.all(
          removedBackendLinkedAttachmentIds.map(async (attachmentId) => {
            const response = await fetchWithAuth(
              `${API_BASE}/bugs/${createdBug.id}/attachments/${attachmentId}/`,
              { method: "DELETE" },
            );
            if (!response.ok && response.status !== 404) {
              throw new Error(
                await readBackendError(
                  response,
                  `No se pudo quitar la evidencia ${attachmentId}`,
                ),
              );
            }
          }),
        );
      } catch (error: any) {
        showFeedback(
          "Evidencias del bug",
          error?.message ||
            "El bug fue creado, pero no se pudo quitar una evidencia removida del formulario.",
          "warning",
        );
      }
    }
    if (
      createdBug &&
      !context.fromCaseHistory &&
      !context.manual &&
      currentExecutionCase?.id
    ) {
      await advanceToNextTest();
    }
  };

  const handleCreateInternalBugFromCaseHistory = async (test: any) => {
    return openInternalBugReportFromCase(test);
  };

  const renderCaseReferences = (
    title: string,
    references: AttachmentMeta[] = [],
  ) => (
    <CaseReferenceList
      title={title}
      references={references}
      onZoomImage={setZoomImage}
    />
  );
  return { confirmNewBugWhenCaseHasOpenBugs, handleCreateInternalBugFromExecution, openInternalBugReportFromPrompt, openInternalBugReportFromCase, handleInternalBugDraftChange, openManualInternalBugDrawer, createManualInternalBug, handleSubmitInternalBugReport, handleCreateInternalBugFromCaseHistory, renderCaseReferences };
}
