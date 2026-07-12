const API_DATE_WITH_SPACE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/
const API_DATE_HAS_ZONE_RE = /(Z|[+-]\d{2}:?\d{2})$/
const DATE_TIME_24H_DEFAULTS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23',
}
const TIME_24H_DEFAULTS: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  hourCycle: 'h23',
}

export function normalizeApiDate(value?: string | null): string | null {
  if (!value) return null
  const raw = String(value).trim()
  if (!raw) return null
  if (API_DATE_WITH_SPACE_RE.test(raw) && !API_DATE_HAS_ZONE_RE.test(raw)) {
    return `${raw.replace(' ', 'T')}Z`
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw) && !API_DATE_HAS_ZONE_RE.test(raw)) {
    return `${raw}Z`
  }
  return raw
}

export function parseApiDate(value?: string | null): Date | null {
  const normalized = normalizeApiDate(value)
  if (!normalized) return null
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDateTime(value?: string | null, options?: Intl.DateTimeFormatOptions): string {
  const date = parseApiDate(value)
  if (!date) return ''
  const hasStyleOption = Boolean(options?.dateStyle || options?.timeStyle)
  const baseOptions = hasStyleOption ? {} : DATE_TIME_24H_DEFAULTS
  return date.toLocaleString('es-AR', { ...baseOptions, ...(options || {}), hour12: false, hourCycle: 'h23' })
}

export function formatDate(value?: string | null, options?: Intl.DateTimeFormatOptions): string {
  const date = parseApiDate(value)
  if (!date) return ''
  return date.toLocaleDateString('es-AR', options)
}

export function formatTime(value?: string | Date | null, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return ''
  const date = value instanceof Date ? value : parseApiDate(value)
  if (!date || Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('es-AR', { ...TIME_24H_DEFAULTS, ...(options || {}), hour12: false, hourCycle: 'h23' })
}

export function dateTimeMs(value?: string | null): number | null {
  const date = parseApiDate(value)
  return date ? date.getTime() : null
}

export function toDateTimeLocalInput(value?: string | null): string {
  const date = parseApiDate(value)
  if (!date) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

export function toDateTimeDisplayInput(value?: string | null): string {
  const date = parseApiDate(value)
  if (!date) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function fromDateTimeLocalInput(value?: string | null): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  const displayMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?$/)
  if (displayMatch) {
    const [, day, month, year, hour = '0', minute = '0'] = displayMatch
    const dayNumber = Number(day)
    const monthNumber = Number(month)
    const yearNumber = Number(year)
    const hourNumber = Number(hour)
    const minuteNumber = Number(minute)
    const date = new Date(yearNumber, monthNumber - 1, dayNumber, hourNumber, minuteNumber)
    if (
      date.getFullYear() !== yearNumber ||
      date.getMonth() !== monthNumber - 1 ||
      date.getDate() !== dayNumber ||
      date.getHours() !== hourNumber ||
      date.getMinutes() !== minuteNumber
    ) return null
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
