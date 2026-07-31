import { formatDateTime } from '../../shared/utils/dateTime'
import { escapeHtml, escapeSpreadsheetHtmlCell } from '../../shared/utils/exportSecurity'
import { formatBugPriorityOption } from '../bugs/bugPresentation'

type Translate = (key: string) => string

type ReportExportInput = {
  suiteTree: any[]
  projectMetrics: any
  reportStats: any
  bugMetrics: any
  t: Translate
}

type SuiteExportRow = Record<string, any>

const flattenSuiteRows = (nodes: any[], t: Translate, parent = ''): SuiteExportRow[] => nodes.flatMap((node: any) => {
  const suiteName = parent ? `${parent} / ${node.nombre}` : node.nombre
  const suiteRows = [{
    tipo: 'Suite', suite: suiteName, codigo: '', titulo: '', estado: '', prioridad: '', modo: '',
    total: node.total, pasados: node.pasados, fallados: node.fallados, bloqueados: node.bloqueados,
    pendientes: node.pendientes || 0,
    tasa: Number(node.total || 0) > 0 ? `${((Number(node.pasados || 0) / Number(node.total || 1)) * 100).toFixed(1)}%` : '0.0%',
    fecha: '', ejecutado_por: '', observaciones: '',
  }]
  const caseRows = (node.casos || []).map((caso: any) => ({
    tipo: t('common.case'), suite: caso.suite_breadcrumb || suiteName, codigo: caso.codigo || '', titulo: caso.titulo || '',
    estado: caso.estado || '', prioridad: caso.prioridad || '', modo: caso.execution_mode || '', total: '', pasados: '',
    fallados: '', bloqueados: '', pendientes: '', tasa: '', fecha: caso.fecha_ejecucion ? formatDateTime(caso.fecha_ejecucion) : '',
    ejecutado_por: caso.ejecutado_por || '', observaciones: caso.observaciones || '',
  }))
  return [...suiteRows, ...caseRows, ...flattenSuiteRows(node.children || [], t, suiteName)]
})

export function buildReportTablesHtml({ suiteTree, projectMetrics, reportStats, bugMetrics, t }: ReportExportInput) {
  const suiteRows = flattenSuiteRows(suiteTree, t)
  const priorityRows = Object.entries(projectMetrics?.por_prioridad || {})
  const historyRows = projectMetrics?.historico_versions || []
  const summaryRows = [
    [t('reportes.coverage'), `${projectMetrics?.cobertura_porcentaje ?? 0}%`],
    [t('reportes.assignedCases'), projectMetrics?.total_casos_asignados ?? 0],
    [t('reportes.executedCases'), projectMetrics?.total_ejecutados ?? 0],
    [t('reportes.passed'), reportStats.pasados ?? 0], [t('reportes.failed'), reportStats.fallados ?? 0],
    [t('reportes.blocked'), reportStats.bloqueados ?? 0], [t('reportes.pending'), reportStats.pendientes ?? 0],
    [t('reportes.openBugs'), bugMetrics.open ?? 0], [t('reportes.totalBugs'), bugMetrics.total ?? 0],
  ]
  return `
    <h2>${t('reportes.executiveSummary')}</h2>
    <table><tbody>${summaryRows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeSpreadsheetHtmlCell(value)}</td></tr>`).join('')}</tbody></table>
    <h2>${t('reportes.resultsByPriority')}</h2>
    <table><thead><tr><th>${t('reportes.priority')}</th><th>${t('reportes.total')}</th><th>${t('reportes.passed')}</th><th>${t('reportes.failed')}</th><th>${t('reportes.blocked')}</th><th>${t('reportes.notExecuted')}</th></tr></thead><tbody>
      ${priorityRows.length ? priorityRows.map(([prioridad, data]: [string, any]) => `<tr><td>${escapeSpreadsheetHtmlCell(formatBugPriorityOption(prioridad))}</td><td>${escapeSpreadsheetHtmlCell(data.total)}</td><td>${escapeSpreadsheetHtmlCell(data.pasados)}</td><td>${escapeSpreadsheetHtmlCell(data.fallados)}</td><td>${escapeSpreadsheetHtmlCell(data.bloqueados)}</td><td>${escapeSpreadsheetHtmlCell(data.pendientes || 0)}</td></tr>`).join('') : `<tr><td colspan="6">${t('reportes.noBugsForExport')}</td></tr>`}
    </tbody></table>
    <h2>${t('reportes.suitesAndCases')}</h2>
    <table><thead><tr><th>${t('reportes.type')}</th><th>${t('reportes.suite')}</th><th>${t('reportes.code')}</th><th>${t('reportes.title')}</th><th>${t('reportes.status')}</th><th>${t('reportes.priority')}</th><th>${t('reportes.executionMode')}</th><th>${t('reportes.total')}</th><th>${t('reportes.passed')}</th><th>${t('reportes.failed')}</th><th>${t('reportes.blocked')}</th><th>${t('reportes.pending')}</th><th>${t('reportes.resolutionRate')}</th><th>${t('reportes.date')}</th><th>${t('reportes.executedBy')}</th><th>${t('reportes.observations')}</th></tr></thead><tbody>
      ${suiteRows.length ? suiteRows.map(row => `<tr><td>${escapeSpreadsheetHtmlCell(row.tipo)}</td><td>${escapeSpreadsheetHtmlCell(row.suite)}</td><td>${escapeSpreadsheetHtmlCell(row.codigo)}</td><td>${escapeSpreadsheetHtmlCell(row.titulo)}</td><td>${escapeSpreadsheetHtmlCell(row.estado)}</td><td>${escapeSpreadsheetHtmlCell(formatBugPriorityOption(row.prioridad))}</td><td>${escapeSpreadsheetHtmlCell(row.modo)}</td><td>${escapeSpreadsheetHtmlCell(row.total)}</td><td>${escapeSpreadsheetHtmlCell(row.pasados)}</td><td>${escapeSpreadsheetHtmlCell(row.fallados)}</td><td>${escapeSpreadsheetHtmlCell(row.bloqueados)}</td><td>${escapeSpreadsheetHtmlCell(row.pendientes)}</td><td>${escapeSpreadsheetHtmlCell(row.tasa)}</td><td>${escapeSpreadsheetHtmlCell(row.fecha)}</td><td>${escapeSpreadsheetHtmlCell(row.ejecutado_por)}</td><td>${escapeSpreadsheetHtmlCell(row.observaciones)}</td></tr>`).join('') : `<tr><td colspan="16">${t('reportes.noSuiteCasesForExport')}</td></tr>`}
    </tbody></table>
    <h2>${t('reportes.trendByBuild')}</h2>
    <table><thead><tr><th>${t('reportes.build')}</th><th>${t('reportes.passed')}</th><th>${t('reportes.failed')}</th><th>${t('reportes.blocked')}</th><th>${t('reportes.coverage')}</th></tr></thead><tbody>
      ${historyRows.length ? historyRows.map((item: any) => `<tr><td>${escapeSpreadsheetHtmlCell(item.build_name || item.nombre || '')}</td><td>${escapeSpreadsheetHtmlCell(item.pasados)}</td><td>${escapeSpreadsheetHtmlCell(item.fallados)}</td><td>${escapeSpreadsheetHtmlCell(item.bloqueados)}</td><td>${escapeSpreadsheetHtmlCell(item.cobertura_porcentaje ?? item.cobertura ?? '')}</td></tr>`).join('') : `<tr><td colspan="5">${t('reportes.noBuildHistory')}</td></tr>`}
    </tbody></table>
  `
}
