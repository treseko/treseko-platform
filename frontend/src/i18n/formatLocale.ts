import type { Locale } from './types'

const localeMap: Record<Locale, string> = { es: 'es-ES', en: 'en-US' }

function resolveLocale(locale: Locale): string {
  return localeMap[locale] || 'es-ES'
}

export function createLocaleFormatter(locale: Locale) {
  const tag = resolveLocale(locale)

  function formatDate(date: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
    const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
    return d.toLocaleDateString(tag, options ?? { dateStyle: 'medium' })
  }

  function formatTime(date: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
    const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
    return d.toLocaleTimeString(tag, options ?? { timeStyle: 'short' })
  }

  function formatDateTime(date: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
    const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
    return d.toLocaleString(tag, options ?? { dateStyle: 'medium', timeStyle: 'short' })
  }

  function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(tag, options).format(value)
  }

  function formatPercent(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(tag, { style: 'percent', ...options }).format(value)
  }

  return { formatDate, formatTime, formatDateTime, formatNumber, formatPercent }
}
