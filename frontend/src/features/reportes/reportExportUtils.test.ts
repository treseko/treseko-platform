import assert from 'node:assert/strict'
import test from 'node:test'
import { buildReportTablesHtml } from './reportExportUtils'

const t = (key: string) => key

const baseInput = (overrides: Record<string, unknown> = {}) => ({
  suiteTree: [],
  projectMetrics: {},
  reportStats: {},
  bugMetrics: {},
  t,
  ...overrides,
})

test('export builds summary and visible format metrics for happy path', () => {
  const html = buildReportTablesHtml(baseInput({
    projectMetrics: {
      cobertura_porcentaje: 87.5,
      total_casos_asignados: 8,
      total_ejecutados: 7,
      metricas_por_formato: {
        CLASICA: { total: 5, executed: 4, passed: 3, failed: 1, coverage_percent: 80 },
        PERFORMANCE: { total: 99 },
      },
    },
    reportStats: { pasados: 3, fallados: 1 },
    bugMetrics: { open: 2, total: 4 },
  }))

  assert.match(html, /reportes\.executiveSummary/)
  assert.match(html, /reportes\.formatModeMatrixDescription/)
  assert.match(html, /87\.5%/)
  assert.match(html, /reportes\.formatClassic/)
  assert.doesNotMatch(html, /99/)
})

test('export flattens nested suites and conversational turns', () => {
  const html = buildReportTablesHtml(baseInput({
    suiteTree: [{
      nombre: 'Padre', total: 1, pasados: 1,
      casos: [{ codigo: 'C-1', titulo: 'Chat', formato_prueba: 'CONVERSACIONAL', chatbot: {
        resultado: { turns: [{ index: 1, message: 'Hola', responseText: 'Qué tal', status: 'PASSED', latencyMs: 42 }] },
      } }],
      children: [{ nombre: 'Hija', total: 0, casos: [] }],
    }],
  }))

  assert.match(html, /Padre \/ Hija/)
  assert.match(html, /C-1 - Chat/)
  assert.match(html, /Hola/)
  assert.match(html, /42 ms/)
})

test('export escapes user content and spreadsheet formula prefixes', () => {
  const html = buildReportTablesHtml(baseInput({
    suiteTree: [{
      nombre: '<Suite>', total: 1, casos: [{
        codigo: '=CMD(1)', titulo: '<script>alert(1)</script>', observaciones: '@danger',
      }],
    }],
  }))

  assert.doesNotMatch(html, /<script>alert/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /&#39;=CMD\(1\)/)
  assert.match(html, /&#39;@danger/)
})

test('export tolerates empty and partial metrics with zero defaults', () => {
  const html = buildReportTablesHtml(baseInput({ suiteTree: [{ nombre: 'Vacía' }] }))

  assert.match(html, /reportes\.noBugsForExport/)
  assert.match(html, /reportes\.noBuildHistory/)
  assert.match(html, /reportes\.noConversationalTurnsForExport/)
  assert.match(html, />0%<|>0<\/td>/)
})

test('export maps failure statuses and omits performance cases', () => {
  const html = buildReportTablesHtml(baseInput({
    suiteTree: [{ nombre: 'Suite', casos: [
      { codigo: 'FAIL', titulo: 'Falla', estado: 'TIMEOUT' },
      { codigo: 'PERF', titulo: 'Carga', formato_prueba: 'PERFORMANCE' },
    ] }],
  }))

  assert.match(html, /reportes\.failed/)
  assert.doesNotMatch(html, /PERF/)
})
