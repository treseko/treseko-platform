import { openInNewTab } from '../../shared/utils/openExternal'
import { escapeHtml } from '../../shared/utils/exportSecurity'
import { API_BASE } from '../../app/constants'

export function useSharedReportActions(options: any) {
  const { t, fetchWithAuth, showFeedback, isInternalReportUrl, proxiedReportUrl, frontendReportUrl, sharedMarkdownUrl, sharedReportFilename, sharedReport, setSnapshotBugLinks, setCreatingSnapshotBugId, downloadTextFile } = options
  const copyLink = async (link?: string, label = 'Link') => {
    if (!link) return
    await navigator.clipboard?.writeText(link)
    showFeedback(t('reportes.copied'), t('reportes.copiarPortapapeles', { label }), 'success')
  }
  const openSharedReport = async (url?: string, label = 'Informe') => {
    if (!url) return
    if (!isInternalReportUrl(url)) { openInNewTab(proxiedReportUrl(url)); return }
    const reportWindow = window.open('', '_blank')
    if (!reportWindow) { showFeedback(t('reportes.popupBlocked'), t('reportes.popupBlockedShareMessage'), 'warning'); return }
    reportWindow.opener = null; reportWindow.document.write(`<p style="font-family:Arial,sans-serif;padding:24px">${t('reportes.openingInternalReport')}</p>`)
    try {
      const response = await fetchWithAuth(proxiedReportUrl(url)); if (!response.ok) throw new Error(await response.text())
      const html = await response.text(); const baseTag = `<base href="${escapeHtml(frontendReportUrl(url))}">`
      const withBase = html.match(/<head[^>]*>/i) ? html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`) : html
      reportWindow.document.open(); reportWindow.document.write(withBase); reportWindow.document.close(); reportWindow.opener = null
    } catch (error: any) { reportWindow.close(); showFeedback(t('reportes.openError'), error?.message || t('reportes.openReportError', { label }), 'danger') }
  }
  const downloadSharedMarkdown = async (report: any, type: string, label: string) => {
    const url = sharedMarkdownUrl(report, type); if (!url) return
    try {
      const response = await fetchWithAuth(proxiedReportUrl(url)); if (!response.ok) throw new Error(await response.text())
      downloadTextFile(await response.text(), sharedReportFilename(type, 'md'), 'text/markdown;charset=utf-8')
      showFeedback(t('reportes.markdownGeneratedTitle'), t('reportes.markdownGenerated', { label }), 'success')
    } catch (error: any) { showFeedback(t('reportes.markdownError'), error?.message || t('reportes.checkReportLink'), 'danger') }
  }
  const createBugFromReportSnapshot = async (snapshot: any) => {
    if (!snapshot?.id) return
    setCreatingSnapshotBugId(snapshot.id)
    try {
      const note = snapshot.comentarios || snapshot.error_log || ''
      const response = await fetchWithAuth(`${API_BASE}/snapshots/${snapshot.id}/bugs/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resultado_obtenido: note || 'Fallo observado desde Reportes y Metricas.', notas_qa: note || null }) })
      if (!response.ok) throw new Error(await response.text())
      const bug = await response.json(); setSnapshotBugLinks((current: any) => ({ ...current, [snapshot.id]: bug }))
      showFeedback(t('reportes.bugCreatedTitle'), t('reportes.bugCreated', { code: bug.codigo }), 'success')
    } catch (error: any) { showFeedback(t('reportes.createBugError'), error?.message || t('reportes.checkBugPermissions'), 'danger')
    } finally { setCreatingSnapshotBugId(null) }
  }
  const exportSharedReportPdf = async (url: string, type: string, label: string) => {
    if (!url) return
    const printWindow = window.open('', '_blank')
    if (!printWindow) { showFeedback(t('reportes.popupBlocked'), t('reportes.popupBlockedPdfMessage'), 'warning'); return }
    printWindow.opener = null; printWindow.document.write(`<p style="font-family:Arial,sans-serif;padding:24px">${t('reportes.preparingPdf')}</p>`)
    try {
      const response = await fetchWithAuth(proxiedReportUrl(url)); if (!response.ok) throw new Error(await response.text())
      const html = await response.text(); const baseTag = `<base href="${escapeHtml(frontendReportUrl(url))}">`; const printScript = '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},300);});</script>'
      const withBase = html.match(/<head[^>]*>/i) ? html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`) : html
      const printableHtml = withBase.match(/<\/body>/i) ? withBase.replace(/<\/body>/i, `${printScript}</body>`) : `${withBase}${printScript}`
      printWindow.document.open(); printWindow.document.write(printableHtml); printWindow.document.close(); printWindow.opener = null
      showFeedback(t('reportes.pdfExportTitle'), t('reportes.pdfReportOpened', { label }), 'success')
    } catch (error: any) { printWindow.close(); showFeedback(t('reportes.pdfExportError'), error?.message || t('reportes.checkReportLink'), 'danger') }
  }
  return { copyLink, openSharedReport, downloadSharedMarkdown, createBugFromReportSnapshot, exportSharedReportPdf }
}
