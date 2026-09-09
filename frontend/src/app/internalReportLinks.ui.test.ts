// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { normalizeInternalReportBugLinks } from './internalReportLinks'

describe('internal report bug links', () => {
  it('preserves the developer destination and exact bug across frontend ports', () => {
    const html = '<a class="report-action-link" target="_blank" href="http://127.0.0.1:5173/?tab=incidencias&bug_id=bug-9">Abrir incidencia</a>'
    const normalized = normalizeInternalReportBugLinks(html, 'http://localhost:5174')
    expect(normalized).toContain('href="/?tab=incidencias&amp;bug_id=bug-9"')
    expect(normalized).toContain('target="_blank"')
  })
  it('converts persisted local deep links to portable relative paths', () => {
    const html = '<html><body><a href="http://127.0.0.1:5173/?tab=bugs&bug_id=bug-1">Ver bug</a></body></html>'
    const normalized = normalizeInternalReportBugLinks(html, 'http://127.0.0.1:5174')

    expect(normalized).toContain('href="/?tab=bugs&amp;bug_id=bug-1"')
    expect(normalized).not.toContain('127.0.0.1:5173')
  })

  it('keeps unrelated external links unchanged', () => {
    const html = '<html><body><a href="https://example.com/?tab=bugs&bug_id=bug-1">External</a></body></html>'

    expect(normalizeInternalReportBugLinks(html, 'http://127.0.0.1:5174')).toContain('href="https://example.com/?tab=bugs&amp;bug_id=bug-1"')
  })

  it('also adapts an internal report link generated with an old IP', () => {
    const html = '<html><body><a class="report-action-link" href="http://192.168.1.20:5173/?tab=bugs&bug_id=bug-2">Ver bug</a></body></html>'

    const normalized = normalizeInternalReportBugLinks(html, 'http://192.168.1.21:5174')

    expect(normalized).toContain('href="/?tab=bugs&amp;bug_id=bug-2"')
    expect(normalized).not.toContain('192.168.1.20')
  })
})
