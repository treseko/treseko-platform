import { useMemo, useRef, useState } from 'react'
import { buildCaseEditorSnapshot } from './mappers'
import type { AttachmentMeta } from '../EvidenceUpload'

export function useCaseEditorState({ caseEditorOpen }: { caseEditorOpen: boolean }) {
  const [newTestSuite, setNewTestSuite] = useState("s1");
  const [newTestSuiteSub, setNewTestSuiteSub] = useState("sub1");
  const [newTestTitle, setNewTestTitle] = useState("");
  const [newTestType, setNewTestType] = useState("AI Agent");
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
        script: newTestScript,
        framework: `${newTestFramework}:${newTestLanguage}`,
        steps: newTestSteps,
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
      newTestScript,
      newTestFramework,
      newTestLanguage,
      pendingTraceabilityStoryIds,
      newTestSteps,
    ],
  );
  const hasUnsavedCaseChanges =
    caseEditorOpen && currentCaseEditorSnapshot !== caseEditorBaseline;
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
