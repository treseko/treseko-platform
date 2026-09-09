import type { FormEvent } from "react";
import { renderInternalBugCaseReferences } from "./internalBugWorkflowView";
import { openConversationalBugReportForExecution, openConversationalBugReportFromCase, submitConversationalBugReport } from "./conversationalBugPreparation";
export function createInternalBugWorkflow(context: any): any {
  const { confirmResolverRef, relatedBugDecisionResolverRef, ...ctx } = context;
  const { t, selectedTest, setSelectedTest, setViewMode, currentExecutionRun, currentExecutionCase, stepResults, generalExecutionStatus, snapshotNotes = {}, executionSnapshots, snapshotAttachments, generalExecutionAttachments, generalExecutionNote, generalExecutionSnapshot, currentBuildId, currentCompId, currentProjectId, buildsList, projectsList, componentsList, currentProjectEnvironments, selectedExecutionEnvironmentId, executionDatasetPreview, loggedUser, showFeedback, fetchWithAuth, authHeaders, API_BASE, getExecutionCompletionPlan, advanceToNextTest, setCurrentExecutionCase, setExecutionMode, setActiveTab, setShowRedminePrompt, setRedmineDecisionByExecution, setInternalBugDraft, setInternalBugAdditionalContext, setInternalBugEvidence, setShowRedmineDrawer, setCreatingInternalBugContextId, setBugTrackerRefreshToken, setRelatedBugDecision, setRelatedCaseBugs, setRelatedCaseBugsLoading, setOpenBugsByCase, setOpenBugsLoading, relatedCaseBugs, relatedBugDecision, openBugsByCase, canAccessCapability, createInternalBugForExecution, findOpenBugForExecutionContext, loadOpenBugsForCase, getActiveExecutionBugEvidence, loadSnapshotBugEvidence, linkExecutionToExistingBug, getCurrentBuildFailureContext, buildInternalBugPayload, enrichBugDisplayContext, enrichBugsDisplayContext, closeRelatedBugDecision, requestRelatedBugDecision, viewRelatedBugFromDecision, backToRelatedBugDecisionList, linkBugFromDecision, readBackendError, isOpenBugState, stringifyFeedbackMessage, normalizeExecutionHistory, generateBugDescription, attachmentIds, loadCasoExecutionHistory, isFailureStatus, isExecutionHistoryItemFromBuild, uniqueAttachmentList, internalBugEvidence, internalBugDraft, internalBugAdditionalContext, setZoomImage, ...rest } = ctx;
  void confirmResolverRef; void relatedBugDecisionResolverRef; void rest;
  const loadApiExecutionEvidence = async (executionId?: string | null) => {
    if (!executionId || !fetchWithAuth) return null;
    const response = await fetchWithAuth(`${API_BASE}/api-tests/executions/${executionId}`);
    if (!response.ok) return null;
    return response.json().catch(() => null);
  };
  const advanceApiCaseAfterBugReport = (reportedTest: any) => {
    const apiExecutionResults = currentExecutionRun?.apiExecutionResults || currentExecutionRun || {};
    const apiTests = Array.isArray(apiExecutionResults?.tests)
      ? apiExecutionResults.tests
      : [];
    const currentIndex = apiTests.findIndex(
      (test: any) => String(test?.id) === String(reportedTest?.id),
    );
    const nextTest = currentIndex >= 0 ? apiTests[currentIndex + 1] : null;
    if (nextTest) {
      setSelectedTest(nextTest);
      showFeedback(
        "Bug registrado",
        "El bug quedó asociado. Continuás con la siguiente prueba API.",
        "success",
      );
    } else {
      setViewMode?.("list");
      showFeedback(
        "Bug registrado",
        "El bug quedó asociado. No quedan más pruebas API seleccionadas.",
        "success",
      );
    }
    return nextTest;
  };
  const confirmNewBugWhenCaseHasOpenBugs = async (
    test: any,
    currentContextBug?: any,
    executionOverride?: { id?: string | null; status?: string | null },
  ) => {
    const openCaseBugs = enrichBugsDisplayContext(
      (await loadOpenBugsForCase(test?.id)).filter(
        (bug: any) => bug?.id !== currentContextBug?.id,
      ),
    );
    if (openCaseBugs.length === 0) return true;
    const completionPlan = getExecutionCompletionPlan();
    const status =
      executionOverride?.status ||
      completionPlan?.finalStatus ||
      currentExecutionCase?.estado_resultado ||
      generalExecutionStatus;
    const canLink = Boolean(
      (executionOverride?.id || currentExecutionCase?.id) &&
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
    const isApiCase = String(selectedTest?.formato_prueba || selectedTest?.format || '').toUpperCase() === 'API';
    const existingBug = await findOpenBugForExecutionContext({
      executionId: currentExecutionCase?.id || null,
      snapshotId:
        conclusiveSnapshot?.id || generalExecutionSnapshot?.id || null,
      contextType: isApiCase ? 'API' : undefined,
    });
    let forceNewBug = false;
    if (existingBug) {
      const related = enrichBugsDisplayContext(await loadOpenBugsForCase(selectedTest?.id));
      const decision = await requestRelatedBugDecision(related.length > 0 ? related : [existingBug], true);
      if (decision === 'cancel') return;
      if (decision === 'linked') {
        await linkExecutionToExistingBug(existingBug, isApiCase ? 'La falla API continúa en esta ejecución.' : 'La falla continúa en esta ejecución.', undefined, isApiCase ? { executionId: currentExecutionCase?.id || null, test: selectedTest, api: true } : undefined);
        return;
      }
      forceNewBug = decision === 'create';
    }
    const confirmed = existingBug
      ? true
      : await confirmNewBugWhenCaseHasOpenBugs(selectedTest, existingBug);
    if (!confirmed) return;
    const createdBug = await createInternalBugForExecution({
      test: selectedTest,
      executionId: currentExecutionCase?.id || null,
      snapshotId:
        conclusiveSnapshot?.id || generalExecutionSnapshot?.id || null,
      snapshot: conclusiveSnapshot || generalExecutionSnapshot || null,
      note: conclusiveNote,
      payloadOverride: forceNewBug ? { metadata_json: { force_new_bug: true, report_decision: 'CREATE_DIFFERENT' } } : undefined,
      openTracker: false,
    });
    if (createdBug && isApiCase) advanceApiCaseAfterBugReport(selectedTest);
  };
  const openInternalBugReportFromPrompt = async (conversationalOptions: any = {}) => {
    const apiExecutionId = conversationalOptions.apiExecutionId || null;
    const apiTest = conversationalOptions.apiTest || null;
    const apiExecutionResult = conversationalOptions.apiExecutionResult || null;
    const activeTest = apiTest || selectedTest;
    const activeExecutionCase = apiExecutionId
      ? { ...currentExecutionCase, id: apiExecutionId, estado_resultado: apiExecutionResult?.status || apiExecutionResult?.result?.status || 'FALLO', api_resultado: apiExecutionResult?.result || {} }
      : currentExecutionCase;
    const preparationId = activeExecutionCase?.id || activeTest?.id || "preparing";
    setCreatingInternalBugContextId(preparationId);
    try {
      if (!activeTest) {
        showFeedback(
          "Bug interno",
          "No hay caso seleccionado para preparar el bug.",
          "warning",
        );
        return;
      }
      if (!apiExecutionId && await openConversationalBugReportForExecution({ currentExecutionCase: activeExecutionCase, selectedTest: activeTest, findOpenBugForExecutionContext, loadOpenBugsForCase, requestRelatedBugDecision, showFeedback, buildInternalBugPayload, loadSnapshotBugEvidence, attachmentIds, workflowContext: ctx, ...conversationalOptions })) return;
      const isApiCase = String(activeTest?.formato_prueba || activeTest?.format || '').toUpperCase() === 'API';
      const completionPlan = getExecutionCompletionPlan();
      const conclusiveSnapshot =
        isApiCase
          ? null
          : completionPlan?.firstConclusive?.snapshot ||
            generalExecutionSnapshot ||
            null;
      const conclusiveNote = conclusiveSnapshot
        ? snapshotNotes[conclusiveSnapshot.numero_paso] ||
          conclusiveSnapshot.comentarios ||
          conclusiveSnapshot.error_log ||
          null
        : generalExecutionNote || currentExecutionCase?.observaciones || null;
      const existingBug = await findOpenBugForExecutionContext({
        executionId: activeExecutionCase?.id || null,
        snapshotId:
          conclusiveSnapshot?.id || generalExecutionSnapshot?.id || null,
        contextType: isApiCase ? 'API' : undefined,
      });
      let forceNewBug = false;
      if (existingBug && !conversationalOptions.skipRelatedBugDecision) {
        const related = enrichBugsDisplayContext(await loadOpenBugsForCase(activeTest?.id));
        const decision = await requestRelatedBugDecision(related.length > 0 ? related : [existingBug], true);
        if (decision === 'cancel') return;
        if (decision === 'linked') {
          await linkExecutionToExistingBug(existingBug, 'La falla API continúa en esta ejecución.', undefined, { executionId: activeExecutionCase?.id, test: activeTest, api: true });
          return;
        }
        forceNewBug = decision === 'create';
      }
      const confirmed = existingBug
        ? true
        : await confirmNewBugWhenCaseHasOpenBugs(activeTest, existingBug, isApiCase
          ? {
              id: activeExecutionCase?.id || null,
              status: apiExecutionResult?.status || apiExecutionResult?.result?.manual_evaluation?.status || null,
            }
          : undefined);
      if (!confirmed) return;
      const apiExecutionEvidence = isApiCase
        ? (conversationalOptions.apiExecutionEvidence || await loadApiExecutionEvidence(activeExecutionCase?.id || null))
        : null;
      const draft = buildInternalBugPayload({
        test: activeTest,
        snapshot: conclusiveSnapshot,
        note: conclusiveNote,
      });
      const apiVerdict = isApiCase
        ? String(
            apiExecutionResult?.status ||
              apiExecutionResult?.result?.manual_evaluation?.status ||
              apiExecutionEvidence?.result?.manual_evaluation?.status ||
              'FALLO',
          ).toUpperCase()
        : null;
      const apiVerdictLabel = apiVerdict === 'BLOQUEADO' ? 'BLOQUEADA' : apiVerdict === 'PASO' ? 'PASÓ' : 'FALLÓ';
      const apiVerdictNote = apiExecutionResult?.result?.manual_evaluation?.notes || conclusiveNote || '';
      const preloadedEvidence = isApiCase
        ? { attachments: [], backendLinkedAttachmentIds: [] }
        : getActiveExecutionBugEvidence(conclusiveSnapshot?.id || null);
      setInternalBugDraft({
        ...draft,
        ...(isApiCase
          ? {
              titulo: `${activeTest.code || activeTest.codigo || 'Caso'} - ${activeTest.title || activeTest.titulo || 'Prueba API'}: ${apiVerdictLabel.toLowerCase()}`,
              descripcion: apiVerdictNote || draft.descripcion,
              resultado_obtenido: [`Ejecución marcada como ${apiVerdictLabel}.`, apiVerdictNote ? `Observación: ${apiVerdictNote}` : null].filter(Boolean).join('\n'),
              severidad: apiVerdict === 'BLOQUEADO' ? 'ALTA' : draft.severidad,
              criticidad: apiVerdict === 'BLOQUEADO' ? 'ALTA' : draft.criticidad,
              metadata_json: { ...(draft.metadata_json || {}), snapshot_status: apiVerdict },
            }
          : {}),
        caso_id: activeTest.id || null,
        case_code: activeTest.code || activeTest.codigo || null,
        ejecucion_id: activeExecutionCase?.id || null,
        snapshot_id: conclusiveSnapshot?.id || null,
        notas_qa: "",
        _context: {
          executionId: activeExecutionCase?.id || null,
          snapshotId: conclusiveSnapshot?.id || null,
          snapshot: conclusiveSnapshot,
          note: conclusiveNote,
          forceNewBug,
          preloadedAttachmentIds: attachmentIds(preloadedEvidence.attachments),
          backendLinkedAttachmentIds:
            preloadedEvidence.backendLinkedAttachmentIds,
          apiExecutionEvidence,
          apiResult: apiExecutionEvidence?.result || apiExecutionResult?.result || null,
          apiConfigSnapshot: apiExecutionEvidence?.config_snapshot || null,
        },
      });
      setInternalBugAdditionalContext([]);
      setInternalBugEvidence(preloadedEvidence.attachments);
      setShowRedminePrompt(false);
      setShowRedmineDrawer(true);
    } catch (error: any) {
      showFeedback(
        "No se pudo preparar el reporte",
        error?.message || "Ocurrió un error al preparar el bug interno.",
        "danger",
      );
    } finally {
      setCreatingInternalBugContextId(null);
    }
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
    if (await openConversationalBugReportFromCase({ test, context, showFeedback, buildInternalBugPayload, loadSnapshotBugEvidence, attachmentIds, workflowContext: ctx })) return null;
    const isApiCase = String(test?.formato_prueba || test?.format || '').toUpperCase() === 'API';
    const existingBug = await findOpenBugForExecutionContext({
      executionId: context.executionId,
      snapshotId: context.snapshotId,
      contextType: isApiCase ? 'API' : undefined,
    });
    let forceNewBug = false;
    if (existingBug) {
      const related = enrichBugsDisplayContext(await loadOpenBugsForCase(hydratedTest?.id));
      const decision = await requestRelatedBugDecision(related.length > 0 ? related : [existingBug], true);
      if (decision === 'cancel') return null;
      if (decision === 'linked') {
        await linkExecutionToExistingBug(existingBug, isApiCase ? 'La falla API continúa en esta ejecución.' : 'La falla continúa en esta ejecución.', undefined, isApiCase ? { executionId: context.executionId, test: hydratedTest, api: true } : undefined);
        return existingBug;
      }
      forceNewBug = decision === 'create';
    }
    const confirmed = existingBug
      ? true
      : await confirmNewBugWhenCaseHasOpenBugs(hydratedTest, existingBug);
    if (!confirmed) return null;
    const apiExecutionEvidence = isApiCase
      ? await loadApiExecutionEvidence(context.executionId || null)
      : null;
    const draft = buildInternalBugPayload({
      test: hydratedTest,
      note: context.note,
    });
    // La ruta "Preparar bug" desde el listado no pasa por la consola API,
    // por lo que el estado general del editor puede conservar SIN_CORRER de
    // una ejecución anterior. Para API, la fuente de verdad es la evaluación
    // persistida dentro de api_resultado de la ejecución seleccionada.
    const apiManualEvaluation = isApiCase
      ? apiExecutionEvidence?.result?.manual_evaluation || null
      : null;
    const apiVerdict = isApiCase
      ? String(
          apiManualEvaluation?.status ||
            apiExecutionEvidence?.status ||
            context.historyItem?.status ||
            "FALLO",
        ).toUpperCase()
      : null;
    const apiVerdictLabel = apiVerdict === "BLOQUEADO"
      ? "BLOQUEADA"
      : apiVerdict === "PASO"
        ? "PASÓ"
        : "FALLÓ";
    const apiVerdictNote = isApiCase
      ? apiManualEvaluation?.notes ||
        apiExecutionEvidence?.result?.notes ||
        context.note ||
        ""
      : "";
    const preloadedEvidence = await loadSnapshotBugEvidence(
      context.snapshotId || null,
    );
    setInternalBugDraft({
      ...draft,
      ...(isApiCase
        ? {
            titulo: `${hydratedTest.code || hydratedTest.codigo || "Caso"} - ${hydratedTest.title || hydratedTest.titulo || "Prueba API"}: ${apiVerdictLabel.toLowerCase()}`,
            descripcion: apiVerdictNote || draft.descripcion,
            resultado_obtenido: [
              `Ejecución marcada como ${apiVerdictLabel}.`,
              apiVerdictNote ? `Observación: ${apiVerdictNote}` : null,
            ].filter(Boolean).join("\n"),
            severidad: apiVerdict === "BLOQUEADO" ? "ALTA" : draft.severidad,
            criticidad: apiVerdict === "BLOQUEADO" ? "ALTA" : draft.criticidad,
            metadata_json: {
              ...(draft.metadata_json || {}),
              snapshot_status: apiVerdict,
            },
          }
        : {}),
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
        note: apiVerdictNote || context.note || null,
        forceNewBug,
        preloadedAttachmentIds: attachmentIds(preloadedEvidence.attachments),
        backendLinkedAttachmentIds:
          preloadedEvidence.backendLinkedAttachmentIds,
        apiExecutionEvidence,
        apiResult: apiExecutionEvidence?.result || null,
        apiConfigSnapshot: apiExecutionEvidence?.config_snapshot || null,
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
    if (context.conversational) {
      const createdBug = await submitConversationalBugReport({ context, selectedTest, currentExecutionCase, editablePayload, additionalContext, internalBugEvidence, uniqueAttachmentList, createInternalBugForExecution });
      if (createdBug?.id && selectedTest?.id) {
        await advanceToNextTest(selectedTest.id, context.executionStatus || currentExecutionCase?.estado_resultado || 'FALLO', { preferPending: true });
      }
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
          ...(context.forceNewBug ? { force_new_bug: true, report_decision: 'CREATE_DIFFERENT' } : {}),
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
      const reportedTest = context.test || selectedTest;
      const isApiCase = String(reportedTest?.formato_prueba || reportedTest?.format || '').toUpperCase() === 'API';
      if (isApiCase) {
        advanceApiCaseAfterBugReport(reportedTest);
      } else {
        await advanceToNextTest();
      }
    }
  };
  return { confirmNewBugWhenCaseHasOpenBugs, handleCreateInternalBugFromExecution, openInternalBugReportFromPrompt, openInternalBugReportFromCase, handleCreateInternalBugFromCaseHistory: openInternalBugReportFromCase, handleInternalBugDraftChange, openManualInternalBugDrawer, createManualInternalBug, handleSubmitInternalBugReport, renderCaseReferences: (title: string, references: any[] = []) => renderInternalBugCaseReferences(title, references, setZoomImage) };
}
