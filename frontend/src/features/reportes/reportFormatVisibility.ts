export const REPORT_VISIBLE_FORMATS = ['CLASICA', 'CONVERSACIONAL', 'API'] as const

export const isReportVisibleFormat = (format?: string) =>
  REPORT_VISIBLE_FORMATS.includes(
    String(format || '').toUpperCase() as (typeof REPORT_VISIBLE_FORMATS)[number],
  )
