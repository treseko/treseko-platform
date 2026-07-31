import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Row, Col, Card, Badge, Button, Table, Modal, Form, Tab, Tabs } from 'react-bootstrap'
import { BarChart3, RefreshCw, Activity, Folders, ChevronDown, ChevronRight, Clock, User, FileText, Image as ImageIcon, Share2, Copy, Download, ShieldCheck, Bug, SlidersHorizontal, Grip, RotateCcw, Save } from 'lucide-react'
import { Responsive, WidthProvider } from 'react-grid-layout/legacy'
import type { ResponsiveLayouts } from 'react-grid-layout'
import { isImageAsset, resolveAssetUrl } from '../../shared/utils/assets'
import { openInNewTab } from '../../shared/utils/openExternal'
import { isEvidenceAvailable } from '../../shared/utils/evidenceAvailability'
import { escapeHtml, escapeSpreadsheetHtmlCell } from '../../shared/utils/exportSecurity'
import { API_BASE } from '../../app/constants'
import { formatDateTime } from '../../shared/utils/dateTime'
import { RequiredLabel } from '../../shared/ui/RequiredLabel'
import { PremiumGate } from '../premium/PremiumGate'
import { WorkspaceContextEmptyState } from '../../shared/components/WorkspaceContextEmptyState'
import { featureEnabled, humanizePremiumError, type FeatureLookup } from '../premium/featureAccess'
import { formatBugPriorityOption, getBugPriorityPresentation } from '../bugs/bugPresentation'
import { BugBuildHistoryMetrics, BugBuildTrendBars } from './BugBuildHistoryMetrics'
import { ReportesViewConfigModal } from './ReportesViewConfigModal'
import { ReportWidgetFrame } from './ReportWidgetFrame'
import { useSharedReportState } from './useSharedReportState'
import { useSharedReportActions } from './useSharedReportActions'
import { useReportDataModel } from './useReportDataModel'
import { ReportSuiteRows } from './ReportSuiteRows'
import { ReportDetailWidgets } from './ReportDetailWidgets'
import { ReportChartWidgets } from './ReportChartWidgets'
import { ReportOverviewWidgets } from './ReportOverviewWidgets'
import { ReportAiMetricsWidget } from './ReportAiMetricsWidget'
import { ReportSecondaryWidgets } from './ReportSecondaryWidgets'
import { SharedReportHistory } from './SharedReportHistory'
import { ReportEmptyState } from './ReportEmptyState'
import { SharedReportPremiumNotice } from './SharedReportPremiumNotice'
import { useReportExportActions } from './useReportExportActions'
import { useReportConfiguration } from './useReportConfiguration'
import { ProjectReportSettingsModal } from './ProjectReportSettingsModal'
import { SharedReportModal } from './SharedReportModal'
import { buildReportTablesHtml } from './reportExportUtils'
import {
  SHARED_REPORT_TYPES,
  frontendReportUrl,
  isInternalReportUrl,
  proxiedReportUrl,
  shareableReportUrl,
  sharedMarkdownUrl,
  sharedReportPreview,
} from './reportSharingUtils'
import { useI18n } from '../../i18n'
import {
  REPORTES_BREAKPOINTS,
  REPORTES_COLS,
  REPORTES_WIDGET_IDS,
  defaultReportesLayouts,
  sanitizeReportesLayouts,
  sanitizeReportesWidgets,
  withReportesEditFlags,
  stripReportesEditFlags,
} from './reportesLayout'
import {
  DEFAULT_PROJECT_REPORT_SETTINGS,
  DEFAULT_REPORTES_VIEW,
  PROJECT_REPORT_SECTION_GROUPS,
  PROJECT_REPORT_SETTING_GROUPS,
  PROJECT_REPORT_TYPE_META,
  REPORTES_HISTORICAL_SECTIONS,
  REPORTES_STANDARD_SECTIONS,
  REPORTES_VIEW_AI_BLOCKS,
  REPORTES_VIEW_COLUMNS,
  REPORTES_VIEW_KPIS,
  REPORTES_VIEW_SECTIONS,
  REPORTES_VIEW_SUMMARY,
  type ProjectReportType,
  type ReportesViewConfig,
  mergeProjectReportSettings,
  mergeReportesView,
} from './reportesViewConfig'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
const ResponsiveReportesGridLayout = WidthProvider(Responsive)

