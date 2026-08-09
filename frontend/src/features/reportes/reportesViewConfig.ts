export type ReportesViewConfig = {
  sections: Record<string, boolean>
  kpis: Record<string, boolean>
  aiBlocks: Record<string, boolean>
  columns: Record<string, Record<string, boolean>>
}

export const REPORTES_VIEW_SECTIONS = [
  { id: 'traceabilityCoverage', label: 'traceabilityCoverage' },
  { id: 'context', label: 'buildContext' },
  { id: 'kpis', label: 'kpiCards' },
  { id: 'temporal', label: 'temporalProgress' },
  { id: 'aiMetrics', label: 'aiMetrics' },
  { id: 'buildComparison', label: 'buildComparison' },
  { id: 'filters', label: 'detailFilters' },
  { id: 'bugTraceability', label: 'bugTraceability' },
  { id: 'bugs', label: 'bugsTab' },
  { id: 'failures', label: 'failuresTab' },
  { id: 'evidence', label: 'evidenceTab' },
  { id: 'statusChart', label: 'executionStatus' },
  { id: 'executionModeChart', label: 'executionMode' },
  { id: 'priority', label: 'resultsByPriority' },
  { id: 'suites', label: 'resultsBySuite' },
  { id: 'trend', label: 'buildTrend' },
  { id: 'sharedHistory', label: 'sharedHistoryTab' },
  { id: 'qualityIntelligence', label: 'qualityIntelligence' },
]

export const REPORTES_HISTORICAL_SECTIONS = [
  { id: 'buildComparison', label: 'showBuildComparison' },
  { id: 'trend', label: 'showQualityTrend' },
]

export const REPORTES_STANDARD_SECTIONS = REPORTES_VIEW_SECTIONS.filter(
  (section) => !REPORTES_HISTORICAL_SECTIONS.some((historical) => historical.id === section.id),
)

export const REPORTES_VIEW_KPIS = [
  { id: 'assigned', label: 'assignedCases' }, { id: 'executed', label: 'executed' },
  { id: 'pending', label: 'notExecuted' }, { id: 'passed', label: 'passed' },
  { id: 'failed', label: 'failed' }, { id: 'blocked', label: 'blocked' },
  { id: 'coverage', label: 'actualCoverage' }, { id: 'successExecuted', label: 'executedSuccess' },
  { id: 'successTotal', label: 'totalSuccess' }, { id: 'openBugs', label: 'openBugs' },
  { id: 'newBugs', label: 'newBugs' }, { id: 'recurrentBugs', label: 'recurrentBugs' },
  { id: 'failuresWithoutBug', label: 'failuresWithoutBug' },
  { id: 'bugsWithoutEvidence', label: 'bugsWithoutEvidence' },
  { id: 'blocksWithoutReason', label: 'blocksWithoutReason' },
]

export const REPORTES_VIEW_AI_BLOCKS = [
  { id: 'summary', label: 'aiSummary' }, { id: 'models', label: 'modelsUsed' },
  { id: 'categories', label: 'aiCategories' }, { id: 'errorCodes', label: 'aiErrorCodes' },
]

export const enabledRecord = (items: { id: string }[]) => Object.fromEntries(items.map((item) => [item.id, true]))

export const REPORTES_VIEW_COLUMNS: Record<string, { label: string, columns: { id: string, label: string }[] }> = {
  bugs: {
    label: 'bugsTable',
    columns: [
      { id: 'bug', label: 'bug' }, { id: 'caseSuite', label: 'caseSuite' }, { id: 'severity', label: 'severity' },
      { id: 'status', label: 'status' }, { id: 'time', label: 'time' }, { id: 'evidence', label: 'evidence' }, { id: 'action', label: 'action' },
    ],
  },
  failures: {
    label: 'failuresTable',
    columns: [
      { id: 'case', label: 'case' }, { id: 'status', label: 'status' }, { id: 'step', label: 'step' }, { id: 'bug', label: 'bug' }, { id: 'flags', label: 'flags' },
    ],
  },
  priority: {
    label: 'priorityTable',
    columns: [
      { id: 'priority', label: 'priority' }, { id: 'total', label: 'total' }, { id: 'passed', label: 'passed' }, { id: 'failed', label: 'failed' },
      { id: 'blocked', label: 'blocked' }, { id: 'pending', label: 'notExecuted' }, { id: 'coverage', label: 'coverage' }, { id: 'success', label: 'executionSuccess' },
      { id: 'bugs', label: 'openBugs' }, { id: 'risk', label: 'risk' },
    ],
  },
  suites: {
    label: 'suiteTable',
    columns: [
      { id: 'suite', label: 'suite' }, { id: 'total', label: 'total' }, { id: 'passed', label: 'passed' }, { id: 'failed', label: 'failed' },
      { id: 'blocked', label: 'blocked' }, { id: 'pending', label: 'notExecuted' }, { id: 'successExecuted', label: 'executionSuccess' }, { id: 'coverage', label: 'coverage' },
      { id: 'successTotal', label: 'totalSuccess' }, { id: 'bugs', label: 'bugs' }, { id: 'risk', label: 'risk' }, { id: 'lastExecution', label: 'lastExecution' }, { id: 'time', label: 'time' },
    ],
  },
  sharedHistory: {
    label: 'sharedLinksHistoryTable',
    columns: [
      { id: 'snapshot', label: 'snapshot' }, { id: 'typeUser', label: 'typeUser' }, { id: 'buildComponent', label: 'buildComponent' },
      { id: 'qaDefinition', label: 'qaDecision' }, { id: 'status', label: 'status' }, { id: 'links', label: 'links' }, { id: 'actions', label: 'actions' },
    ],
  },
}

