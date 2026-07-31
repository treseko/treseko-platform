import { API_BASE } from '../../app/constants'

export const SHARED_REPORT_TYPES = [
  { type: 'executive', title: 'Informe ejecutivo', badge: 'Publico', description: 'Resumen para negocio, decision QA, estado general y riesgos principales.' },
  { type: 'development', title: 'Informe para desarrollo', badge: 'Publico sanitizado', description: 'Detalle tecnico accionable para el equipo, sin exponer datos internos sensibles.' },
  { type: 'internal', title: 'Informe interno actual', badge: 'Autenticado', description: 'Vista completa del informe que estas revisando, con mayor contexto operativo.' },
]

export const sharedMarkdownUrl = (report: any, type: string) => {
  const link = report?.links?.[type]
  return link ? `${link}.md` : ''
}

export const proxiedReportUrl = (url: string) => {
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

export const frontendReportUrl = (url: string) => {
  try {
    const parsed = new URL(url, window.location.origin)
    if (parsed.pathname.startsWith('/informes/') || parsed.pathname.startsWith('/informes-internos/')) return `${window.location.origin}${parsed.pathname}${parsed.search}`
    if (parsed.pathname.startsWith('/s/reports') || parsed.pathname.startsWith('/reports/internal')) return `${window.location.origin}${API_BASE}${parsed.pathname}${parsed.search}`
  } catch { return url }
  return url
}

export const internalReportViewerUrl = (url: string) => {
  try {
    const parsed = new URL(url, window.location.origin)
    const prettyMatch = parsed.pathname.match(/^\/informes-internos\/[^/]+\/[^/]+\/[^/]+\/([^/?#]+)$/)
    if (prettyMatch?.[1]) return `${window.location.origin}${parsed.pathname}`
    const match = parsed.pathname.match(/^\/reports\/internal\/([^/?#]+)$/)
    if (match?.[1]) return `${window.location.origin}/?internal_report=${encodeURIComponent(match[1])}`
  } catch { return url }
  return url
}

export const shareableReportUrl = (url: string, type: string) => type === 'internal' ? internalReportViewerUrl(url) : frontendReportUrl(url)

export const sharedReportPreview = (report: any, type: string, t: (key: string) => string) => {
  const snapshot = (report?.snapshots || []).find((item: any) => item?.token === report?.tokens?.[type])
    || (report?.snapshots || []).find((item: any) => String(item?.payload?.metadata?.report_type || '').toLowerCase() === type) || {}
  const metadata = snapshot?.payload?.metadata || {}
  const metrics = snapshot?.payload?.metrics || {}
  return {
    organization: metadata.organizacion || 'Solucion', project: metadata.proyecto || t('reportes.projectFallback'),
    build: metadata.build || metrics.build_name || 'Build', component: metadata.componente || 'Componente',
    qa: report?.build_definition || metadata.build_definition || t('reportes.qaDecision'),
  }
}

export const isInternalReportUrl = (url: string) => {
  try {
    const pathname = new URL(url, window.location.origin).pathname
    return pathname.startsWith('/reports/internal') || pathname.startsWith('/informes-internos/')
  } catch { return false }
}
