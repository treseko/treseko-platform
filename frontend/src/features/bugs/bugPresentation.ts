export const BUG_PRIORITY_OPTIONS = ['P0', 'P1', 'P2', 'P3', 'P4']

type BadgeText = 'dark' | undefined

type BugBadgePresentation = {
  value: string
  shortLabel: string
  label: string
  optionLabel: string
  title: string
  bg: string
  text?: BadgeText
}

const BUG_PRIORITY_LABELS: Record<string, Omit<BugBadgePresentation, 'value'>> = {
  P0: {
    shortLabel: 'Urg.',
    label: 'Pri. Urg.',
    optionLabel: 'P0 · Urgente',
    title: 'P0 · Urgente',
    bg: 'danger',
  },
  P1: {
    shortLabel: 'Alta',
    label: 'Pri. Alta',
    optionLabel: 'P1 · Alta',
    title: 'P1 · Alta prioridad',
    bg: 'danger',
  },
  P2: {
    shortLabel: 'Media',
    label: 'Pri. Media',
    optionLabel: 'P2 · Media',
    title: 'P2 · Prioridad media',
    bg: 'warning',
    text: 'dark',
  },
  P3: {
    shortLabel: 'Baja',
    label: 'Pri. Baja',
    optionLabel: 'P3 · Baja',
    title: 'P3 · Baja prioridad',
    bg: 'light',
    text: 'dark',
  },
  P4: {
    shortLabel: 'Min.',
    label: 'Pri. Min.',
    optionLabel: 'P4 · Mínima',
    title: 'P4 · Prioridad mínima',
    bg: 'light',
    text: 'dark',
  },
}

const BUG_SEVERITY_LABELS: Record<string, string> = {
  CRITICA: 'Crítica',
  ALTA: 'Alta',
  MEDIA: 'Media',
  BAJA: 'Baja',
  COSMETICA: 'Cosmética',
}

export const getBugPriorityPresentation = (priority?: string | null): BugBadgePresentation | null => {
  const value = String(priority || '').toUpperCase()
  if (!value) return null
  const known = BUG_PRIORITY_LABELS[value]
  if (known) return { value, ...known }
  return {
    value,
    shortLabel: value,
    label: `Pri. ${value}`,
    optionLabel: value,
    title: value,
    bg: 'light',
    text: 'dark',
  }
}

export const formatBugPriorityOption = (priority?: string | null) => (
  getBugPriorityPresentation(priority)?.optionLabel || String(priority || '')
)

export const getBugSeverityPresentation = (severity?: string | null, prefix = 'Sev.') => {
  const value = String(severity || '').toUpperCase()
  if (!value) return null
  const shortLabel = BUG_SEVERITY_LABELS[value] || value
  return {
    value,
    shortLabel,
    label: prefix ? `${prefix} ${shortLabel}` : shortLabel,
  }
}

export const getBugCriticalityPresentation = (criticality?: string | null) => {
  const value = String(criticality || '').toUpperCase()
  if (!value) return null
  const shortLabel = BUG_SEVERITY_LABELS[value] || value
  return {
    value,
    shortLabel,
    label: `Crit. ${shortLabel}`,
  }
}
