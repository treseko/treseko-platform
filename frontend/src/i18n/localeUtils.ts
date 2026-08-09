import { fallbackLocale } from './catalogs'
import type { Locale } from './types'

export const LOCALE_STORAGE_KEY = 'treseko.ui.locale'

function normalizeLocale(value: string | null | undefined): Locale {
  return value?.toLowerCase().startsWith('en') ? 'en' : fallbackLocale
}

export function getInitialLocale(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): Locale {
  const storedLocale = storage?.getItem(LOCALE_STORAGE_KEY)
  if (storedLocale) return normalizeLocale(storedLocale)
  return normalizeLocale(typeof navigator === 'undefined' ? undefined : navigator.language)
}
