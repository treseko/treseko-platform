import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ResponsiveLayouts } from 'react-grid-layout'
import { API_BASE } from '../../app/constants'
import { featureEnabled, humanizePremiumError, type FeatureLookup } from '../premium/featureAccess'
import {
  DEFAULT_PROJECT_REPORT_SETTINGS,
  DEFAULT_REPORTES_VIEW,
  PROJECT_REPORT_SETTING_GROUPS,
  REPORTES_VIEW_COLUMNS,
  REPORTES_VIEW_KPIS,
  REPORTES_VIEW_SECTIONS,
  REPORTES_VIEW_AI_BLOCKS,
  REPORTES_VIEW_SUMMARY,
  type ProjectReportType,
  type ReportesViewConfig,
  mergeProjectReportSettings,
  mergeReportesView,
} from './reportesViewConfig'
import {
  REPORTES_WIDGET_IDS,
  defaultReportesLayouts,
  sanitizeReportesLayouts,
  sanitizeReportesWidgets,
  stripReportesEditFlags,
  withReportesEditFlags,
} from './reportesLayout'

type Translator = (key: string) => string

type ReportConfigurationProps = {
  t: Translator
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  currentProjectId: string
  loggedUser?: any
  hasSystemFeature?: FeatureLookup
  canAccessCapability?: (capabilityId: any, level?: any) => boolean
  showFeedback: (title: string, message: string, variant?: string) => void
  onPreferencesUpdated?: (preferences: any) => void
}

