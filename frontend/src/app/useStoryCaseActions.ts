import { API_BASE } from "./constants";

export function useStoryCaseActions(options: any): any {
  const { setEditingCasoMasterId, setSelectedTest, setNewTestSuite, setNewTestSuiteSub, setNewTestTitle, setNewTestDescription, setNewTestPre, setNewTestPost, setNewTestData, setNewTestTags, setNewTestPriority, setNewTestCriticality, setNewTestStatus, setNewTestType, setNewTestSteps, setNewTestComponent, setNewTestScript, setNewTestFramework, setNewTestLanguage, setPendingTraceabilityStoryIds, setCaseEditorBaseline, setCaseEditorOpen, setActiveTab, setProjectSyncMessage, casosList, currentProjectId, fetchWithAuth, mapBackendCasoToTest, setCasosList, openEditCase, showFeedback, t } = options;
  const handleCreateCaseFromStory = (story: any, requirement: any) => {
    const affectedComponents = requirement?.componente_ids || [];
    const componentId = affectedComponents.length === 1 ? String(affectedComponents[0]) : "";
    setEditingCasoMasterId(null); setSelectedTest(null); setNewTestSuite(""); setNewTestSuiteSub("");
    setNewTestTitle(story?.titulo || ""); setNewTestDescription(story?.descripcion_markdown || ""); setNewTestPre(""); setNewTestPost(""); setNewTestData(""); setNewTestTags([]); setNewTestPriority(story?.prioridad || "MEDIA"); setNewTestCriticality("MEDIA"); setNewTestStatus("ACTIVO"); setNewTestType("Manual"); setNewTestSteps([]); setNewTestComponent(componentId); setNewTestScript(""); setNewTestFramework("playwright"); setNewTestLanguage("javascript"); setPendingTraceabilityStoryIds(story?.id ? [String(story.id)] : []); setCaseEditorBaseline(""); setCaseEditorOpen(true); setActiveTab("crear_pruebas"); setProjectSyncMessage("Nuevo caso abierto desde la historia. La trazabilidad se guardara junto con el caso.");
  };
  const handleOpenLinkedCaseFromStory = async (masterId: string) => {
    setActiveTab("crear_pruebas");
    try {
      let test = casosList.find((item: any) => String(item.masterId || item.master_id || "") === String(masterId));
      if (!test && currentProjectId) {
        const response = await fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/casos/?include_archived=true`);
        if (!response.ok) throw new Error("No se pudo cargar el caso vinculado.");
        const cases = await response.json();
        const source = Array.isArray(cases) ? cases.find((item: any) => String(item.master_id || item.masterId || "") === String(masterId)) : null;
        if (source) {
          test = mapBackendCasoToTest(source);
          setCasosList((previous: any[]) => previous.some((item) => item.id === test.id) ? previous : [...previous, test]);
        }
      }
      if (!test) throw new Error(t('common.linkedCaseUnavailable'));
      openEditCase(test);
    } catch (error: any) {
      showFeedback("No se pudo abrir el caso", error?.message || t('common.tryAgain'), "danger");
    }
  };
  return { handleCreateCaseFromStory, handleOpenLinkedCaseFromStory };
}
