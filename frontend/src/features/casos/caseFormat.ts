import { Braces, FileText, Gauge, MessageSquareText, type LucideIcon } from 'lucide-react'

export type CaseFormat = 'CLASICA' | 'CONVERSACIONAL' | 'API' | 'PERFORMANCE'

type CaseFormatPresentation = {
  icon: LucideIcon
  labelKey: 'casos.formatClassic' | 'casos.formatConversational' | 'casos.formatApi' | 'casos.formatPerformance'
  color: string
}

export const caseFormatPresentation: Record<CaseFormat, CaseFormatPresentation> = {
  CLASICA: { icon: FileText, labelKey: 'casos.formatClassic', color: '#0d6efd' },
  CONVERSACIONAL: { icon: MessageSquareText, labelKey: 'casos.formatConversational', color: '#6f42c1' },
  API: { icon: Braces, labelKey: 'casos.formatApi', color: '#0f766e' },
  PERFORMANCE: { icon: Gauge, labelKey: 'casos.formatPerformance', color: '#c2410c' },
}

// Performance remains a recognized format for existing and imported cases,
// but its authoring flow is intentionally hidden until its executor is ready.
export const caseCreationFormats: CaseFormat[] = ['CLASICA', 'CONVERSACIONAL', 'API']

export const normalizeCaseFormat = (value: unknown): CaseFormat => {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'FUNCIONAL') return 'CLASICA'
  if (normalized === 'CONVERSACIONAL' || normalized === 'API' || normalized === 'PERFORMANCE') {
    return normalized
  }
  return 'CLASICA'
}
