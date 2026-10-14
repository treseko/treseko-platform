import { useReportContextGuard } from './useReportContextGuard'
import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE } from '../../app/constants'
import { humanizePremiumError } from '../premium/featureAccess'

export function useSharedReportState(options: any) {
  const { t, fetchWithAuth, currentProjectId, currentBuildId, projectMetrics, canShareReports, canViewSharedReports, showFeedback } = options
  const [sharingReport, setSharingReport] = useState(false)
  const [sharedReport, setSharedReport] = useState<any | null>(null)
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareAcknowledged, setShareAcknowledged] = useState(false)
  const [sharedReportHistory, setSharedReportHistory] = useState<any[]>([])
  const [sharedReportHistoryBuildId, setSharedReportHistoryBuildId] = useState<string | null>(null)
  const [loadingSharedHistory, setLoadingSharedHistory] = useState(false)
  const [showFullSharedHistory, setShowFullSharedHistory] = useState(false)
  const [buildDefinition, setBuildDefinition] = useState('')
  const [qaComment, setQaComment] = useState('')
  const [snapshotBugLinks, setSnapshotBugLinks] = useState<Record<string, any>>({})
  const [creatingSnapshotBugId, setCreatingSnapshotBugId] = useState<string | null>(null)
  const currentReportBuildId = currentBuildId || projectMetrics?.build_id
  const context = `${currentProjectId}:${currentBuildId || currentReportBuildId}:${canViewSharedReports}:${canShareReports}`
  const captureContext = useReportContextGuard(context)
  const historySequence = useRef(0)
  const [sharedHistoryError, setSharedHistoryError] = useState('')
  useEffect(() => {
    historySequence.current += 1
    setSharedReportHistory([]); setSharedReportHistoryBuildId(null); setSharedHistoryError('')
    setSharedReport(null); setShowShareModal(false); setShareAcknowledged(false); setSharingReport(false)
    setLoadingSharedHistory(false); setBuildDefinition(''); setQaComment(''); setSnapshotBugLinks({})
  }, [context])
  const normalizeId = (value: any) => value ? String(value) : ''
  const hasAllSharedReportLinks = (item: any) => Boolean(item?.links?.executive && item?.links?.development && item?.links?.internal)
  const sharedReportMatchesCurrentBuild = (item: any, historyBuildId = sharedReportHistoryBuildId) => {
    if (!currentReportBuildId) return true
    const currentBuild = normalizeId(currentReportBuildId)
    if (item?.build_id && normalizeId(item.build_id) !== currentBuild) return false
    const snapshotBuildIds = (item?.snapshots || []).map((snapshot: any) => snapshot?.build_id).filter(Boolean)
    return normalizeId(item?.build_id) === currentBuild || snapshotBuildIds.some((id: any) => normalizeId(id) === currentBuild) || normalizeId(historyBuildId) === currentBuild
  }
  const findReusableSharedReport = (history: any[], historyBuildId = sharedReportHistoryBuildId) => history.find((item) => item?.activo && item?.is_latest === true && item?.has_new_values === false && hasAllSharedReportLinks(item) && sharedReportMatchesCurrentBuild(item, historyBuildId))
  const isCurrentSharedReportReusable = (report: any) => report?.activo !== false && report?.has_new_values !== true && hasAllSharedReportLinks(report) && sharedReportMatchesCurrentBuild(report, null)
  const reusableSharedReport = findReusableSharedReport(sharedReportHistory)
  const hasOutdatedSharedReport = sharedReportHistory.some((item) => item?.activo && item?.has_new_values)
  const buildDefinitionRequiresComment = ['RECHAZADA', 'BLOQUEADA', 'APROBADA_CON_OBSERVACIONES', 'PENDIENTE_DE_VALIDACION'].includes(buildDefinition)
  const isTransientNetworkError = (error: any) => {
    const message = String(error?.message || error || '').toLowerCase()
    return error instanceof TypeError || message.includes('load failed') || message.includes('failed to fetch') || message.includes('networkerror')
  }
  const retryAfterNetworkError = async (request: () => Promise<Response>, isCurrent: () => boolean) => {
    try {
      return await request()
    } catch (error) {
      if (!isTransientNetworkError(error)) throw error
      await new Promise(resolve => setTimeout(resolve, 800))
      if (!isCurrent()) throw new Error('Stale report context')
      return request()
    }
  }
  const normalizeSharedReportFromHistory = (item: any) => ({ ...item, reused: true, reusedFromHistory: true, links: item.links || {}, tokens: item.tokens || {}, snapshots: item.snapshots || [] })
  const loadSharedReportHistory = useCallback(async () => {
    const contextIsCurrent = captureContext()
    const sequence = ++historySequence.current
    const isCurrent = () => contextIsCurrent() && sequence === historySequence.current
    const emptyResult = { items: [] as any[], buildId: null as string | null, error: true }
    if (!currentProjectId || !canViewSharedReports) { setSharedReportHistory([]); setSharedReportHistoryBuildId(null); return emptyResult }
    setLoadingSharedHistory(true)
    const buildId = currentBuildId || projectMetrics?.build_id || null
    try {
      const params = new URLSearchParams({ proyecto_id: currentProjectId }); if (buildId) params.set('build_id', buildId)
      const response = await fetchWithAuth(`${API_BASE}/reports/share/history?${params.toString()}`)
      if (!response.ok) throw new Error(humanizePremiumError(await response.text()))
      const items = await response.json()
      if (!isCurrent()) return emptyResult
      setSharedReportHistory(items); setSharedReportHistoryBuildId(buildId); setSharedHistoryError('')
      return { items, buildId, error: false }
    } catch (reason: any) {
      if (isCurrent()) setSharedHistoryError(reason?.message || t('reportes.sharedHistoryLoadError'))
      return emptyResult
    } finally { if (isCurrent()) setLoadingSharedHistory(false) }
  }, [currentProjectId, canViewSharedReports, projectMetrics?.build_id, currentBuildId, fetchWithAuth, captureContext, t])
  useEffect(() => {
    // Wait for the selected build metrics so the first history request uses
    // the same build context and is not repeated when metrics arrive.
    if (!projectMetrics?.build_id || (currentBuildId && projectMetrics.build_id !== currentBuildId)) return
    loadSharedReportHistory()
  }, [loadSharedReportHistory, projectMetrics?.build_id])
  const openShareModal = async () => {
    const isCurrent = captureContext()
    if (!canShareReports) { showFeedback(t('reportes.sharedReportsPremiumTitle'), t('reportes.sharedReportsHistoryPremium'), 'info'); return }
    if (!canViewSharedReports) {
      setSharedReport(null); setShareAcknowledged(false); setShowShareModal(true); return
    }
    const selectedBuildId = currentBuildId || projectMetrics?.build_id
    const historyIsCurrent = sharedReportHistoryBuildId && normalizeId(sharedReportHistoryBuildId) === normalizeId(selectedBuildId)
    const result = historyIsCurrent
      ? { items: sharedReportHistory, buildId: sharedReportHistoryBuildId, error: Boolean(sharedHistoryError) }
      : await loadSharedReportHistory()
    if (!isCurrent() || result.error) return
    const reusable = findReusableSharedReport(result.items, result.buildId)
    setSharedReport(reusable ? normalizeSharedReportFromHistory(reusable) : null); setShareAcknowledged(false); setShowShareModal(true)
  }
  const shareReport = async () => {
    const isCurrent = captureContext()
    if (!canShareReports) { showFeedback(t('reportes.sharedReportsPremiumTitle'), t('reportes.shareReportsPremium'), 'info'); return }
    if (!currentProjectId || !projectMetrics) { showFeedback(t('reportes.noMetrics'), t('reportes.noMetricsToShare'), 'warning'); return }
    if (!buildDefinition) { showFeedback(t('reportes.decisionRequired'), t('reportes.selectDecision'), 'warning'); return }
    if (buildDefinitionRequiresComment && !qaComment.trim()) { showFeedback(t('reportes.commentRequiredTitle'), t('reportes.commentRequired'), 'warning'); return }
    setSharingReport(true)
    try {
      const response = await retryAfterNetworkError(() => fetchWithAuth(`${API_BASE}/reports/share`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proyecto_id: currentProjectId, build_id: projectMetrics.build_id || currentBuildId || null, requested_report_type: 'all', build_definition: buildDefinition, qa_comment: qaComment.trim() || null }) }), isCurrent)
      if (!response.ok) throw new Error(humanizePremiumError(await response.text()))
      const data = await response.json(); if (!isCurrent()) return; setSharedReport(data); setShareAcknowledged(true); setShowShareModal(true)
      showFeedback(data?.reused ? 'Snapshot reutilizado' : 'Paquete compartible creado', data?.reused ? 'No hubo cambios; se reutilizo el snapshot existente.' : 'Se generaron links Ejecutivo, Desarrollo e Interno.', 'success'); loadSharedReportHistory()
    } catch (error: any) { if (isCurrent()) showFeedback(t('reportes.shareError'), humanizePremiumError(error?.message) || t('reportes.checkPermissionsMetrics'), 'danger')
    } finally { if (isCurrent()) setSharingReport(false) }
  }
  const revokeSharedBundle = async (item: any) => {
    const isCurrent = captureContext()
    if (!canShareReports) return
    const token = item?.tokens?.executive || item?.tokens?.development || item?.tokens?.internal; if (!token) return
    try {
      const response = await fetchWithAuth(`${API_BASE}/reports/share/${token}`, { method: 'DELETE' }); if (!response.ok) throw new Error(humanizePremiumError(await response.text()))
      if (!isCurrent()) return
      showFeedback(t('reportes.packageRevokedTitle'), t('reportes.packageRevoked'), 'success'); loadSharedReportHistory()
    } catch (error: any) { if (isCurrent()) showFeedback(t('reportes.revokeError'), humanizePremiumError(error?.message) || t('reportes.checkUserPermissions'), 'danger') }
  }
  return { sharedHistoryError, sharingReport, setSharingReport, sharedReport, setSharedReport, showShareModal, setShowShareModal, shareAcknowledged, setShareAcknowledged, sharedReportHistory, setSharedReportHistory, sharedReportHistoryBuildId, setSharedReportHistoryBuildId, loadingSharedHistory, showFullSharedHistory, setShowFullSharedHistory, buildDefinition, setBuildDefinition, qaComment, setQaComment, snapshotBugLinks, setSnapshotBugLinks, creatingSnapshotBugId, setCreatingSnapshotBugId, currentReportBuildId, findReusableSharedReport, isCurrentSharedReportReusable, reusableSharedReport, hasOutdatedSharedReport, buildDefinitionRequiresComment, normalizeSharedReportFromHistory, openShareModal, loadSharedReportHistory, shareReport, revokeSharedBundle }
}