export const PROJECT_REPORT_SETTING_GROUPS = {
  executive: [
    { id: 'summary', label: 'executiveSummary', group: 'normal' }, { id: 'kpis', label: 'executiveKpis', group: 'normal' }, { id: 'risks', label: 'mainRisks', group: 'normal' },
    { id: 'trend', label: 'simpleTrend', group: 'trend' }, { id: 'findings', label: 'topFindings', group: 'technical' },
  ],
  development: [
    { id: 'summary', label: 'technicalSummary', group: 'normal' }, { id: 'distribution', label: 'resultsDistribution', group: 'normal' },
    { id: 'failures', label: 'diagnosableFailures', group: 'technical' }, { id: 'bugs', label: 'buildBugs', group: 'technical' },
    { id: 'bug_details', label: 'completePublicBugSheets', group: 'technical' }, { id: 'bug_tracking', label: 'buildTracking', group: 'trend' },
    { id: 'regressions', label: 'regressions', group: 'trend' }, { id: 'actions', label: 'recommendedActions', group: 'normal' },
  ],
  internal: [
    { id: 'summary', label: 'internalSummaryKpis', group: 'normal' }, { id: 'distribution', label: 'resultsDistribution', group: 'normal' },
    { id: 'integrity', label: 'snapshotIntegrity', group: 'technical' }, { id: 'temporal', label: 'temporalProgress', group: 'trend' },
    { id: 'traceability', label: 'bugTraceability', group: 'technical' }, { id: 'trend', label: 'buildTrend', group: 'trend' },
    { id: 'failures', label: 'diagnosableFailures', group: 'technical' }, { id: 'failed_steps', label: 'stepsWithIncident', group: 'technical' },
    { id: 'bugs', label: 'buildBugs', group: 'technical' }, { id: 'evidence', label: 'linkedEvidence', group: 'technical' },
    { id: 'bug_tracking', label: 'buildTracking', group: 'trend' }, { id: 'cases', label: 'snapshotCases', group: 'technical' },
  ],
}

export type ProjectReportType = keyof typeof PROJECT_REPORT_SETTING_GROUPS

export const PROJECT_REPORT_TYPE_META: Record<ProjectReportType, { label: string; title: string; description: string }> = {
  executive: { label: 'reportTypesNamesExecutive', title: 'reportTypesExecutiveTitle', description: 'reportTypesExecutiveDescription' },
  development: { label: 'reportTypesNamesDevelopment', title: 'reportTypesDevelopmentTitle', description: 'reportTypesDevelopmentDescription' },
  internal: { label: 'reportTypesNamesInternal', title: 'reportTypesInternalTitle', description: 'reportTypesInternalDescription' },
}

export const PROJECT_REPORT_SECTION_GROUPS = [
  { id: 'normal', label: 'mainSections' }, { id: 'trend', label: 'historicalTrends' }, { id: 'technical', label: 'technicalDetail' },
] as const

export const DEFAULT_PROJECT_REPORT_SETTINGS = {
  version: 'project-report-settings-v1',
  executive: { sections: enabledRecord(PROJECT_REPORT_SETTING_GROUPS.executive) },
  development: { sections: enabledRecord(PROJECT_REPORT_SETTING_GROUPS.development) },
  internal: { sections: enabledRecord(PROJECT_REPORT_SETTING_GROUPS.internal) },
}

export const DEFAULT_REPORTES_VIEW: ReportesViewConfig = {
  sections: enabledRecord(REPORTES_VIEW_SECTIONS),
  kpis: enabledRecord(REPORTES_VIEW_KPIS),
  aiBlocks: enabledRecord(REPORTES_VIEW_AI_BLOCKS),
  columns: Object.fromEntries(Object.entries(REPORTES_VIEW_COLUMNS).map(([table, config]) => [table, enabledRecord(config.columns)])),
}

export const REPORTES_VIEW_SUMMARY: ReportesViewConfig = {
  ...DEFAULT_REPORTES_VIEW,
  sections: { ...enabledRecord(REPORTES_VIEW_SECTIONS), aiMetrics: false, buildComparison: false, filters: false, bugTraceability: false, bugs: false, failures: false, evidence: false, priority: false, trend: false, sharedHistory: false },
  kpis: { ...enabledRecord(REPORTES_VIEW_KPIS), newBugs: false, recurrentBugs: false, failuresWithoutBug: false, bugsWithoutEvidence: false, blocksWithoutReason: false },
}

export const mergeReportesView = (value: any): ReportesViewConfig => ({
  sections: { ...DEFAULT_REPORTES_VIEW.sections, ...(value?.sections || {}) },
  kpis: { ...DEFAULT_REPORTES_VIEW.kpis, ...(value?.kpis || {}) },
  aiBlocks: { ...DEFAULT_REPORTES_VIEW.aiBlocks, ...(value?.aiBlocks || {}) },
  columns: Object.fromEntries(Object.entries(DEFAULT_REPORTES_VIEW.columns).map(([table, columns]) => [table, { ...columns, ...(value?.columns?.[table] || {}) }])),
})

export const mergeProjectReportSettings = (value: any) => ({
  version: value?.version || DEFAULT_PROJECT_REPORT_SETTINGS.version,
  executive: { sections: { ...DEFAULT_PROJECT_REPORT_SETTINGS.executive.sections, ...(value?.executive?.sections || {}) } },
  development: { sections: { ...DEFAULT_PROJECT_REPORT_SETTINGS.development.sections, ...(value?.development?.sections || {}) } },
  internal: { sections: { ...DEFAULT_PROJECT_REPORT_SETTINGS.internal.sections, ...(value?.internal?.sections || {}) } },
})
