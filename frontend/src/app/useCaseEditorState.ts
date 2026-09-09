import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildCaseEditorSnapshot } from './mappers'
import type { AttachmentMeta } from '../EvidenceUpload'

export function useCaseEditorState({ caseEditorOpen }: { caseEditorOpen: boolean }) {
  const [newTestSuite, setNewTestSuite] = useState("s1");
  const [newTestSuiteSub, setNewTestSuiteSub] = useState("sub1");
  const [newTestTitle, setNewTestTitle] = useState("");
  const [newTestType, setNewTestType] = useState("Manual");
  const [newTestFormat, setNewTestFormat] = useState("CLASICA");
  const [newTestChatbotConfig, setNewTestChatbotConfigState] = useState<Record<string, any>>({});
  const [newTestApiConfig, setNewTestApiConfig] = useState<Record<string, any>>({});
  const [newTestComponent, setNewTestComponent] = useState("Web");
  const [newTestPre, setNewTestPre] = useState("");
  const [newTestData, setNewTestData] = useState("");
  const [newTestTags, setNewTestTags] = useState<string[]>([]);
  const [addTestSuccess, setAddTestSuccess] = useState(false);
  // 2. Actualizamos el esquema de los pasos para soportar datos e imágenes.
  const [newTestDescription, setNewTestDescription] = useState("");
  const [newTestPost, setNewTestPost] = useState("");
  const [newTestPriority, setNewTestPriority] = useState("MEDIA");
  const [newTestCriticality, setNewTestCriticality] = useState("MEDIA");
  const [newTestStatus, setNewTestStatus] = useState("ACTIVO");
  const [newTestSteps, setNewTestSteps] = useState<
    {
      action: string;
      data: string;
      expected: string;
      actionImg: string;
      expectedImg: string;
      actionAttachments?: AttachmentMeta[];
      expectedAttachments?: AttachmentMeta[];
    }[]
  >([]);
  const [newTestScript, setNewTestScript] = useState("");
  const [newTestFramework, setNewTestFramework] = useState("playwright");
  const [newTestLanguage, setNewTestLanguage] = useState("javascript");
  const [pendingTraceabilityStoryIds, setPendingTraceabilityStoryIds] =
    useState<string[]>([]);
  const [caseEditorBaseline, setCaseEditorBaseline] = useState("");
  const [chatbotEditorRevision, setChatbotEditorRevision] = useState(0);
  const previousCaseEditorBaseline = useRef(caseEditorBaseline);
  const previousCaseEditorOpen = useRef(caseEditorOpen);
  const [caseEditorSaving, setCaseEditorSaving] = useState(false);
  const [aiDryRunRunning, setAiDryRunRunning] = useState(false);
  const aiDryRunInFlightRef = useRef(false);
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >({
    location: false,
    metadata: false,
    steps: false,
    script: false,
  });
  const [scriptTesting, setScriptTesting] = useState(false);
  const [scriptTestResult, setScriptTestResult] = useState<
    "success" | "error" | null
  >(null);
  const currentCaseEditorSnapshot = useMemo(
    () =>
      buildCaseEditorSnapshot({
        suiteId: newTestSuiteSub || newTestSuite,
        componentId: newTestComponent,
        title: newTestTitle,
        description: newTestDescription,
        pre: newTestPre,
        post: newTestPost,
        data: newTestData,
        tags: newTestTags,
        priority: newTestPriority,
        criticality: newTestCriticality,
        status: newTestStatus,
        type: newTestType,
        format: newTestFormat,
        script: newTestScript,
        framework: `${newTestFramework}:${newTestLanguage}`,
        steps: newTestSteps,
        chatbotConfig: newTestChatbotConfig,
        apiConfig: newTestApiConfig,
      }),
    [
      newTestSuite,
      newTestSuiteSub,
      newTestComponent,
      newTestTitle,
      newTestDescription,
      newTestPre,
      newTestPost,
      newTestData,
      newTestTags,
      newTestPriority,
      newTestCriticality,
      newTestStatus,
      newTestType,
      newTestFormat,
      newTestScript,
      newTestFramework,
      newTestLanguage,
      pendingTraceabilityStoryIds,
      newTestSteps,
      newTestChatbotConfig,
      newTestApiConfig,
    ],
  );
  const hasUnsavedCaseChanges =
    caseEditorOpen && (
      currentCaseEditorSnapshot !== caseEditorBaseline ||
      (newTestFormat === 'CONVERSACIONAL' && chatbotEditorRevision > 0)
    );
  const setNewTestChatbotConfig = useCallback((value: any) => {
    if (caseEditorOpen) setChatbotEditorRevision(current => current + 1);
    setNewTestChatbotConfigState(value);
  }, [caseEditorOpen]);
  useEffect(() => {
    if (previousCaseEditorBaseline.current !== caseEditorBaseline || previousCaseEditorOpen.current !== caseEditorOpen) {
      setChatbotEditorRevision(0);
    }
    previousCaseEditorBaseline.current = caseEditorBaseline;
    previousCaseEditorOpen.current = caseEditorOpen;
  }, [caseEditorOpen, caseEditorBaseline]);
  const canSaveCaseEditor =
    Boolean(newTestTitle.trim()) && !caseEditorSaving && hasUnsavedCaseChanges;


  return {
    newTestSuite,
    setNewTestSuite,
    newTestSuiteSub,
    setNewTestSuiteSub,
    newTestTitle,
    setNewTestTitle,
    newTestType,
    setNewTestType,
    newTestFormat,
    setNewTestFormat,
    newTestChatbotConfig,
    setNewTestChatbotConfig,
    newTestApiConfig,
    setNewTestApiConfig,
    newTestComponent,
    setNewTestComponent,
    newTestPre,
    setNewTestPre,
    newTestData,
    setNewTestData,
    newTestTags,
    setNewTestTags,
    addTestSuccess,
    setAddTestSuccess,
    newTestDescription,
    setNewTestDescription,
    newTestPost,
    setNewTestPost,
    newTestPriority,
    setNewTestPriority,
    newTestCriticality,
    setNewTestCriticality,
    newTestStatus,
    setNewTestStatus,
    newTestSteps,
    setNewTestSteps,
    newTestScript,
    setNewTestScript,
    newTestFramework,
    setNewTestFramework,
    newTestLanguage,
    setNewTestLanguage,
    pendingTraceabilityStoryIds,
    setPendingTraceabilityStoryIds,
    caseEditorBaseline,
    setCaseEditorBaseline,
    caseEditorSaving,
    setCaseEditorSaving,
    aiDryRunRunning,
    setAiDryRunRunning,
    aiDryRunInFlightRef,
    collapsedSections,
    setCollapsedSections,
    scriptTesting,
    setScriptTesting,
    scriptTestResult,
    setScriptTestResult,
    currentCaseEditorSnapshot,
    hasUnsavedCaseChanges,
    canSaveCaseEditor,
  }
}
