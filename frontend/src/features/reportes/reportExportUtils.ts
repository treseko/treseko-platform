import { formatDateTime } from '../../shared/utils/dateTime'
import { escapeHtml, escapeSpreadsheetHtmlCell } from '../../shared/utils/exportSecurity'
import { REPORT_VISIBLE_FORMATS, isReportVisibleFormat } from './reportFormatVisibility'

type Translate = (key: string) => string

type ReportExportInput = {
  suiteTree: any[]
  projectMetrics: any
  reportStats: any
  bugMetrics: any
  t: Translate
}

type SuiteExportRow = Record<string, any>

const normalizedLabelValue = (value: unknown) => String(value || '').trim().toUpperCase()

const formatLabel = (value: string, t: Translate) => ({
  CLASICA: t('reportes.formatClassic'), CONVERSACIONAL: t('reportes.formatConversational'), API: t('reportes.formatApi'),
}[normalizedLabelValue(value)] || value)

const modeLabel = (value: string, t: Translate) => ({
  MANUAL: t('reportes.modeManual'), AUTOMATIZADA: t('reportes.modeAutomated'), AUTOMATED: t('reportes.modeAutomated'),
  IA: t('reportes.modeAi'), AI: t('reportes.modeAi'), EXTERNA: t('reportes.modeExternal'), EXTERNAL: t('reportes.modeExternal'),
  MIXTO: t('historial.mixedLabel'), MIXED: t('historial.mixedLabel'), SIN_EJECUTAR: t('reportes.modeNotExecuted'), NOT_EXECUTED: t('reportes.modeNotExecuted'),
}[normalizedLabelValue(value)] || value)

const resultLabel = (value: string | undefined, t: Translate) => {
  const normalized = normalizedLabelValue(value)
  if (['PASO', 'OK', 'PASSED'].includes(normalized)) return t('reportes.passed')
  if (['FALLO', 'FALLIDO', 'FAILED'].includes(normalized)) return t('reportes.failed')
  if (['BLOQUEADO', 'BLOCKED'].includes(normalized)) return t('reportes.blocked')
  if (['SIN_CORRER', 'NO_EJECUTADO', 'NOT_RUN', 'NOT_EXECUTED', 'SKIPPED'].includes(normalized)) return t('reportes.notExecuted')
  if (['FATAL', 'ERROR', 'TIMEOUT'].includes(normalized)) return t('reportes.failed')
  if (['REQUIERE_REVISION', 'PENDING_REVIEW'].includes(normalized)) return t('historial.pendingReview')
  if (['EN_PROGRESO', 'EN_CURSO', 'IN_PROGRESS', 'RUNNING', 'EJECUTANDO', 'EJECUTANDO_AI'].includes(normalized)) return t('historial.inProgress')
  return value || t('reportes.statusNotReported')
}

const priorityLabel = (value: string, t: Translate) => ({
  P0: t('reportes.priorityUrgent'), P1: t('reportes.priorityHigh'), P2: t('reportes.priorityMedium'),
  P3: t('reportes.priorityLow'), P4: t('reportes.priorityMinimal'),
}[String(value || '').toUpperCase()] || value)

const flattenSuiteRows = (nodes: any[], t: Translate, parent = ''): SuiteExportRow[] => nodes.flatMap((node: any) => {
  const suiteName = parent ? `${parent} / ${node.nombre}` : node.nombre
  const suiteRows = [{
    tipo: t('reportes.suiteType'), suite: suiteName, codigo: '', titulo: '', estado: '', prioridad: '', modo: '',
    total: node.total, pasados: node.pasados, fallados: node.fallados, bloqueados: node.bloqueados,
    pendientes: node.pendientes || 0,
    tasa: Number(node.total || 0) > 0 ? `${((Number(node.pasados || 0) / Number(node.total || 1)) * 100).toFixed(1)}%` : '0.0%',
    fecha: '', ejecutado_por: '', observaciones: '',
  }]
  const caseRows = (node.casos || []).map((caso: any) => ({
    tipo: t('common.case'), suite: caso.suite_breadcrumb || suiteName, codigo: caso.codigo || '', titulo: caso.titulo || '',
    estado: caso.estado || '', prioridad: caso.prioridad || '', modo: caso.execution_mode || '', formato: caso.formato_prueba || 'CLASICA', total: '', pasados: '',
    fallados: '', bloqueados: '', pendientes: '', tasa: '', fecha: caso.fecha_ejecucion ? formatDateTime(caso.fecha_ejecucion) : '',
    ejecutado_por: caso.ejecutado_por || '', observaciones: caso.observaciones || '', chatbot: caso.chatbot || null,
  }))
  return [...suiteRows, ...caseRows, ...flattenSuiteRows(node.children || [], t, suiteName)]
})

