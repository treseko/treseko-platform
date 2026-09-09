import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getSessionLocale } from '../../app/useAppSessionState'
import { commitLanguageLocale } from './components/tabs/ProfileSettingsTab'
import { createLanguagePatchRequest, persistLanguagePreference } from './hooks/useProfileSettings'

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('selector, sesión y persistencia del idioma pt', () => {
  it('construye exactamente el PATCH esperado para pt y mantiene es/en', () => {
    expect(createLanguagePatchRequest('pt')).toEqual({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'pt' }),
    })
    expect(JSON.parse(String(createLanguagePatchRequest('es').body))).toEqual({ language: 'es' })
    expect(JSON.parse(String(createLanguagePatchRequest('en').body))).toEqual({ language: 'en' })
  })

  it('restaura pt y normaliza variantes regionales sin aceptar valores vacíos', () => {
    expect(getSessionLocale('pt')).toBe('pt')
    expect(getSessionLocale('pt-BR')).toBe('pt')
    expect(getSessionLocale(' PT_br ')).toBe('pt')
    expect(getSessionLocale('')).toBeNull()
    expect(getSessionLocale(undefined)).toBeNull()
  })

  it('solo devuelve las preferencias después de un PATCH exitoso y conserva las demás', async () => {
    const preferences = { language: 'pt', display_name: 'Ana', density: 'comfortable' }
    const fetchWithAuth = async (_url: string, options?: RequestInit) => {
      expect(JSON.parse(String(options?.body))).toEqual({ language: 'pt' })
      return response(200, preferences)
    }

    await expect(persistLanguagePreference(fetchWithAuth, 'pt')).resolves.toEqual(preferences)
  })

  it('rechaza 422 sin devolver preferencias ni confirmar el cambio', async () => {
    const fetchWithAuth = async () => response(422, { detail: 'Idioma no soportado' })
    await expect(persistLanguagePreference(fetchWithAuth, 'pt')).rejects.toThrow('Idioma no soportado')
  })

  it('propaga el error de red para que la interfaz pueda revertir el idioma', async () => {
    const fetchWithAuth = async () => { throw new Error('red desconectada') }
    await expect(persistLanguagePreference(fetchWithAuth, 'pt')).rejects.toThrow('red desconectada')
  })

  it('confirma el locale y localStorage solo con éxito, y restaura ambos ante fallo', () => {
    let locale = 'es'
    const values = new Map<string, string>([['treseko.ui.locale', 'es']])
    const setLocale = (next: 'es' | 'en' | 'pt') => {
      locale = next
      values.set('treseko.ui.locale', next)
    }

    commitLanguageLocale(true, 'pt', 'es', setLocale)
    expect(locale).toBe('pt')
    expect(values.get('treseko.ui.locale')).toBe('pt')

    commitLanguageLocale(false, 'en', 'pt', setLocale)
    expect(locale).toBe('pt')
    expect(values.get('treseko.ui.locale')).toBe('pt')
  })

  it('persiste y restaura pt desde localStorage usando el valor canónico', async () => {
    const values = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value) },
        removeItem: (key: string) => { values.delete(key) },
      },
    })
    localStorage.setItem('treseko.ui.locale', 'pt-BR')
    const { getInitialLocale } = await import('../../i18n/localeUtils')
    expect(getInitialLocale()).toBe('pt')
    localStorage.setItem('treseko.ui.locale', 'pt')
    expect(getInitialLocale()).toBe('pt')
  })

  it('mantiene la opción visible Português (Brasil) y los valores es/en', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/configuracion/components/tabs/ProfileSettingsTab.tsx'), 'utf8')
    expect(source).toContain('<option value="pt">Português (Brasil)</option>')
    expect(source).toContain('<option value="es">')
    expect(source).toContain('<option value="en">')
    expect(source).toContain('saveLanguage(next).then')
    expect(source).toContain('commitLanguageLocale(saved, next, previous, setLocale)')
  })
})
