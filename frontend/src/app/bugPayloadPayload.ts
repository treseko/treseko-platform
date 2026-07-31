import { buildBugExecutionDetails } from './bugPayloadHelpers'

export const buildInternalBugPayload = ({
  context,
  test = context.selectedTest,
  snapshot = null,
  note = null,
}: any = {}) => {
  const {
    getCurrentBuildFailureContext, buildsList, currentBuildId, projectsList,
    currentProjectId, componentsList, currentCompId, currentProjectEnvironments,
    selectedExecutionEnvironmentId, executionDatasetPreview, selectedTest,
    generateBugDescription, stepResults, generalExecutionStatus, snapshotNotes,
    generalExecutionNote, executionSnapshots,
  } = context
    const historyContext = getCurrentBuildFailureContext(test);
    const historyItem = historyContext.historyItem || {};
    const activeBuild = buildsList.find((build) => build.id === currentBuildId);
    const activeProject = projectsList.find(
      (project) => project.id === currentProjectId,
    );
    const activeComponent = componentsList.find(
      (component) => component.id === currentCompId,
    );
    const activeEnvironment = currentProjectEnvironments.find(
      (env) => env.id === selectedExecutionEnvironmentId,
    );
    const buildName =
      historyItem.buildName ||
      historyItem.buildCode ||
      activeBuild?.name ||
      "N/A";
    const componentName =
      historyItem.componentName ||
      activeComponent?.name ||
      test?.suite ||
      test?.component ||
      null;
    const environmentName =
      historyItem.environmentName || activeEnvironment?.name || null;
    const environmentUrl =
      activeEnvironment?.url || activeEnvironment?.baseUrl || null;
    const datasetName =
      historyItem.datasetName ||
      executionDatasetPreview?.name ||
      executionDatasetPreview?.nombre ||
      executionDatasetPreview?.dataset_name ||
      null;
    const datasetVariables =
      executionDatasetPreview?.variables_resueltas ||
      executionDatasetPreview?.variables ||
      executionDatasetPreview?.values ||
      {};
    const hasActiveContext = Boolean(
      selectedTest?.id && test?.id === selectedTest.id,
    );
    const fullDescription = hasActiveContext
      ? generateBugDescription()
      : note || test?.description || "";
    const snapshotStatus = snapshot
      ? (hasActiveContext ? stepResults[snapshot.numero_paso] : null) ||
        snapshot.estado_paso ||
        "FALLO"
      : hasActiveContext
        ? generalExecutionStatus
        : "FALLO";
    const snapshotNote = snapshot
      ? (hasActiveContext ? snapshotNotes[snapshot.numero_paso] : "") ||
        snapshot.comentarios ||
        snapshot.error_log ||
        note ||
        ""
      : note || (hasActiveContext ? generalExecutionNote : "") || "";
    const failureSummary = snapshot
      ? `Fallo detectado en el paso ${snapshot.numero_paso}: ${snapshot.accion_congelada || "accion de validacion"}.`
      : `Fallo detectado durante la ejecucion del caso ${test?.code || test?.codigo || test?.title || "seleccionado"}.`;
    const resultObtained = snapshot
      ? [
          `Paso ${snapshot.numero_paso} marcado como ${snapshotStatus}.`,
          snapshotNote ? `Observacion: ${snapshotNote}` : null,
          snapshot.error_log ? `Error/log: ${snapshot.error_log}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      : [
          `Ejecucion marcada como ${generalExecutionStatus || "FALLO"}.`,
          snapshotNote ? `Observacion: ${snapshotNote}` : null,
        ]
          .filter(Boolean)
          .join("\n");
    const { executedSteps, reproductionSteps } = buildBugExecutionDetails({
      activeSnapshots: hasActiveContext ? executionSnapshots : [], stepResults, snapshotNotes,
      test, buildName, historyItem, snapshotStatus, snapshotNote,
    });

    return {
      titulo: `${test?.code || test?.codigo || "Caso"} - ${test?.title || test?.titulo || "Fallo QA"}: ${snapshot ? `paso ${snapshot.numero_paso} ` : ""}${String(snapshotStatus || "FALLO").toLowerCase()}`,
      descripcion: snapshotNote || failureSummary,
      resultado_esperado:
        snapshot?.resultado_esperado_congelado ||
        test?.expected ||
        test?.post ||
        "El caso debe cumplir el resultado esperado definido sin fallos ni bloqueos.",
      resultado_obtenido:
        resultObtained || "Fallo observado durante la ejecucion guardada.",
      pasos_reproduccion: reproductionSteps,
      precondiciones: test?.pre || test?.preconditions || null,
      datos_prueba:
        snapshot?.datos_resueltos ||
        snapshot?.datos_congelados ||
        historyItem.testData ||
        test?.data ||
        null,
      logs_relevantes: snapshot?.error_log || null,
      error_tecnico: snapshot?.error_log || null,
      notas_qa: snapshotNote || null,
      version_app: buildName,
      modulo_funcional: componentName,
      ambiente_nombre: environmentName,
      ambiente_url: environmentUrl,
      severidad: snapshotStatus === "BLOQUEADO" ? "ALTA" : "MEDIA",
      prioridad:
        test?.priority === "CRITICA" || test?.priority === "ALTA" ? "P1" : "P2",
      criticidad:
        test?.criticality ||
        (snapshotStatus === "BLOQUEADO" ? "ALTA" : "MEDIA"),
      metadata_json: {
        project_id: currentProjectId || null,
        project_name:
          (activeProject as any)?.name ||
          (activeProject as any)?.nombre ||
          null,
        build_name: buildName,
        build_code:
          (activeBuild as any)?.code ||
          (activeBuild as any)?.codigo ||
          historyItem.buildCode ||
          null,
        component_name: componentName,
        component_code:
          (activeComponent as any)?.code ||
          (activeComponent as any)?.codigo ||
          null,
        environment_name: environmentName,
        environment_url: environmentUrl,
        dataset_name: datasetName,
        dataset_variables: datasetVariables,
        case_version: test?.version || historyItem.caseVersion || null,
        snapshot_action: snapshot?.accion_congelada || null,
        snapshot_status: snapshotStatus,
        executed_steps: executedSteps,
      },
    };
  };