export function buildReportTablesHtml({ suiteTree, projectMetrics, reportStats, bugMetrics, t }: ReportExportInput) {
  const suiteRows = flattenSuiteRows(suiteTree, t).filter(
    (row) => !row.formato || isReportVisibleFormat(row.formato),
  )
  const priorityRows = Object.entries(projectMetrics?.por_prioridad || {})
  const historyRows = projectMetrics?.historico_versions || []
  const formatMetrics = projectMetrics?.metricas_por_formato || {}
  const formatRows = Object.entries(formatMetrics).filter(([format]) => isReportVisibleFormat(format))
  const formatModeMatrix = projectMetrics?.metricas_por_formato_y_modo || {}
  const matrixFormats = REPORT_VISIBLE_FORMATS
  const matrixModes = ['MANUAL', 'AUTOMATIZADA', 'IA', 'EXTERNA', 'SIN_EJECUTAR']
  const conversationalRows = suiteRows.flatMap((row: any) => {
    const turns = row.chatbot?.resultado?.turns || row.chatbot?.transcription || []
    return turns.map((turn: any, index: number) => ({
      caso: `${row.codigo} - ${row.titulo}`,
      turno: Number(turn.index || turn.turn_number || index + 1),
      mensaje: turn.message || turn.request?.body?.message || '',
      respuesta: turn.responseText || turn.response_text || turn.response?.message || '',
      esperado: turn.expected || turn.resultado_esperado || '',
      estado: turn.status || t('common.notAvailable'),
      http: turn.statusCode || turn.status_code || '',
      latencia: turn.latencyMs || turn.latency_ms || 0,
    }))
  })
  const summaryRows = [
    [t('reportes.coverage'), `${projectMetrics?.cobertura_porcentaje ?? 0}%`],
    [t('reportes.assignedCases'), projectMetrics?.total_casos_asignados ?? 0],
    [t('reportes.executedCases'), projectMetrics?.total_ejecutados ?? 0],
    [t('reportes.passed'), reportStats.pasados ?? 0], [t('reportes.failed'), reportStats.fallados ?? 0],
    [t('reportes.blocked'), reportStats.bloqueados ?? 0], [t('reportes.pending'), reportStats.pendientes ?? 0],
    [t('reportes.openBugs'), bugMetrics.open ?? 0], [t('reportes.totalBugs'), bugMetrics.total ?? 0],
    [t('reportes.conversationalCases'), formatMetrics.CONVERSACIONAL?.total ?? 0],
    [t('reportes.conversationalTurns'), formatMetrics.CONVERSACIONAL?.specific?.turns ?? 0],
    [t('reportes.apiCases'), formatMetrics.API?.total ?? 0],
    [t('reportes.apiRequests'), formatMetrics.API?.specific?.requests ?? 0],
    [t('reportes.apiHttpErrors'), formatMetrics.API?.specific?.http_errors ?? 0],
  ]
  return `
    <h2>${t('reportes.executiveSummary')}</h2>
    <table><tbody>${summaryRows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeSpreadsheetHtmlCell(value)}</td></tr>`).join('')}</tbody></table>
    <h2>${t('reportes.resultsByPriority')}</h2>
    <table><thead><tr><th>${t('reportes.priority')}</th><th>${t('reportes.total')}</th><th>${t('reportes.passed')}</th><th>${t('reportes.failed')}</th><th>${t('reportes.blocked')}</th><th>${t('reportes.notExecuted')}</th></tr></thead><tbody>
      ${priorityRows.length ? priorityRows.map(([prioridad, data]: [string, any]) => `<tr><td>${escapeSpreadsheetHtmlCell(priorityLabel(prioridad, t))}</td><td>${escapeSpreadsheetHtmlCell(data.total)}</td><td>${escapeSpreadsheetHtmlCell(data.pasados)}</td><td>${escapeSpreadsheetHtmlCell(data.fallados)}</td><td>${escapeSpreadsheetHtmlCell(data.bloqueados)}</td><td>${escapeSpreadsheetHtmlCell(data.pendientes || 0)}</td></tr>`).join('') : `<tr><td colspan="6">${t('reportes.noBugsForExport')}</td></tr>`}
    </tbody></table>
    <h2>${t('reportes.suitesAndCases')}</h2>
     ${suiteRows.length ? suiteRows.map(row => `<tr><td>${escapeSpreadsheetHtmlCell(row.tipo)}</td><td>${escapeSpreadsheetHtmlCell(row.suite)}</td><td>${escapeSpreadsheetHtmlCell(row.codigo)}</td><td>${escapeSpreadsheetHtmlCell(row.titulo)}</td><td>${escapeSpreadsheetHtmlCell(resultLabel(row.estado, t))}</td><td>${escapeSpreadsheetHtmlCell(priorityLabel(row.prioridad, t))}</td><td>${escapeSpreadsheetHtmlCell(modeLabel(row.modo || '', t))}</td><td>${escapeSpreadsheetHtmlCell(row.total)}</td><td>${escapeSpreadsheetHtmlCell(row.pasados)}</td><td>${escapeSpreadsheetHtmlCell(row.fallados)}</td><td>${escapeSpreadsheetHtmlCell(row.bloqueados)}</td><td>${escapeSpreadsheetHtmlCell(row.pendientes)}</td><td>${escapeSpreadsheetHtmlCell(row.tasa)}</td><td>${escapeSpreadsheetHtmlCell(row.fecha)}</td><td>${escapeSpreadsheetHtmlCell(row.ejecutado_por)}</td><td>${escapeSpreadsheetHtmlCell(row.observaciones)}</td></tr>`).join('') : `<tr><td colspan="16">${t('reportes.noSuiteCasesForExport')}</td></tr>`}
    <table><thead><tr><th>${t('reportes.type')}</th><th>${t('reportes.suite')}</th><th>${t('reportes.code')}</th><th>${t('reportes.title')}</th><th>${t('reportes.status')}</th><th>${t('reportes.priority')}</th><th>${t('reportes.format')}</th><th>${t('reportes.executionMode')}</th><th>${t('reportes.total')}</th><th>${t('reportes.passed')}</th><th>${t('reportes.failed')}</th><th>${t('reportes.blocked')}</th><th>${t('reportes.pending')}</th><th>${t('reportes.resolutionRate')}</th><th>${t('reportes.date')}</th><th>${t('reportes.executedBy')}</th><th>${t('reportes.observations')}</th></tr></thead><tbody>
      ${suiteRows.length ? suiteRows.map(row => `<tr><td>${escapeSpreadsheetHtmlCell(row.tipo)}</td><td>${escapeSpreadsheetHtmlCell(row.suite)}</td><td>${escapeSpreadsheetHtmlCell(row.codigo)}</td><td>${escapeSpreadsheetHtmlCell(row.titulo)}</td><td>${escapeSpreadsheetHtmlCell(resultLabel(row.estado, t))}</td><td>${escapeSpreadsheetHtmlCell(priorityLabel(row.prioridad, t))}</td><td>${escapeSpreadsheetHtmlCell(formatLabel(row.formato || '', t))}</td><td>${escapeSpreadsheetHtmlCell(modeLabel(row.modo || '', t))}</td><td>${escapeSpreadsheetHtmlCell(row.total)}</td><td>${escapeSpreadsheetHtmlCell(row.pasados)}</td><td>${escapeSpreadsheetHtmlCell(row.fallados)}</td><td>${escapeSpreadsheetHtmlCell(row.bloqueados)}</td><td>${escapeSpreadsheetHtmlCell(row.pendientes)}</td><td>${escapeSpreadsheetHtmlCell(row.tasa)}</td><td>${escapeSpreadsheetHtmlCell(row.fecha)}</td><td>${escapeSpreadsheetHtmlCell(row.ejecutado_por)}</td><td>${escapeSpreadsheetHtmlCell(row.observaciones)}</td></tr>`).join('') : `<tr><td colspan="17">${t('reportes.noSuiteCasesForExport')}</td></tr>`}
    </tbody></table>
    <h2>${t('reportes.formatMetrics')}</h2>
    <table><thead><tr><th>${t('reportes.format')}</th><th>${t('reportes.metricsStatus')}</th><th>${t('reportes.cases')}</th><th>${t('reportes.executed')}</th><th>${t('reportes.passed')}</th><th>${t('reportes.failed')}</th><th>${t('reportes.blocked')}</th><th>${t('reportes.coverage')}</th><th>${t('reportes.executedSuccess')}</th></tr></thead><tbody>
      ${formatRows.map(([format, data]: [string, any]) => `<tr><td>${escapeSpreadsheetHtmlCell(formatLabel(format, t))}</td><td>${escapeSpreadsheetHtmlCell(resultLabel(data.status, t))}</td><td>${escapeSpreadsheetHtmlCell(data.total)}</td><td>${escapeSpreadsheetHtmlCell(data.executed)}</td><td>${escapeSpreadsheetHtmlCell(data.passed)}</td><td>${escapeSpreadsheetHtmlCell(data.failed)}</td><td>${escapeSpreadsheetHtmlCell(data.blocked)}</td><td>${escapeSpreadsheetHtmlCell(`${Number(data.coverage_percent || 0).toFixed(1)}%`)}</td><td>${escapeSpreadsheetHtmlCell(`${Number(data.success_executed_percent || 0).toFixed(1)}%`)}</td></tr>`).join('') || `<tr><td colspan="9">${t('reportes.noFormatMetricsForExport')}</td></tr>`}
    </tbody></table>
    <h2>${t('reportes.formatModeMatrix')}</h2>
    <table><thead><tr><th>${t('reportes.format')}</th>${matrixModes.map(mode => `<th>${escapeSpreadsheetHtmlCell(modeLabel(mode, t))}</th>`).join('')}<th>${t('reportes.total')}</th></tr></thead><tbody>
      ${matrixFormats.map(format => {
        const total = matrixModes.reduce((sum, mode) => sum + Number(formatModeMatrix?.[format]?.[mode]?.total || 0), 0)
        return `<tr><th>${escapeSpreadsheetHtmlCell(formatLabel(format, t))}</th>${matrixModes.map(mode => `<td>${escapeSpreadsheetHtmlCell(formatModeMatrix?.[format]?.[mode]?.total || 0)}</td>`).join('')}<td>${escapeSpreadsheetHtmlCell(total)}</td></tr>`
      }).join('') || `<tr><td colspan="7">${t('reportes.noFormatModeMatrixForExport')}</td></tr>`}
    </tbody></table>
    <h2>${t('reportes.conversationalDetail')}</h2>
    <p>${t('reportes.conversationalExportDescription')}</p>
    <table><thead><tr><th>${t('reportes.case')}</th><th>${t('reportes.turn')}</th><th>${t('reportes.sentMessage')}</th><th>${t('reportes.receivedResponse')}</th><th>${t('reportes.expected')}</th><th>${t('reportes.status')}</th><th>HTTP</th><th>${t('reportes.latency')}</th></tr></thead><tbody>
      ${conversationalRows.map((row: any) => `<tr><td>${escapeSpreadsheetHtmlCell(row.caso)}</td><td>${escapeSpreadsheetHtmlCell(row.turno)}</td><td>${escapeSpreadsheetHtmlCell(row.mensaje)}</td><td>${escapeSpreadsheetHtmlCell(row.respuesta)}</td><td>${escapeSpreadsheetHtmlCell(row.esperado)}</td><td>${escapeSpreadsheetHtmlCell(resultLabel(row.estado, t))}</td><td>${escapeSpreadsheetHtmlCell(row.http)}</td><td>${escapeSpreadsheetHtmlCell(`${row.latencia} ms`)}</td></tr>`).join('') || `<tr><td colspan="8">${t('reportes.noConversationalTurnsForExport')}</td></tr>`}
    </tbody></table>
    <h2>${t('reportes.trendByBuild')}</h2>
    <table><thead><tr><th>${t('reportes.build')}</th><th>${t('reportes.passed')}</th><th>${t('reportes.failed')}</th><th>${t('reportes.blocked')}</th><th>${t('reportes.coverage')}</th></tr></thead><tbody>
      ${historyRows.length ? historyRows.map((item: any) => `<tr><td>${escapeSpreadsheetHtmlCell(item.build_name || item.nombre || '')}</td><td>${escapeSpreadsheetHtmlCell(item.pasados)}</td><td>${escapeSpreadsheetHtmlCell(item.fallados)}</td><td>${escapeSpreadsheetHtmlCell(item.bloqueados)}</td><td>${escapeSpreadsheetHtmlCell(item.cobertura_porcentaje ?? item.cobertura ?? '')}</td></tr>`).join('') : `<tr><td colspan="5">${t('reportes.noBuildHistory')}</td></tr>`}
    </tbody></table>
  `
}
