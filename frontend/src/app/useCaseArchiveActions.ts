import { useCallback } from "react";
import { createCaseVersionRows } from "../features/casos/caseVersionUtils";
import { API_BASE } from "./constants";
import { isBuildReadOnly } from "./buildState";
import {
  findSuiteById,
  getRootSuiteId as getRootSuiteIdFromTree,
  getSuiteDepth as getSuiteDepthFromTree,
  UNSUITED_CASES_ROOT_ID,
} from "../testRepositoryUtils";

export function useCaseArchiveActions(options: any): any {
  const {
    t, currentProjectId, currentCompId, currentBuildId, buildsList,
    componentsList, suitesTree, selectedTest, fetchWithAuth, confirmAction,
    showFeedback, loadCasosFromBackend, loadSuitesFromBackend,
    setSelectedTest, setCaseEditorOpen, setEditingCasoMasterId,
    setSelectedSuiteId, setSelectedSubSuiteId, setNewTestSuite,
    setNewTestSuiteSub,
  } = options;
  const readOnlyBuild = isBuildReadOnly(buildsList.find((item: any) => item.id === currentBuildId));

  const updateCaseArchiveStatus = useCallback(async (test: any, nextStatus: "ARCHIVADO" | "ACTIVO") => {
    if (!test?.id || !currentProjectId) return;
    if (readOnlyBuild) {
      showFeedback(t('common.readOnly'), 'La build histórica está en modo consulta y no admite modificaciones.', 'warning');
      return;
    }
    const isArchiving = nextStatus === "ARCHIVADO";
    if (isArchiving) {
      const confirmed = await confirmAction({ title: t('common.archiveTest'), message: t('common.archiveTestMessage'), variant: "warning", confirmLabel: t('common.archiveTest') });
      if (!confirmed) return;
    }
    try {
      const response = await fetchWithAuth(`${API_BASE}/casos/${test.id}/metadata`, { method: "PATCH", body: JSON.stringify({ estado_caso: nextStatus }) });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        const detail = typeof error?.detail === 'string' ? error.detail : null;
        throw new Error(
          detail || (response.status === 409 && isArchiving
            ? t('common.archiveBlockedByActiveBuild')
            : t('common.backendResponded', { status: response.status }))
        );
      }
      await loadCasosFromBackend(currentProjectId, componentsList);
      if (selectedTest?.masterId === test.masterId || selectedTest?.id === test.id) {
        setSelectedTest(null);
        setCaseEditorOpen(false);
        setEditingCasoMasterId(null);
      }
      showFeedback(isArchiving ? t('common.testArchived') : t('common.testRestored'), isArchiving ? t('common.testArchivedMessage') : t('common.testRestoredMessage'), "success");
    } catch (error: any) {
      showFeedback(isArchiving ? t('common.archiveFailed') : t('common.restoreFailed'), error?.message || t('common.testStatusUpdateFailed'), "danger");
    }
  }, [componentsList, confirmAction, currentProjectId, fetchWithAuth, loadCasosFromBackend, selectedTest, showFeedback, readOnlyBuild, t]);

  const updateSuiteArchiveStatus = useCallback(async (suite: any, archivado: boolean) => {
    if (!suite?.id || !currentProjectId) return;
    if (readOnlyBuild) {
      showFeedback(t('common.readOnly'), 'La build histórica está en modo consulta y no admite modificaciones.', 'warning');
      return;
    }
    const confirmed = archivado ? await confirmAction({ title: t('common.archiveSuite'), message: t('common.archiveSuiteMessage'), variant: "warning", confirmLabel: t('common.archiveSuite') }) : true;
    if (!confirmed) return;
    try {
      const response = await fetchWithAuth(`${API_BASE}/suites/${suite.id}/archive`, { method: "PATCH", body: JSON.stringify({ archivado }) });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.detail || t('common.backendResponded', { status: response.status }));
      }
      const result = await response.json().catch(() => ({}));
      await loadSuitesFromBackend(currentProjectId, currentCompId);
      await loadCasosFromBackend(currentProjectId, componentsList);
      setSelectedTest(null);
      setCaseEditorOpen(false);
      setEditingCasoMasterId(null);
      showFeedback(archivado ? t('common.suiteArchived') : t('common.suiteRestored'), `${result.suites_afectadas || 1} suite(s) y ${result.casos_afectados || 0} prueba(s) actualizadas.`, "success");
    } catch (error: any) {
      showFeedback(archivado ? t('common.archiveSuiteFailed') : t('common.restoreSuiteFailed'), error?.message || t('common.suiteStatusUpdateFailed'), "danger");
    }
  }, [componentsList, confirmAction, currentCompId, currentProjectId, fetchWithAuth, loadCasosFromBackend, loadSuitesFromBackend, showFeedback, readOnlyBuild, t]);

  const getCasoVersionRows = createCaseVersionRows({ suitesTree, componentsList });
  const getRootSuiteId = (suiteId: string) => getRootSuiteIdFromTree(suitesTree, suiteId);
  const getSuiteDepth = (suiteId: string) => getSuiteDepthFromTree(suitesTree, suiteId);
  const selectSuiteTarget = (suiteId: string) => {
    if (!suiteId) return;
    setSelectedSuiteId(suiteId);
    setSelectedSubSuiteId(suiteId);
    if (suiteId === UNSUITED_CASES_ROOT_ID) {
      setNewTestSuite("");
      setNewTestSuiteSub("");
      return;
    }
    setNewTestSuite(getRootSuiteId(suiteId));
    setNewTestSuiteSub(suiteId);
  };
  const getSubSuites = (suiteId: string): any[] => findSuiteById(suitesTree, suiteId)?.children || [];
  return { updateCaseArchiveStatus, updateSuiteArchiveStatus, getCasoVersionRows, getRootSuiteId, getSuiteDepth, selectSuiteTarget, getSubSuites };
}
