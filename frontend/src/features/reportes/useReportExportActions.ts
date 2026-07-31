import { formatDateTime } from '../../shared/utils/dateTime'
import { escapeHtml } from '../../shared/utils/exportSecurity'
import { buildReportTablesHtml } from './reportExportUtils'

export function useReportExportActions(options: any) {
  const { t, projectMetrics, currentBuildId, suiteTree, reportStats, bugMetrics, showFeedback } = options
  const reportFilename = (extension: string) => {
    const projectPart = String(projectMetrics?.project_name || projectMetrics?.proyecto || 'reporte-qa').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'reporte-qa'
    const buildPart = String(projectMetrics?.build_name || projectMetrics?.build || currentBuildId || 'build').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'build'
    return `${projectPart}-${buildPart}.${extension}`
  }
  const sharedReportFilename = (type: string, extension: string) => reportFilename(extension).replace(`.${extension}`, `-${type === 'executive' ? 'ejecutivo' : type === 'development' ? 'desarrollo' : 'interno'}.${extension}`)
  const downloadTextFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url)
  }
  const exportPdfReport = () => {
    if (!projectMetrics) { showFeedback(t('reportes.noMetrics'), t('reportes.noDataForExport'), 'warning'); return }
    const printWindow = window.open('', '_blank')
    if (!printWindow) { showFeedback(t('reportes.popupBlocked'), t('reportes.popupBlockedPdfMessage'), 'warning'); return }
    printWindow.opener = null
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(reportFilename('pdf'))}</title><style>body{font-family:Arial,sans-serif;color:#111827;margin:32px;background:#fff}h1{font-size:24px;margin:0 0 6px}h2{font-size:16px;margin:24px 0 8px;color:#1d4ed8}.meta{color:#64748b;font-size:12px;margin-bottom:18px}table{width:100%;border-collapse:collapse;margin-bottom:18px;font-size:12px}th,td{border:1px solid #dbe3ef;padding:6px;text-align:left;vertical-align:top}th{background:#eef4ff;color:#334155}@media print{body{margin:14mm}button{display:none}}</style></head><body><h1>${t('reportes.qualityAnalyticalReport')}</h1><div class="meta">Build: ${escapeHtml(projectMetrics?.build_name || projectMetrics?.build || currentBuildId || 'N/D')}<br/>Generado: ${escapeHtml(formatDateTime(new Date().toISOString()))}</div>${buildReportTablesHtml({ suiteTree, projectMetrics, reportStats, bugMetrics, t })}<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},250);});</script></body></html>`
    printWindow.document.open(); printWindow.document.write(html); printWindow.document.close(); printWindow.opener = null; showFeedback(t('reportes.pdfExportTitle'), t('reportes.pdfExportMessage'), 'success')
  }
  const exportExcelReport = () => {
    if (!projectMetrics) { showFeedback(t('reportes.noMetrics'), t('reportes.noDataForExport'), 'warning'); return }
    const html = `<!doctype html><html><head><meta charset="utf-8"/><style>table{border-collapse:collapse}th,td{border:1px solid #999;padding:5px}th{background:#d9eaf7;font-weight:bold}</style></head><body><h1>${t('reportes.qualityAnalyticalReport')}</h1><p>${t('reportes.build')}: ${escapeHtml(projectMetrics?.build_name || projectMetrics?.build || currentBuildId || 'N/D')}</p>${buildReportTablesHtml({ suiteTree, projectMetrics, reportStats, bugMetrics, t })}</body></html>`
    downloadTextFile(`\ufeff${html}`, reportFilename('xls'), 'application/vnd.ms-excel;charset=utf-8'); showFeedback(t('reportes.xlsExportTitle'), t('reportes.xlsExportMessage'), 'success')
  }
  return { reportFilename, sharedReportFilename, downloadTextFile, exportPdfReport, exportExcelReport }
}
