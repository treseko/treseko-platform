import { API_BASE } from '../../app/constants'

export function useProjectReportPresentation(options: any) {
  const { t, fetchWithAuth, showFeedback, handleProjectChange, setActiveTab } = options
  const reportCacheKey = (projectId?: string, buildId?: string) => projectId && buildId ? `${projectId}:${buildId}` : ''
  const metricNumber = (value: any, fallback = 0) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  const clampScore = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value))
  const calculateQaHealth = (metrics: any, fallbackHealth = 0) => {
    if (!metrics) return fallbackHealth > 0
      ? { measured: true, score: Math.round(clampScore(fallbackHealth)), reason: t('proyectos.healthHistorical'), variant: fallbackHealth >= 80 ? 'success' : fallbackHealth >= 50 ? 'warning' : 'danger' }
      : { measured: false, score: 0, reason: t('proyectos.healthExecuteBuild'), variant: 'secondary' }
    const totalAssigned = metricNumber(metrics.total_casos_asignados)
    const totalExecuted = metricNumber(metrics.total_ejecutados)
    if (totalAssigned <= 0 || totalExecuted <= 0) return { measured: false, score: 0, reason: t('proyectos.healthExecuteBuild'), variant: 'secondary' }
    const stats = metrics.stats || {}; const bugs = metrics.bug_metrics || {}; const evidence = metrics.evidence_summary || {}
    const coverage = clampScore(metricNumber(metrics.cobertura_porcentaje)); const successExecuted = clampScore(metricNumber(metrics.exito_sobre_ejecutados_porcentaje))
    const failed = metricNumber(stats.fallados); const blocked = metricNumber(stats.bloqueados); const openBugs = metricNumber(bugs.open); const highOpenBugs = metricNumber(bugs.high_open)
    const bugsWithoutEvidence = metricNumber(bugs.without_evidence); const missingEvidence = Math.max(metricNumber(evidence.missing), bugsWithoutEvidence)
    const evidenceTotal = Math.max(metricNumber(evidence.total), metricNumber(bugs.total), missingEvidence, 1)
    const executionQuality = clampScore(100 - clampScore(((failed + blocked * 2) / totalAssigned) * 100))
    const bugQuality = clampScore(100 - clampScore(highOpenBugs * 35 + Math.max(openBugs - highOpenBugs, 0) * 12))
    const evidenceQuality = clampScore(100 - (missingEvidence / evidenceTotal) * 100)
    let score = Math.round(coverage * 0.4 + successExecuted * 0.3 + executionQuality * 0.15 + bugQuality * 0.1 + evidenceQuality * 0.05)
    const qaState = String(metrics.qa_status?.state || '').toUpperCase()
    if (qaState === 'APROBADO') score = Math.max(score, 90)
    if (blocked > 0 || highOpenBugs > 0) score = Math.min(score, 69)
    if (qaState === 'NO_RECOMENDADO' || qaState === 'BLOQUEADO') score = Math.min(score, 49)
    score = Math.round(clampScore(score))
    const reason = blocked > 0 ? t('proyectos.healthBlocked', { count: blocked }) : highOpenBugs > 0 ? t('proyectos.healthHighBugs', { count: highOpenBugs }) : failed > 0 ? t('proyectos.healthFailed', { count: failed }) : coverage < 90 ? t('proyectos.healthCoverage', { coverage }) : missingEvidence > 0 ? t('proyectos.healthMissingEvidence', { count: missingEvidence }) : t('proyectos.healthBasedOnMetrics')
    return { measured: true, score, reason, variant: score >= 80 ? 'success' : score >= 50 ? 'warning' : 'danger' }
  }
  const latestReportStatus = (item: any) => !item?.activo ? { label: t('proyectos.revoked'), variant: 'dark' } : item?.is_latest ? { label: t('proyectos.current'), variant: 'success' } : { label: t('proyectos.previous'), variant: 'secondary' }
  const proxiedProjectReportUrl = (url: string) => {
    try {
      const parsed = new URL(url, window.location.origin)
      if (parsed.pathname.startsWith('/informes/')) return `${parsed.pathname}${parsed.search}`
      if (parsed.pathname.startsWith('/informes-internos/')) {
        const match = parsed.pathname.match(/^\/informes-internos\/[^/]+\/[^/]+\/[^/]+\/([^/?#]+?)(\.md)?$/)
        return match?.[1] ? `${API_BASE}/reports/internal/${encodeURIComponent(match[1])}${match[2] || ''}` : url
      }
      if (parsed.pathname.startsWith('/s/reports') || parsed.pathname.startsWith('/reports/internal')) return `${API_BASE}${parsed.pathname}${parsed.search}`
    } catch { return url }
    return url
  }
  const frontendProjectReportUrl = (url: string) => {
    try {
      const parsed = new URL(url, window.location.origin)
      if (parsed.pathname.startsWith('/informes/') || parsed.pathname.startsWith('/informes-internos/')) return `${window.location.origin}${parsed.pathname}${parsed.search}`
      if (parsed.pathname.startsWith('/s/reports') || parsed.pathname.startsWith('/reports/internal')) return `${window.location.origin}${API_BASE}${parsed.pathname}${parsed.search}`
    } catch { return url }
    return url
  }
  const isProjectInternalReportUrl = (url: string) => {
    try { const pathname = new URL(url, window.location.origin).pathname; return pathname.startsWith('/reports/internal') || pathname.startsWith('/informes-internos/') } catch { return false }
  }
  const openProjectReportLink = async (url: string, type: string) => {
    if (!url) return
    if (type !== 'internal' && !isProjectInternalReportUrl(url)) { window.open(frontendProjectReportUrl(url), '_blank', 'noopener,noreferrer'); return }
    const reportWindow = window.open('', '_blank')
    if (!reportWindow) { showFeedback?.(t('proyectos.popupBlocked'), t('proyectos.enablePopups'), 'warning'); return }
    reportWindow.opener = null; reportWindow.document.write(`<p style="font-family:Arial,sans-serif;padding:24px">${t('proyectos.openingInternalReport')}</p>`)
    try {
      const response = await fetchWithAuth(proxiedProjectReportUrl(url)); if (!response.ok) throw new Error(await response.text())
      const html = await response.text(); const baseTag = `<base href="${frontendProjectReportUrl(url).replace(/"/g, '&quot;')}">`
      const withBase = html.match(/<head[^>]*>/i) ? html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`) : html
      reportWindow.document.open(); reportWindow.document.write(withBase); reportWindow.document.close(); reportWindow.opener = null
    } catch (error: any) { reportWindow.close(); showFeedback?.(t('proyectos.couldNotOpen'), error?.message || t('proyectos.couldNotOpenSharedReport'), 'danger') }
  }
  const goToReports = (projectId: string) => { handleProjectChange(projectId); setActiveTab?.('reportes') }
  const reportButtonLabel = (type: 'executive' | 'development' | 'internal') => type === 'executive' ? t('proyectos.executive') : type === 'development' ? t('proyectos.development') : t('proyectos.internal')
  return { reportCacheKey, calculateQaHealth, latestReportStatus, openProjectReportLink, goToReports, reportButtonLabel }
}
