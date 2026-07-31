export const SUPPORTED_LOCALES = ['es', 'en'] as const

export type Locale = (typeof SUPPORTED_LOCALES)[number]
export type TranslationModule = Record<string, string>
export type TranslationCatalog = Record<string, TranslationModule>
export type TranslationKey = `${string}.${string}`

export type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  isLoading: boolean
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}
