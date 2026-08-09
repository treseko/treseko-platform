import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { fallbackCatalog, loadCatalog } from './catalogs'
import { SUPPORTED_LOCALES, type I18nContextValue, type Locale, type TranslationCatalog, type TranslationKey } from './types'
import { getInitialLocale, LOCALE_STORAGE_KEY } from './localeUtils'

export * from './types'
function resolveMessage(catalog: TranslationCatalog, key: TranslationKey) {
  const [moduleName, ...path] = key.split('.')
  const messageKey = path.join('.')
  return catalog[moduleName]?.[messageKey] ?? fallbackCatalog[moduleName]?.[messageKey] ?? key
}

function interpolate(message: string, params?: Record<string, string | number>) {
  if (!params) return message
  return message.replace(/\{(\w+)\}/g, (match, name: string) => (
    params[name] === undefined ? match : String(params[name])
  ))
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale)
  const [catalog, setCatalog] = useState<TranslationCatalog>(fallbackCatalog)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    void loadCatalog(locale)
      .then((loadedCatalog) => {
        if (!cancelled) setCatalog(loadedCatalog)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [locale])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((nextLocale: Locale) => {
    if (!SUPPORTED_LOCALES.includes(nextLocale)) return
    setLocaleState(nextLocale)
    localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale)
  }, [])

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    isLoading,
    t: (key, params) => interpolate(resolveMessage(catalog, key), params),
  }), [catalog, isLoading, locale, setLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside I18nProvider')
  return context
}
