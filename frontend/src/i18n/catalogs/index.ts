import spanishCatalog from './es'
import type { Locale, TranslationCatalog } from '../types'

export const fallbackLocale: Locale = 'es'
export const fallbackCatalog: TranslationCatalog = spanishCatalog
export const catalogs: Partial<Record<Locale, TranslationCatalog>> = {
  es: fallbackCatalog,
}

export async function loadCatalog(locale: Locale): Promise<TranslationCatalog> {
  if (catalogs[locale]) return catalogs[locale]!
  if (locale === 'en') {
    const module = await import('./en')
    catalogs.en = module.default
    return module.default
  }
  return fallbackCatalog
}
