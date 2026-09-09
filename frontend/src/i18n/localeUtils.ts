import { fallbackLocale } from './catalogs'
import type { Locale } from './types'

export const LOCALE_STORAGE_KEY = 'treseko.ui.locale'

export function normalizeLocale(value: string | null | undefined): Locale {
  const normalized = value?.trim().toLowerCase().replaceAll('_', '-')
  if (normalized?.startsWith('en')) return 'en'
  if (normalized === 'pt' || normalized?.startsWith('pt-')) return 'pt'
  return fallbackLocale
}

export function getInitialLocale(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): Locale {
  const storedLocale = storage?.getItem(LOCALE_STORAGE_KEY)
  if (storedLocale) return normalizeLocale(storedLocale)
  return normalizeLocale(typeof navigator === 'undefined' ? undefined : navigator.language)
}
