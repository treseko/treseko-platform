import { useRef, useState } from 'react'
import type { AttachmentMeta } from '../EvidenceUpload'

export function useAppExecutionState() {
  const [executionBugDetailId, setExecutionBugDetailId] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'manual_exec'>('list')
  const [selectedSuiteId, setSelectedSuiteId] = useState<string>('s1')
  const [selectedTest, setSelectedTest] = useState<any>(null)
  const [showExecSelector, setShowExecSelector] = useState(false)
  const [stepResults, setStepResults] = useState<Record<number, string>>({})
  const [currentExecutionRun, setCurrentExecutionRun] = useState<any>(null)
  const [automationMonitor, setAutomationMonitor] = useState<any>({ show: false, run: null, jobs: [], mode: 'execution' })
  const [currentExecutionCase, setCurrentExecutionCase] = useState<any>(null)
  const [executionSnapshots, setExecutionSnapshots] = useState<any[]>([])
  const [executionLoading, setExecutionLoading] = useState(false)
  const [executionMode, setExecutionMode] = useState<'manual' | 'automated' | 'ia' | null>(null)
  const [selectedExecutionTestIds, setSelectedExecutionTestIds] = useState<string[]>([])
  const [executionModalCaseIds, setExecutionModalCaseIds] = useState<string[] | null>(null)
  const [activeExecutionCaseIds, setActiveExecutionCaseIds] = useState<string[]>([])
  const [selectedExecutionEnvironmentId, setSelectedExecutionEnvironmentId] = useState('')
  const [selectedExecutionDatasetId, setSelectedExecutionDatasetId] = useState('')
  const [executionDatasetPreview, setExecutionDatasetPreview] = useState<any>(null)
  const [executionDatasetPreviewLoading, setExecutionDatasetPreviewLoading] = useState(false)
  const latestResultsRequestRef = useRef<Record<string, number>>({})
  const suiteExplorerResizeCleanupRef = useRef<(() => void) | null>(null)
  const [latestResultsLoadingByBuild, setLatestResultsLoadingByBuild] = useState<Record<string, boolean>>({})
  const [buildCaseResultHistoryByBuild, setBuildCaseResultHistoryByBuild] = useState<Record<string, Record<string, any[]>>>({})
  const [snapshotNotes, setSnapshotNotes] = useState<Record<number, string>>({})
  const [snapshotAttachments, setSnapshotAttachments] = useState<Record<string, AttachmentMeta[]>>({})
  const [generalExecutionSnapshot, setGeneralExecutionSnapshot] = useState<any | null>(null)
  const [generalExecutionAttachments, setGeneralExecutionAttachments] = useState<AttachmentMeta[]>([])
  const [generalExecutionStatus, setGeneralExecutionStatus] = useState('SIN_CORRER')
  const [generalExecutionNote, setGeneralExecutionNote] = useState('')
  const [showRedmineDrawer, setShowRedmineDrawer] = useState(false)
  const [showRedminePrompt, setShowRedminePrompt] = useState(false)
  const [redmineDecisionByExecution, setRedmineDecisionByExecution] = useState<Record<string, 'reported' | 'deferred'>>({})
  const [creatingInternalBugContextId, setCreatingInternalBugContextId] = useState<string | null>(null)
  const [internalBugDraft, setInternalBugDraft] = useState<Record<string, any> | null>(null)
  const [internalBugAdditionalContext, setInternalBugAdditionalContext] = useState<{ key: string; value: string }[]>([])
  const [internalBugEvidence, setInternalBugEvidence] = useState<AttachmentMeta[]>([])
  const [bugTrackerRefreshToken, setBugTrackerRefreshToken] = useState(0)
  const [openBugsByCase, setOpenBugsByCase] = useState<Record<string, any[]>>({})
  const [openBugsLoading, setOpenBugsLoading] = useState(false)
  const [relatedCaseBugs, setRelatedCaseBugs] = useState<any[]>([])
  const [relatedCaseBugsLoading, setRelatedCaseBugsLoading] = useState(false)
  const lastRelatedCaseIdRef = useRef<string | null>(null)
  const relatedBugDecisionResolverRef = useRef<((value: 'create' | 'cancel') => void) | null>(null)
  const [relatedBugDecision, setRelatedBugDecision] = useState<any>({ show: false, bugs: [], viewingBug: null, linkingBugId: null, canLink: false })

  return {
    executionBugDetailId, setExecutionBugDetailId, sidebarCollapsed, setSidebarCollapsed,
    viewMode, setViewMode, selectedSuiteId, setSelectedSuiteId, selectedTest, setSelectedTest,
    showExecSelector, setShowExecSelector, stepResults, setStepResults, currentExecutionRun,
    setCurrentExecutionRun, automationMonitor, setAutomationMonitor, currentExecutionCase,
    setCurrentExecutionCase, executionSnapshots, setExecutionSnapshots, executionLoading,
    setExecutionLoading, executionMode, setExecutionMode, selectedExecutionTestIds,
    setSelectedExecutionTestIds, executionModalCaseIds, setExecutionModalCaseIds,
    activeExecutionCaseIds, setActiveExecutionCaseIds, selectedExecutionEnvironmentId,
    setSelectedExecutionEnvironmentId, selectedExecutionDatasetId, setSelectedExecutionDatasetId,
    executionDatasetPreview, setExecutionDatasetPreview, executionDatasetPreviewLoading,
    setExecutionDatasetPreviewLoading, latestResultsRequestRef, suiteExplorerResizeCleanupRef,
    latestResultsLoadingByBuild, setLatestResultsLoadingByBuild, buildCaseResultHistoryByBuild,
    setBuildCaseResultHistoryByBuild, snapshotNotes, setSnapshotNotes, snapshotAttachments,
    setSnapshotAttachments, generalExecutionSnapshot, setGeneralExecutionSnapshot,
    generalExecutionAttachments, setGeneralExecutionAttachments, generalExecutionStatus,
    setGeneralExecutionStatus, generalExecutionNote, setGeneralExecutionNote, showRedmineDrawer,
    setShowRedmineDrawer, showRedminePrompt, setShowRedminePrompt, redmineDecisionByExecution,
    setRedmineDecisionByExecution, creatingInternalBugContextId, setCreatingInternalBugContextId,
    internalBugDraft, setInternalBugDraft, internalBugAdditionalContext, setInternalBugAdditionalContext,
    internalBugEvidence, setInternalBugEvidence, bugTrackerRefreshToken, setBugTrackerRefreshToken,
    openBugsByCase, setOpenBugsByCase, openBugsLoading, setOpenBugsLoading, relatedCaseBugs,
    setRelatedCaseBugs, relatedCaseBugsLoading, setRelatedCaseBugsLoading, lastRelatedCaseIdRef,
    relatedBugDecisionResolverRef, relatedBugDecision, setRelatedBugDecision,
  }
}
