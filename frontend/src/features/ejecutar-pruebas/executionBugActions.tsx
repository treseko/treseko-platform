import type { Dispatch, MouseEvent, SetStateAction } from "react";
import { Badge, Button } from "react-bootstrap";
import { Bug } from "lucide-react";
import { normalizeExecutionHistory } from "../ejecucion/executionUtils";
import { getBugCriticalityPresentation, getBugSeverityPresentation } from "../bugs/bugPresentation";

export function createExecutionBugActions(context: any) {
  const { t, filteredTests, openBugsByCase, bugCaseFilter, currentBuildId, caseBugLinks, setCaseBugLinks, showFeedback, onCreateInternalBugFromCase, onOpenBugTracker, creatingInternalBugContextId, canAccessCapability } = context;
  const canCreateBugs = !canAccessCapability || canAccessCapability("bugs.crear", "edit");
  const isFailureResult = (status?: string) =>
    ["FALLO", "FALLIDO", "BLOQUEADO"].includes(
      String(status || "").toUpperCase(),
    );
  const getOpenBugsForCase = (test: any) =>
    test?.id ? openBugsByCase[test.id] || [] : [];
  const isRetestBug = (bug: any) =>
    ["LISTO_PARA_RETEST", "EN_RETEST"].includes(
      String(bug?.estado || "").toUpperCase(),
    );
  const visibleTests = filteredTests.filter((test) => {
    if (bugCaseFilter === "all") return true;
    const bugs = getOpenBugsForCase(test);
    if (bugCaseFilter === "open") return bugs.length > 0;
    return bugs.some(isRetestBug);
  });
  const openBugCaseCount = filteredTests.filter(
    (test) => getOpenBugsForCase(test).length > 0,
  ).length;
  const openBugTotal = filteredTests.reduce(
    (total, test) => total + getOpenBugsForCase(test).length,
    0,
  );
  const retestBugCaseCount = filteredTests.filter((test) =>
    getOpenBugsForCase(test).some(isRetestBug),
  ).length;
  const getBugStatusBadge = (bug: any) => {
    const state = String(bug?.estado || "").toUpperCase();
    if (isRetestBug(bug))
      return { label: "RETEST", bg: "warning", text: "dark" as const };
    if (
      [
        "RESUELTO",
        "CERRADO",
        "DUPLICADO",
        "NO_REPRODUCIBLE",
        "NO_CORRESPONDE",
      ].includes(state)
    ) {
      return { label: state || "CERRADO", bg: "secondary", text: undefined };
    }
    if (state === "BLOQUEADO")
      return { label: state, bg: "danger", text: undefined };
    if (["TRIAGE", "ASIGNADO", "EN_PROGRESO", "REABIERTO"].includes(state))
      return { label: state, bg: "primary", text: undefined };
    return { label: state || "ABIERTO", bg: "success", text: undefined };
  };
  const getBugSeverityBadge = (severity?: string) => {
    const value = String(severity || "").toUpperCase();
    const presentation = getBugSeverityPresentation(value);
    if (!value) return null;
    if (value === "CRITICA")
      return {
        label: presentation?.label || `Sev. ${value}`,
        bg: "danger",
        text: undefined,
      };
    if (value === "ALTA")
      return {
        label: presentation?.label || `Sev. ${value}`,
        bg: "warning",
        text: "dark" as const,
      };
    if (value === "MEDIA")
      return {
        label: presentation?.label || `Sev. ${value}`,
        bg: "primary",
        text: undefined,
      };
    if (value === "BAJA")
      return {
        label: presentation?.label || `Sev. ${value}`,
        bg: "secondary",
        text: undefined,
      };
    return {
      label: presentation?.label || `Sev. ${value}`,
      bg: "light",
      text: "dark" as const,
    };
  };
  const getBugCriticalityBadge = (criticality?: string) => {
    const value = String(criticality || "").toUpperCase();
    const presentation = getBugCriticalityPresentation(value);
    if (!value) return null;
    if (value === "CRITICA")
      return {
        label: presentation?.label || `Crit. ${value}`,
        bg: "danger",
        text: undefined,
      };
    if (value === "ALTA")
      return {
        label: presentation?.label || `Crit. ${value}`,
        bg: "warning",
        text: "dark" as const,
      };
    if (value === "MEDIA")
      return {
        label: presentation?.label || `Crit. ${value}`,
        bg: "light",
        text: "dark" as const,
      };
    return {
      label: presentation?.label || `Crit. ${value}`,
      bg: "secondary",
      text: undefined,
    };
  };
  const renderOpenBugBadge = (test: any) => {
    const bugs = getOpenBugsForCase(test);
    if (bugs.length === 0) return null;
    const hasRetest = bugs.some(isRetestBug);
    return (
      <Badge
        bg={hasRetest ? "warning" : "danger"}
        text={hasRetest ? "dark" : undefined}
        className="x-small d-inline-flex align-items-center gap-1"
        title={bugs
          .map((bug: any) => `${bug.codigo} · ${bug.estado}`)
          .join("\n")}
      >
        <Bug size={10} />{" "}
        {hasRetest
          ? "Retest"
          : `${bugs.length} bug${bugs.length > 1 ? "s" : ""}`}
      </Badge>
    );
  };
  const getFailureBugContextId = (test: any) => {
    const latestFailure = getCurrentBuildFailureContext(test);
    return (
      latestFailure?.snapshotId ||
      latestFailure?.snapshot_id ||
      latestFailure?.executionId ||
      latestFailure?.execution_id ||
      latestFailure?.id ||
      test.id
    );
  };
  const isBugLinkedToFailureContext = (
    bug: any,
    snapshotId: string | null,
    executionId: string | null,
  ) => {
    if (
      (snapshotId && String(bug.snapshot_id || "") === String(snapshotId)) ||
      (executionId && String(bug.ejecucion_id || "") === String(executionId))
    ) {
      return true;
    }

    // Al actualizar un bug existente no se reemplaza su vínculo de origen:
    // cada nueva aparición queda registrada en metadata_json para conservar
    // su trazabilidad histórica. La lista debe reconocer también ese vínculo.
    const occurrences =
      bug?.metadata_json?.linked_execution_occurrences ||
      bug?.metadata?.linked_execution_occurrences ||
      [];
    return Array.isArray(occurrences) &&
      occurrences.some(
        (occurrence: any) =>
          (snapshotId &&
            String(occurrence?.snapshot_id || "") === String(snapshotId)) ||
          (executionId &&
            String(occurrence?.ejecucion_id || "") === String(executionId)),
      );
  };
  const getFailureBugForContext = (test: any) => {
    const latestFailure = getCurrentBuildFailureContext(test);
    const snapshotId =
      latestFailure?.snapshotId || latestFailure?.snapshot_id || null;
    const executionId =
      latestFailure?.executionId ||
      latestFailure?.execution_id ||
      latestFailure?.id ||
      null;
    if (!snapshotId && !executionId) return null;
    return (
      getOpenBugsForCase(test).find(
        (bug: any) =>
          isBugLinkedToFailureContext(bug, snapshotId, executionId),
      ) || null
    );
  };
  const isHistoryItemFromCurrentBuild = (item: any) => {
    if (!currentBuildId) return false;
    const itemBuildId = item?.buildId || item?.build_id || null;
    return (
      Boolean(itemBuildId) && String(itemBuildId) === String(currentBuildId)
    );
  };
  const getCurrentBuildFailureContext = (test: any) => {
    const latest = normalizeExecutionHistory(test)[0];
    if (!latest || !isFailureResult(latest.status)) return null;
    if (!isHistoryItemFromCurrentBuild(latest)) return null;
    return latest;
  };
  const handleInternalBugClick = async (
    event: MouseEvent<HTMLElement>,
    test: any,
  ) => {
    event.stopPropagation();
    if (!getCurrentBuildFailureContext(test)) {
      showFeedback(
        t('ejecutarPruebas.internalBug'),
        t('ejecutarPruebas.internalBugPrerequisite'),
        "warning",
      );
      return;
    }
    const reportedBug = caseBugLinks[test.id] || getFailureBugForContext(test);
    if (reportedBug) {
      onOpenBugTracker?.();
      return;
    }
    const bug = await onCreateInternalBugFromCase?.(test);
    if (bug) setCaseBugLinks((prev) => ({ ...prev, [test.id]: bug }));
  };
  const renderInternalBugButton = (test: any, compact = false) => {
    const failureContext = getCurrentBuildFailureContext(test);
    if (!canCreateBugs || !onCreateInternalBugFromCase || !failureContext)
      return null;
    const contextId = getFailureBugContextId(test);
    const linkedBug = caseBugLinks[test.id] || getFailureBugForContext(test);
    const isCreating = creatingInternalBugContextId === contextId;
    const title = linkedBug
      ? `${linkedBug.codigo} ya reporta esta ejecucion`
      : t('ejecutarPruebas.prepareInternalBugTitle');
    return (
      <Button
        variant={linkedBug ? "danger" : "outline-danger"}
        size="sm"
        className={`fw-bold d-inline-flex align-items-center justify-content-center gap-1 ${compact ? "p-0" : ""}`}
        style={compact ? { width: 30, height: 30 } : undefined}
        disabled={isCreating}
        onClick={(event) => handleInternalBugClick(event, test)}
        title={title}
        aria-label={title}
      >
        <Bug size={compact ? 13 : 15} />
        {!compact &&
          (isCreating
            ? t('ejecutarPruebas.preparing')
            : linkedBug
              ? `Bug reportado ${linkedBug.codigo}`
              : t('ejecutarPruebas.prepareInternalBug'))}
      </Button>
    );
  };
  return { visibleTests, openBugCaseCount, openBugTotal, retestBugCaseCount, getOpenBugsForCase, isRetestBug, getBugStatusBadge, getBugSeverityBadge, getBugCriticalityBadge, renderOpenBugBadge, renderInternalBugButton, getCurrentBuildFailureContext };
}