export function useReportConfiguration({
  t,
  fetchWithAuth,
  currentProjectId,
  loggedUser,
  hasSystemFeature,
  canAccessCapability,
  showFeedback,
  onPreferencesUpdated,
}: ReportConfigurationProps) {
  const profileSettings = loggedUser?.profileSettings || {}
  const reportesView = mergeReportesView(profileSettings.reportes_view)
  const [traceabilityCoverage, setTraceabilityCoverage] = useState<any | null>(null)
  const [traceabilityLoading, setTraceabilityLoading] = useState(false)
  const [showViewConfig, setShowViewConfig] = useState(false)
  const [savingViewConfig, setSavingViewConfig] = useState(false)
  const [viewDraft, setViewDraft] = useState<ReportesViewConfig>(() => reportesView)
  const [editingReportesLayout, setEditingReportesLayout] = useState(false)
  const [reportesLayouts, setReportesLayouts] = useState<ResponsiveLayouts<string>>(() => sanitizeReportesLayouts(profileSettings.reportes_layout))
  const [reportesWidgets, setReportesWidgets] = useState<string[]>(() =>
    sanitizeReportesWidgets(profileSettings.reportes_widgets, profileSettings.reportes_layout)
  )
  const canReadTraceability = canAccessCapability ? canAccessCapability('reportes.trazabilidad', 'read') : true
  const reportsAdvancedEnabled = featureEnabled(hasSystemFeature, 'reports.advanced')
  const reportSnapshotsEnabled = featureEnabled(hasSystemFeature, 'reports.snapshots')
  const canExportReports = canAccessCapability ? canAccessCapability('reportes.exportar', 'read') : true
  const canViewSharedReportsByPermission = canAccessCapability ? canAccessCapability('reportes.compartir', 'read') : true
  const canShareReportsByPermission = canAccessCapability ? canAccessCapability('reportes.compartir', 'edit') : true
  const canConfigureReportsByPermission = canAccessCapability ? canAccessCapability('reportes.configurar', 'edit') : false
  const canViewSharedReports = canViewSharedReportsByPermission && reportSnapshotsEnabled
  const canShareReports = canShareReportsByPermission && reportSnapshotsEnabled
  const canConfigureReports = canConfigureReportsByPermission && reportsAdvancedEnabled
  const canViewBugs = canAccessCapability ? canAccessCapability('bugs.ver', 'read') : true
  const canCreateBugs = canViewBugs && (canAccessCapability ? canAccessCapability('bugs.crear', 'edit') : true)

  const loadTraceabilityCoverage = useCallback(async () => {
    if (!currentProjectId || !canReadTraceability) {
      setTraceabilityCoverage(null)
      return
    }
    setTraceabilityLoading(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/trazabilidad/cobertura/`)
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.detail || `Backend respondio ${response.status}`)
      setTraceabilityCoverage(payload)
    } catch {
      setTraceabilityCoverage(null)
    } finally {
      setTraceabilityLoading(false)
    }
  }, [currentProjectId, canReadTraceability, fetchWithAuth])

  useEffect(() => {
    let active = true
    loadTraceabilityCoverage().then(() => { if (!active) return })
    return () => { active = false }
  }, [loadTraceabilityCoverage])

  const [showReportSettings, setShowReportSettings] = useState(false)
  const [loadingReportSettings, setLoadingReportSettings] = useState(false)
  const [savingReportSettings, setSavingReportSettings] = useState(false)
  const [projectReportSettings, setProjectReportSettings] = useState<any>(() => DEFAULT_PROJECT_REPORT_SETTINGS)
  const [projectReportSettingsDraft, setProjectReportSettingsDraft] = useState<any>(() => DEFAULT_PROJECT_REPORT_SETTINGS)

  useEffect(() => {
    setViewDraft(reportesView)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(profileSettings.reportes_view || {})])

  useEffect(() => {
    setReportesLayouts(sanitizeReportesLayouts(profileSettings.reportes_layout))
    setReportesWidgets(sanitizeReportesWidgets(profileSettings.reportes_widgets, profileSettings.reportes_layout))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedUser?.id, JSON.stringify(profileSettings.reportes_layout || {}), JSON.stringify(profileSettings.reportes_widgets || [])])

  useEffect(() => {
    if (!canConfigureReportsByPermission) setEditingReportesLayout(false)
  }, [canConfigureReportsByPermission])

  const visibleReportesWidgetIds = useMemo(
    () => REPORTES_WIDGET_IDS.filter((id) => reportesWidgets.includes(id)),
    [reportesWidgets]
  )
  const editableReportesLayouts = useMemo(
    () => withReportesEditFlags(reportesLayouts, editingReportesLayout),
    [reportesLayouts, editingReportesLayout]
  )
  const isSectionVisible = (sectionId: string) => reportesView.sections[sectionId] !== false
  const isKpiVisible = (kpiId: string) => reportesView.kpis[kpiId] !== false
  const isAiBlockVisible = (blockId: string) => reportesView.aiBlocks[blockId] !== false
  const isColumnVisible = (table: string, columnId: string) => reportesView.columns?.[table]?.[columnId] !== false
  const visibleColumnCount = (table: string) => Math.max(1, REPORTES_VIEW_COLUMNS[table]?.columns.filter((column) => isColumnVisible(table, column.id)).length || 1)
  const setDraftGroupValue = (group: 'sections' | 'kpis' | 'aiBlocks', id: string, value: boolean) => {
    setViewDraft((current) => ({ ...current, [group]: { ...current[group], [id]: value } }))
  }
  const setDraftColumnValue = (table: string, columnId: string, value: boolean) => {
    setViewDraft((current) => ({
      ...current,
      columns: { ...current.columns, [table]: { ...(current.columns[table] || {}), [columnId]: value } },
    }))
  }
  const countDraftEnabled = (items: { id: string }[], group: 'sections' | 'kpis' | 'aiBlocks') =>
    items.filter((item) => viewDraft[group]?.[item.id] !== false).length
  const countDraftColumnsEnabled = (table: string, columns: { id: string }[]) =>
    columns.filter((column) => viewDraft.columns?.[table]?.[column.id] !== false).length
  const setDraftGroupValues = (items: { id: string }[], group: 'sections' | 'kpis' | 'aiBlocks', value: boolean) => {
    setViewDraft((current) => ({
      ...current,
      [group]: { ...current[group], ...Object.fromEntries(items.map((item) => [item.id, value])) },
    }))
  }
  const setDraftColumnTableValues = (table: string, columns: { id: string }[], value: boolean) => {
    setViewDraft((current) => ({
      ...current,
      columns: { ...current.columns, [table]: { ...(current.columns[table] || {}), ...Object.fromEntries(columns.map((column) => [column.id, value])) } },
    }))
  }
  const applyViewPreset = (preset: 'all' | 'summary' | 'default') => {
    const next = preset === 'summary' ? REPORTES_VIEW_SUMMARY : DEFAULT_REPORTES_VIEW
    setViewDraft(mergeReportesView(next))
  }
  const saveReportesView = async () => {
    try {
      setSavingViewConfig(true)
      const response = await fetchWithAuth(`${API_BASE}/users/me/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({ profile_settings: { ...profileSettings, reportes_view: mergeReportesView(viewDraft) } }),
      })
      if (!response.ok) throw new Error(await response.text())
      const preferences = await response.json()
      onPreferencesUpdated?.(preferences)
      setShowViewConfig(false)
      showFeedback(t('reportes.viewSaved'), t('reportes.viewSavedMessage'), 'success')
    } catch (error: any) {
      showFeedback(t('reportes.saveError'), error?.message || t('reportes.personalViewSaveError'), 'danger')
    } finally {
      setSavingViewConfig(false)
    }
  }
  const saveReportesLayout = async () => {
    if (!canConfigureReportsByPermission) {
      setEditingReportesLayout(false)
      showFeedback(t('reportes.saveError'), t('reportes.layoutSaveError'), 'danger')
      return
    }
    try {
      const response = await fetchWithAuth(`${API_BASE}/users/me/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({ profile_settings: { ...profileSettings, reportes_layout: stripReportesEditFlags(reportesLayouts), reportes_widgets: visibleReportesWidgetIds } }),
      })
      if (!response.ok) throw new Error(await response.text())
      const preferences = await response.json()
      onPreferencesUpdated?.(preferences)
      setEditingReportesLayout(false)
      showFeedback(t('reportes.layoutSaved'), t('reportes.layoutSavedMessage'), 'success')
    } catch (error: any) {
      showFeedback(t('reportes.saveError'), error?.message || t('reportes.layoutSaveError'), 'danger')
    }
  }
  const resetReportesLayout = () => {
    setReportesLayouts(defaultReportesLayouts())
    setReportesWidgets(REPORTES_WIDGET_IDS)
  }

  const loadProjectReportSettings = async (options?: { open?: boolean }) => {
    if (!currentProjectId) return
    if (!canConfigureReports) {
      if (options?.open && canConfigureReportsByPermission && !reportsAdvancedEnabled) {
        showFeedback(t('reportes.premiumReportsTitle'), t('reportes.advancedReportsPremium'), 'info')
      }
      return
    }
    setLoadingReportSettings(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/report-settings`)
      if (!response.ok) throw new Error(humanizePremiumError(await response.text()))
      const data = mergeProjectReportSettings(await response.json())
      setProjectReportSettings(data)
      setProjectReportSettingsDraft(data)
      if (options?.open) setShowReportSettings(true)
    } catch (error: any) {
      showFeedback(t('reportes.viewSettings'), humanizePremiumError(error?.message) || t('reportes.configError'), 'danger')
    } finally {
      setLoadingReportSettings(false)
    }
  }
  useEffect(() => {
    if (canConfigureReports) loadProjectReportSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, canConfigureReports])
  const setProjectReportSection = (reportType: ProjectReportType, sectionId: string, value: boolean) => {
    setProjectReportSettingsDraft((current: any) => ({
      ...current,
      [reportType]: { ...(current?.[reportType] || {}), sections: { ...(current?.[reportType]?.sections || {}), [sectionId]: value } },
    }))
  }
  const setAllProjectReportSections = (reportType: ProjectReportType, value: boolean) => {
    setProjectReportSettingsDraft((current: any) => ({
      ...current,
      [reportType]: { ...(current?.[reportType] || {}), sections: Object.fromEntries(PROJECT_REPORT_SETTING_GROUPS[reportType].map((item) => [item.id, value])) },
    }))
  }
  const countProjectReportSectionsEnabled = (reportType: ProjectReportType) => {
    const sections = projectReportSettingsDraft?.[reportType]?.sections || {}
    return PROJECT_REPORT_SETTING_GROUPS[reportType].filter((section) => sections[section.id] !== false).length
  }
  const saveProjectReportSettings = async () => {
    if (!currentProjectId || !canConfigureReports) return
    setSavingReportSettings(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/report-settings`, { method: 'PATCH', body: JSON.stringify(projectReportSettingsDraft) })
      if (!response.ok) throw new Error(humanizePremiumError(await response.text()))
      const data = mergeProjectReportSettings(await response.json())
      setProjectReportSettings(data)
      setProjectReportSettingsDraft(data)
      setShowReportSettings(false)
      showFeedback(t('reportes.reportsConfigured'), t('reportes.reportsConfiguredMessage'), 'success')
    } catch (error: any) {
      showFeedback(t('reportes.saveError'), humanizePremiumError(error?.message) || t('reportes.reportSettingsSaveError'), 'danger')
    } finally {
      setSavingReportSettings(false)
    }
  }

  return {
    profileSettings,
    traceabilityCoverage, traceabilityLoading, loadTraceabilityCoverage, canReadTraceability,
    showViewConfig, setShowViewConfig, savingViewConfig, viewDraft, setViewDraft, reportesView,
    editingReportesLayout, setEditingReportesLayout, reportesLayouts, setReportesLayouts, reportesWidgets,
    visibleReportesWidgetIds, editableReportesLayouts, isSectionVisible, isKpiVisible, isAiBlockVisible,
    isColumnVisible, visibleColumnCount, setDraftGroupValue, setDraftColumnValue, countDraftEnabled,
    countDraftColumnsEnabled, setDraftGroupValues, setDraftColumnTableValues, applyViewPreset,
    saveReportesView, saveReportesLayout, resetReportesLayout, showReportSettings, setShowReportSettings,
    loadingReportSettings, savingReportSettings, projectReportSettings, projectReportSettingsDraft,
    loadProjectReportSettings, setProjectReportSection, setAllProjectReportSections,
    countProjectReportSectionsEnabled, saveProjectReportSettings, reportsAdvancedEnabled,
    reportSnapshotsEnabled, canExportReports, canViewSharedReportsByPermission, canShareReportsByPermission,
    canConfigureReportsByPermission, canViewSharedReports, canShareReports, canConfigureReports, canViewBugs, canCreateBugs,
    REPORTES_VIEW_KPIS, REPORTES_VIEW_SECTIONS, REPORTES_VIEW_AI_BLOCKS,
  }
}