type ReportesPageProps = {
  metricsLoading: boolean
  projectMetrics: any
  expandedMetricSuites: Set<string>
  setExpandedMetricSuites: (suites: Set<string>) => void
  loadProjectMetrics: (buildId?: string, options?: { silent?: boolean }) => void
  showFeedback: (title: string, message: string, variant?: string) => void
  onOpenEvidence: (attachmentOrUrl: any) => void
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  currentProjectId: string
  currentBuildId: string
  onOpenHistorial?: (filters?: Record<string, any>, runId?: string) => void
  onOpenBugTracker?: () => void
  canAccessCapability?: (capabilityId: any, level?: any) => boolean
  hasSystemFeature?: FeatureLookup
  loggedUser?: any
  onPreferencesUpdated?: (preferences: any) => void
}

export function ReportesPage({
  metricsLoading,
  projectMetrics,
  expandedMetricSuites,
  setExpandedMetricSuites,
  loadProjectMetrics,
  showFeedback,
  onOpenEvidence,
  fetchWithAuth,
  currentProjectId,
  currentBuildId,
  onOpenHistorial,
  onOpenBugTracker,
  canAccessCapability,
  hasSystemFeature,
  loggedUser,
  onPreferencesUpdated,
}: ReportesPageProps) {
  const { t } = useI18n()
  const {
    traceabilityCoverage, traceabilityLoading, loadTraceabilityCoverage, canReadTraceability,
    profileSettings, showViewConfig, setShowViewConfig, savingViewConfig, viewDraft, setViewDraft, reportesView,
    editingReportesLayout, setEditingReportesLayout, reportesLayouts, setReportesLayouts, reportesWidgets,
    visibleReportesWidgetIds, editableReportesLayouts, isSectionVisible, isKpiVisible, isAiBlockVisible,
    isColumnVisible, visibleColumnCount, setDraftGroupValue, setDraftColumnValue, countDraftEnabled,
    countDraftColumnsEnabled, setDraftGroupValues, setDraftColumnTableValues, applyViewPreset,
    saveReportesView, saveReportesLayout, resetReportesLayout, showReportSettings, setShowReportSettings,
    loadingReportSettings, savingReportSettings, projectReportSettings, projectReportSettingsDraft,
    loadProjectReportSettings, setProjectReportSection, setAllProjectReportSections,
    countProjectReportSectionsEnabled, saveProjectReportSettings, reportsAdvancedEnabled,
    reportSnapshotsEnabled, canExportReports, canViewSharedReportsByPermission, canShareReportsByPermission,
    canConfigureReportsByPermission, canViewSharedReports, canShareReports, canConfigureReports, canCreateBugs,
  } = useReportConfiguration({
    t,
    fetchWithAuth,
    currentProjectId,
    loggedUser,
    hasSystemFeature,
    canAccessCapability,
    showFeedback,
    onPreferencesUpdated,
  })
  const {
    sharingReport, setSharingReport, sharedReport, setSharedReport, showShareModal, setShowShareModal,
    shareAcknowledged, setShareAcknowledged, sharedReportHistory, setSharedReportHistory,
    sharedReportHistoryBuildId, setSharedReportHistoryBuildId, loadingSharedHistory,
    showFullSharedHistory, setShowFullSharedHistory, buildDefinition, setBuildDefinition, qaComment, setQaComment,
    snapshotBugLinks, setSnapshotBugLinks, creatingSnapshotBugId, setCreatingSnapshotBugId,
    currentReportBuildId, findReusableSharedReport, isCurrentSharedReportReusable, reusableSharedReport,
    hasOutdatedSharedReport, buildDefinitionRequiresComment, normalizeSharedReportFromHistory,
    openShareModal, loadSharedReportHistory, shareReport, revokeSharedBundle,
  } = useSharedReportState({ t, fetchWithAuth, currentProjectId, currentBuildId, projectMetrics, canShareReports, canViewSharedReports, showFeedback })
  const [detailFilters, setDetailFilters] = useState({
    suite: '',
    priority: '',
    status: '',
    owner: '',
    executionMode: '',
    bug: 'open',
    evidence: '',
  })
  const {
    suiteTree, aiMetrics, bugMetrics, buildContext, qaStatus, temporalMetrics, bugTraceability,
    failureItems, evidenceItems, evidenceSummary, comparison, reportStats, formatInt, formatPercent,
    formatHours, formatSeconds, riskVariant, statusVariant, displayedSharedHistory, allReportBugs,
    uniqueOptions, suiteFilterOptions, priorityFilterOptions, ownerFilterOptions, matchesDetailFilters,
    filteredReportBugs, filteredFailures, filteredEvidenceItems, bugStatusIsOpen, formatMoney, formatMs,
    aiModels, aiFailureCategories, aiErrorCodes, readableAiLabel, pendingStatus, statusChartData,
    executionModeData, caseTypeData, executedStatusTotal, assignedStatusTotal, statusChartTotal,
    statusGradient, executionModeMax, hasExecutionModeData, workflowNodeSummary,
  } = useReportDataModel({ projectMetrics, detailFilters, sharedReportHistory, showFullSharedHistory, t })
  const { reportFilename, sharedReportFilename, downloadTextFile, exportPdfReport, exportExcelReport } = useReportExportActions({ t, projectMetrics, currentBuildId, suiteTree, reportStats, bugMetrics, showFeedback })
  const renderReportesWidget = (id: string, children: ReactNode, visible = isSectionVisible(id)) => (
    <ReportWidgetFrame id={id} visible={visible} editing={editingReportesLayout} t={t}>{children}</ReportWidgetFrame>
  )
  const markdownUrl = sharedReport?.public_url ? `${sharedReport.public_url}.md` : ''

  const exportMarkdown = () => {
    if (!shareAcknowledged || !markdownUrl) return
    const anchor = document.createElement('a')
    anchor.href = markdownUrl
    anchor.download = `${sharedReport?.tokens?.executive || 'informe-qa'}.md`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  const { copyLink, openSharedReport, downloadSharedMarkdown, createBugFromReportSnapshot, exportSharedReportPdf } = useSharedReportActions({
    t, fetchWithAuth, showFeedback, isInternalReportUrl, proxiedReportUrl, frontendReportUrl,
    sharedMarkdownUrl, sharedReportFilename, sharedReport, setSnapshotBugLinks,
    setCreatingSnapshotBugId, downloadTextFile,
  })

  const collectSuiteIds = (nodes: any[]): string[] => nodes.flatMap(node => [node.id, ...collectSuiteIds(node.children || [])])

  if (!currentProjectId) {
    return (
      <WorkspaceContextEmptyState
        message={t('reportes.noProjectSelected')}
        detail={t('reportes.noProjectDetail')}
      />
    )
  }

  return (
    <div className={`p-4 animate__animated animate__fadeIn text-dark text-start reportes-page ${editingReportesLayout ? 'is-editing-layout' : ''}`}>
      <div className="reportes-header d-flex flex-column flex-xl-row justify-content-between align-items-start gap-3 mb-4">
        <div className="reportes-header-title">
          <h4 className="fw-bold text-primary m-0 d-flex align-items-center gap-2">
            <BarChart3 size={24} className="flex-shrink-0" />
            <span>{t('reportes.pageTitle')}</span>
          </h4>
          <div className="small text-muted">{t('reportes.pageDescription')}</div>
        </div>
        <div className="reportes-toolbar d-flex flex-wrap gap-2 justify-content-start justify-content-xl-end">
          <div className="reportes-toolbar-group">
            <Button
              variant="outline-secondary"
              size="sm"
              className="fw-bold px-3 border-2 rounded-3 hover-bg-light shadow-none"
              onClick={() => {
                setViewDraft(reportesView)
                setShowViewConfig(true)
              }}
            >
              <SlidersHorizontal size={14} className="me-1" /> {t('reportes.configureView')}
            </Button>
            <Button
              variant={editingReportesLayout ? 'primary' : 'outline-secondary'}
              size="sm"
              className="fw-bold px-3 border-2 rounded-3 hover-bg-light shadow-none"
              disabled={!projectMetrics}
              onClick={() => setEditingReportesLayout((value) => !value)}
            >
              <Grip size={14} className="me-1" /> {editingReportesLayout ? t('reportes.editingLayout') : t('reportes.arrangeBlocks')}
            </Button>
            {editingReportesLayout && (
              <>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  className="fw-bold px-3 border-2 rounded-3 hover-bg-light shadow-none"
                  onClick={resetReportesLayout}
                >
                  <RotateCcw size={14} className="me-1" /> {t('reportes.restoreLayout')}
                </Button>
                <Button
                  variant="success"
                  size="sm"
                  className="fw-bold px-3 border-0 rounded-3 shadow-none"
                  onClick={saveReportesLayout}
                >
                  <Save size={14} className="me-1" /> {t('reportes.saveLayout')}
                </Button>
              </>
            )}
          </div>
          {canConfigureReportsByPermission && (
            <PremiumGate
              feature="reports.advanced"
              hasFeature={hasSystemFeature}
              title={t('reportes.premiumReportsTitle')}
              description={t('reportes.premiumReportsDescription')}
              mode="disabled"
            >
              <Button
                variant="outline-secondary"
                size="sm"
                className="fw-bold px-3 border-2 rounded-3 hover-bg-light shadow-none"
                disabled={loadingReportSettings}
                onClick={() => loadProjectReportSettings({ open: true })}
              >
                <SlidersHorizontal size={14} className="me-1" /> {t('reportes.configureReports')}
              </Button>
            </PremiumGate>
          )}
          <div className="reportes-toolbar-group reportes-toolbar-group-exports">
            <Button variant="outline-secondary" size="sm" className="fw-bold px-3 border-2 rounded-3 hover-bg-light shadow-none" onClick={() => loadProjectMetrics()}>
              <RefreshCw size={14} className="me-1" /> {t('reportes.refresh')}
            </Button>
            {canExportReports && (
              <Button variant="outline-secondary" size="sm" className="fw-bold px-3 border-2 rounded-3 hover-bg-light shadow-none" disabled={!projectMetrics} onClick={exportPdfReport}>
                <Download size={14} className="me-1" /> {t('reportes.pdf')}
              </Button>
            )}
            {canShareReportsByPermission && (
              <PremiumGate
                feature="reports.snapshots"
                hasFeature={hasSystemFeature}
                title={t('reportes.sharedReportsPremiumTitle')}
                description={t('reportes.sharedReportsPremiumDescription')}
                mode="disabled"
              >
                <Button variant="outline-primary" size="sm" className="fw-bold px-3 border-2 rounded-3 hover-bg-light shadow-none" disabled={sharingReport || loadingSharedHistory || !projectMetrics} onClick={openShareModal}>
                  <Share2 size={14} className="me-1" /> {loadingSharedHistory ? t('reportes.reviewing') : t('reportes.share')}
                </Button>
              </PremiumGate>
            )}
            {canExportReports && (
              <Button variant="primary" size="sm" className="fw-bold px-3 border-0 shadow rounded-3 shadow-none" disabled={!projectMetrics} onClick={exportExcelReport}>
                <Download size={14} className="me-1" /> {t('reportes.xls')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {metricsLoading ? (
        <div className="text-center py-5">
          <RefreshCw size={32} className="text-primary animate-pulse" />
          <p className="text-muted mt-2">{t('reportes.loadingMetrics')}</p>
        </div>
      ) : projectMetrics ? (
        <ResponsiveReportesGridLayout
          className="layout reportes-layout-grid"
          layouts={editableReportesLayouts}
          breakpoints={REPORTES_BREAKPOINTS}
          cols={REPORTES_COLS}
          rowHeight={76}
          isDraggable={editingReportesLayout}
          isResizable={editingReportesLayout}
          isBounded
          draggableHandle=".reportes-widget-header"
          draggableCancel=".reportes-widget-body, button, a, input, textarea, select, .form-check, table"
          resizeHandles={['se']}
          compactType="vertical"
          onLayoutChange={(_, allLayouts) => {
            if (editingReportesLayout) setReportesLayouts(stripReportesEditFlags(allLayouts))
          }}
        >
          <ReportOverviewWidgets
            renderReportesWidget={renderReportesWidget}
            t={t}
            traceabilityCoverage={traceabilityCoverage}
            traceabilityLoading={traceabilityLoading}
            loadTraceabilityCoverage={loadTraceabilityCoverage}
            canReadTraceability={canReadTraceability}
            isSectionVisible={isSectionVisible}
            buildContext={buildContext}
            projectMetrics={projectMetrics}
            statusVariant={statusVariant}
            qaStatus={qaStatus}
            riskVariant={riskVariant}
            formatHours={formatHours}
            formatSeconds={formatSeconds}
            isKpiVisible={isKpiVisible}
            reportStats={reportStats}
            bugMetrics={bugMetrics}
            failureItems={failureItems}
            temporalMetrics={temporalMetrics}
            formatInt={formatInt}
            formatPercent={formatPercent}
          />

          <ReportAiMetricsWidget
            renderReportesWidget={renderReportesWidget}
            t={t}
            aiMetrics={aiMetrics}
            formatInt={formatInt}
            formatMoney={formatMoney}
            formatMs={formatMs}
            workflowNodeSummary={workflowNodeSummary}
            isAiBlockVisible={isAiBlockVisible}
            aiModels={aiModels}
            aiFailureCategories={aiFailureCategories}
            aiErrorCodes={aiErrorCodes}
            readableAiLabel={readableAiLabel}
            projectMetrics={projectMetrics}
            currentBuildId={currentBuildId}
            onOpenHistorial={onOpenHistorial}
            showFeedback={showFeedback}
          />

          <ReportSecondaryWidgets options={{
            renderReportesWidget, t, projectMetrics, comparison, formatPercent, formatInt,
            isColumnVisible, riskVariant, suiteTree, setExpandedMetricSuites, collectSuiteIds,
            expandedMetricSuites, onOpenEvidence, visibleColumnCount, formatHours,
            snapshotBugLinks, bugStatusIsOpen, canCreateBugs, creatingSnapshotBugId,
            createBugFromReportSnapshot,
          }} />

          <ReportDetailWidgets
            renderReportesWidget={renderReportesWidget}
            t={t}
            setDetailFilters={setDetailFilters}
            detailFilters={detailFilters}
            suiteFilterOptions={suiteFilterOptions}
            priorityFilterOptions={priorityFilterOptions}
            uniqueOptions={uniqueOptions}
            allReportBugs={allReportBugs}
            failureItems={failureItems}
            ownerFilterOptions={ownerFilterOptions}
            formatInt={formatInt}
            formatHours={formatHours}
            formatPercent={formatPercent}
            bugTraceability={bugTraceability}
            bugMetrics={bugMetrics}
            filteredReportBugs={filteredReportBugs}
            filteredFailures={filteredFailures}
            filteredEvidenceItems={filteredEvidenceItems}
            isColumnVisible={isColumnVisible}
            visibleColumnCount={visibleColumnCount}
            riskVariant={riskVariant}
            onOpenBugTracker={onOpenBugTracker}
            showFeedback={showFeedback}
            evidenceSummary={evidenceSummary}
          />
          <ReportChartWidgets
            renderReportesWidget={renderReportesWidget}
            t={t}
            statusChartData={statusChartData}
            statusGradient={statusGradient}
            statusChartTotal={statusChartTotal}
            assignedStatusTotal={assignedStatusTotal}
            executedStatusTotal={executedStatusTotal}
            formatInt={formatInt}
            executionModeData={executionModeData}
            executionModeMax={executionModeMax}
            hasExecutionModeData={hasExecutionModeData}
            caseTypeData={caseTypeData}
          />
        </ResponsiveReportesGridLayout>
      ) : (
        <ReportEmptyState t={t} loadProjectMetrics={loadProjectMetrics} />
      )}
      <SharedReportPremiumNotice
        enabled={canViewSharedReportsByPermission}
        reportSnapshotsEnabled={reportSnapshotsEnabled}
        isSectionVisible={isSectionVisible}
        hasSystemFeature={hasSystemFeature}
        t={t}
      />
      <SharedReportHistory options={{
        canViewSharedReports, isSectionVisible, t, sharedReportHistory, setShowFullSharedHistory,
        showFullSharedHistory, loadSharedReportHistory, loadingSharedHistory, isColumnVisible,
        visibleColumnCount, displayedSharedHistory, formatDateTime, projectMetrics,
        openSharedReport, copyLink, canShareReports, revokeSharedBundle,
      }} />
      <ReportesViewConfigModal
        show={showViewConfig}
        onHide={() => setShowViewConfig(false)}
        viewDraft={viewDraft}
        saving={savingViewConfig}
        t={t}
        applyViewPreset={applyViewPreset}
        countDraftEnabled={countDraftEnabled}
        setDraftGroupValues={setDraftGroupValues}
        setDraftGroupValue={setDraftGroupValue}
        countDraftColumnsEnabled={countDraftColumnsEnabled}
        setDraftColumnTableValues={setDraftColumnTableValues}
        setDraftColumnValue={setDraftColumnValue}
        resetLayout={resetReportesLayout}
        saveLayout={saveReportesLayout}
        saveView={saveReportesView}
      />
      <ProjectReportSettingsModal
        show={showReportSettings}
        saving={savingReportSettings}
        draft={projectReportSettingsDraft}
        t={t}
        countEnabled={countProjectReportSectionsEnabled}
        setAllSections={setAllProjectReportSections}
        setSection={setProjectReportSection}
        onHide={() => setShowReportSettings(false)}
        onSave={saveProjectReportSettings}
      />
      <SharedReportModal
        show={showShareModal}
        sharedReport={sharedReport}
        sharing={sharingReport}
        buildDefinition={buildDefinition}
        setBuildDefinition={setBuildDefinition}
        qaComment={qaComment}
        setQaComment={setQaComment}
        qaStatus={qaStatus}
        hasOutdatedSharedReport={hasOutdatedSharedReport}
        buildDefinitionRequiresComment={buildDefinitionRequiresComment}
        canShare={canShareReports}
        canExport={canExportReports}
        sharedReportTypes={SHARED_REPORT_TYPES}
        t={t}
        shareableReportUrl={shareableReportUrl}
        sharedReportPreview={sharedReportPreview}
        openSharedReport={openSharedReport}
        copyLink={copyLink}
        exportSharedReportPdf={exportSharedReportPdf}
        downloadSharedMarkdown={downloadSharedMarkdown}
        onClose={() => setShowShareModal(false)}
        onShare={shareReport}
        onExportPdf={exportPdfReport}
        onExportExcel={exportExcelReport}
      />
    </div>
  )
}
