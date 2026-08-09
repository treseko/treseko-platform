const EXECUTION_TYPE_META: Record<string, { label: string, color: string }> = {
  manual: { label: 'Manual', color: '#0d6efd' },
  automatizada: { label: 'Automatizada', color: '#198754' },
  ia: { label: 'IA', color: '#6f42c1' },
  externa: { label: 'Externa', color: '#0dcaf0' },
}

export function formatDashboardDuration(seconds: number | null | undefined, locale = 'es'): string {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value <= 0) return '0 s'

  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: value < 10 ? 1 : 0 })
  if (value < 1) return `${number.format(Math.round(value * 1000))} ms`
  if (value < 60) return `${number.format(value)} s`

  const totalSeconds = Math.round(value)
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  if (minutes < 60) return remainingSeconds ? `${minutes} min ${remainingSeconds} s` : `${minutes} min`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes ? `${hours} h ${remainingMinutes} min` : `${hours} h`
}

export function normalizeExecutionTypeDistribution(distribution: Record<string, any>) {
  return Object.entries(EXECUTION_TYPE_META).map(([key, meta]) => ({
    key,
    label: meta.label,
    color: meta.color,
    value: Number(distribution?.[key] || 0),
  }))
}
