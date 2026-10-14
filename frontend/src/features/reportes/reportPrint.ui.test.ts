import { afterEach, describe, expect, it, vi } from 'vitest'
import { useReportExportActions } from './useReportExportActions'

afterEach(() => vi.restoreAllMocks())
const options = () => ({ t: (key: string) => key, projectMetrics: { build_name: 'QA <script>' }, currentBuildId: 'build', suiteTree: [], reportStats: {}, bugMetrics: {}, showFeedback: vi.fn() })

describe('report print export', () => {
  it('prints wide case tables within landscape pages and repeats headers', () => {
    const write = vi.fn()
    const target = { opener: {}, document: { open: vi.fn(), write, close: vi.fn() } }
    vi.spyOn(window, 'open').mockReturnValue(target as any)
    useReportExportActions(options()).exportPdfReport()
    const html = write.mock.calls[0][0]
    expect(html).toContain('@page{size:A4 landscape;margin:14mm}')
    expect(html).toContain('table-layout:fixed')
    expect(html).toContain('overflow-wrap:anywhere')
    expect(html).toContain('thead{display:table-header-group}')
    expect(html).toContain('tr{break-inside:avoid}')
    expect(html).toContain('QA &lt;script&gt;')
    expect(target.opener).toBeNull()
  })
  it('reports a blocked print popup without writing a document', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const input = options()
    useReportExportActions(input).exportPdfReport()
    expect(input.showFeedback).toHaveBeenCalledWith('reportes.popupBlocked', 'reportes.popupBlockedPdfMessage', 'warning')
  })
})
