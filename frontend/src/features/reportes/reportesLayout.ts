import type { LayoutItem, ResponsiveLayouts } from 'react-grid-layout'

export const REPORTES_BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
export const REPORTES_COLS = { lg: 12, md: 6, sm: 6, xs: 4, xxs: 2 }
const REPORTES_BREAKPOINT_KEYS = Object.keys(REPORTES_COLS) as Array<keyof typeof REPORTES_COLS>
const TRACEABILITY_COVERAGE_LAYOUT_HEIGHT = 5

export const REPORTES_WIDGET_IDS = [
  'traceabilityCoverage', 'context', 'kpis', 'temporal', 'aiMetrics',
  'buildComparison', 'filters', 'bugTraceability', 'bugs', 'failures',
  'evidence', 'statusChart', 'executionModeChart', 'priority', 'suites',
  'trend', 'sharedHistory',
]

const REPORTES_DEFAULT_LAYOUT: LayoutItem[] = [
  { i: 'traceabilityCoverage', x: 0, y: 0, w: 12, h: TRACEABILITY_COVERAGE_LAYOUT_HEIGHT, minW: 4, minH: 3 },
  { i: 'context', x: 0, y: 5, w: 12, h: 3, minW: 4, minH: 2 },
  { i: 'kpis', x: 0, y: 8, w: 12, h: 4, minW: 4, minH: 3 },
  { i: 'temporal', x: 0, y: 12, w: 12, h: 3, minW: 4, minH: 3 },
  { i: 'aiMetrics', x: 0, y: 15, w: 12, h: 5, minW: 4, minH: 4 },
  { i: 'buildComparison', x: 0, y: 20, w: 12, h: 4, minW: 4, minH: 3 },
  { i: 'filters', x: 0, y: 24, w: 12, h: 3, minW: 4, minH: 2 },
  { i: 'bugTraceability', x: 0, y: 27, w: 5, h: 4, minW: 3, minH: 3 },
  { i: 'bugs', x: 5, y: 27, w: 7, h: 4, minW: 4, minH: 3 },
  { i: 'failures', x: 0, y: 31, w: 7, h: 5, minW: 4, minH: 3 },
  { i: 'evidence', x: 7, y: 31, w: 5, h: 5, minW: 3, minH: 3 },
  { i: 'statusChart', x: 0, y: 36, w: 6, h: 5, minW: 4, minH: 4 },
  { i: 'executionModeChart', x: 6, y: 36, w: 6, h: 5, minW: 4, minH: 4 },
  { i: 'priority', x: 0, y: 41, w: 12, h: 5, minW: 4, minH: 3 },
  { i: 'suites', x: 0, y: 46, w: 12, h: 6, minW: 4, minH: 4 },
  { i: 'trend', x: 0, y: 52, w: 12, h: 5, minW: 4, minH: 4 },
  { i: 'sharedHistory', x: 0, y: 57, w: 12, h: 5, minW: 4, minH: 3 },
]

const fitReportesLayoutItemToCols = (item: LayoutItem, cols: number): LayoutItem => ({
  ...item,
  x: Math.max(0, Math.min(item.x || 0, Math.max(0, cols - Math.max(1, Math.min(item.w || cols, cols))))),
  w: Math.max(1, Math.min(item.w || cols, cols)),
  minW: item.minW ? Math.min(item.minW, cols) : undefined,
  maxW: item.maxW ? Math.min(item.maxW, cols) : undefined,
})

export const defaultReportesLayouts = (): ResponsiveLayouts<string> => Object.fromEntries(
  REPORTES_BREAKPOINT_KEYS.map((breakpoint) => {
    const cols = REPORTES_COLS[breakpoint]
    return [breakpoint, REPORTES_DEFAULT_LAYOUT.map((item) => {
      const width = breakpoint === 'lg' ? item.w : breakpoint === 'md' || breakpoint === 'sm' ? Math.min(item.w, cols) : cols
      return fitReportesLayoutItemToCols({
        ...item,
        x: breakpoint === 'lg' ? item.x : breakpoint === 'md' ? item.x % cols : 0,
        w: width,
      }, cols)
    })]
  }),
)

export const sanitizeReportesLayouts = (value: any): ResponsiveLayouts<string> => {
  const defaults = defaultReportesLayouts()
  if (!value || typeof value !== 'object') return defaults
  return Object.fromEntries(REPORTES_BREAKPOINT_KEYS.map((breakpoint) => {
    const cols = REPORTES_COLS[breakpoint]
    const incoming = Array.isArray(value?.[breakpoint]) ? value[breakpoint] : []
    const requiresMigration = !incoming.some((item: any) => item?.i === 'traceabilityCoverage')
    const byId = new Map(incoming.filter((item: any) => REPORTES_WIDGET_IDS.includes(item?.i)).map((item: any) => [item.i, item]))
    return [breakpoint, defaults[breakpoint].map((base) => {
      const savedItem = byId.get(base.i)
      const migratedItem = savedItem && requiresMigration
        ? { ...savedItem, y: Math.max(0, Number(savedItem.y || 0) + TRACEABILITY_COVERAGE_LAYOUT_HEIGHT) }
        : savedItem
      return fitReportesLayoutItemToCols({ ...base, ...(migratedItem || {}) }, cols)
    })]
  }))
}

export const sanitizeReportesWidgets = (widgets: any, layouts: any): string[] => {
  if (!Array.isArray(widgets)) return REPORTES_WIDGET_IDS
  const savedWidgets = REPORTES_WIDGET_IDS.filter((id) => widgets.includes(id))
  const hasTraceabilityLayout = Object.values(layouts || {}).some((layout: any) =>
    Array.isArray(layout) && layout.some((item: any) => item?.i === 'traceabilityCoverage'))
  return hasTraceabilityLayout || savedWidgets.includes('traceabilityCoverage')
    ? savedWidgets
    : [...savedWidgets, 'traceabilityCoverage']
}

export const withReportesEditFlags = (layouts: ResponsiveLayouts<string>, editing: boolean): ResponsiveLayouts<string> =>
  Object.fromEntries(Object.entries(layouts).map(([breakpoint, layout]) => [
    breakpoint,
    (layout || []).map((item) => ({ ...item, isDraggable: editing, isResizable: editing, resizeHandles: ['se'] })),
  ]))

export const stripReportesEditFlags = (layouts: ResponsiveLayouts<string>): ResponsiveLayouts<string> =>
  Object.fromEntries(Object.entries(layouts).map(([breakpoint, layout]) => [
    breakpoint,
    (layout || []).map(({ isDraggable, isResizable, resizeHandles, ...item }) => item),
  ]))
