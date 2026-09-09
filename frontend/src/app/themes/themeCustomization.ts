import { BUILTIN_THEMES, type ThemeDefinition, type ThemeTokenSet } from './themeCatalog'

export const CUSTOM_THEMES_KEY = 'custom_themes'
export const APPEARANCE_KEY = 'appearance'
export const PERSONAL_THEME_CONFIG_KEY = 'personal_theme_config'

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const MAX_IMPORTED_THEME_BYTES = 100 * 1024
export const MAX_THEME_IMAGE_BYTES = 768 * 1024
const MAX_CUSTOM_THEMES = 12

const CSS_TOKEN_MAP: Record<keyof ThemeTokenSet, string> = {
  background: '--app-bg',
  surface: '--app-surface',
  surfaceMuted: '--app-surface-muted',
  surfaceRaised: '--app-surface-raised',
  surfaceHover: '--app-surface-hover',
  border: '--app-border',
  borderStrong: '--app-border-strong',
  text: '--app-text',
  muted: '--app-muted',
  primary: '--app-primary',
  accent: '--app-success',
  rowSelected: '--app-row-selected',
  caseRowBackground: '--app-case-row-bg',
  caseRowHover: '--app-case-row-hover',
  caseRowText: '--app-case-row-text',
}

export type AppearanceSettings = {
  wallpaper: 'none' | 'aurora' | 'sunset' | 'graphite'
}

export type ProjectThemeSettings = {
  schemaVersion: 1
  name: string
  background: string
  surface: string
  surfaceMuted: string
  surfaceRaised: string
  surfaceHover: string
  border: string
  borderStrong: string
  primary: string
  accent: string
  text: string
  muted: string
  rowSelected: string
  caseRowBackground: string
  caseRowHover: string
  caseRowText: string
  backgroundMode: 'solid' | 'gradient' | 'image'
  backgroundImage: string
  imageSize: 'cover' | 'contain' | 'auto'
  imagePosition: 'center' | 'top' | 'bottom' | 'left' | 'right'
  imageOpacity: number
  gradientEnabled: boolean
  gradientStart: string
  gradientEnd: string
  gradientDirection: '90deg' | '135deg' | '180deg' | '225deg'
  gradientOpacity: number
}

const PROJECT_THEME_DEFAULTS: ProjectThemeSettings = {
  schemaVersion: 1,
  name: 'Tema del proyecto',
  background: '#f6f8fb',
  surface: '#ffffff',
  surfaceMuted: '#f8fafc',
  surfaceRaised: '#ffffff',
  surfaceHover: '#f1f5f9',
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  primary: '#2563eb',
  accent: '#198754',
  text: '#172033',
  muted: '#64748b',
  rowSelected: '#e7f1ff',
  caseRowBackground: '#ffffff',
  caseRowHover: '#f8fafc',
  caseRowText: '#172033',
  backgroundMode: 'solid',
  backgroundImage: '',
  imageSize: 'cover',
  imagePosition: 'center',
  imageOpacity: 100,
  gradientEnabled: false,
  gradientStart: '#2563eb',
  gradientEnd: '#7c3aed',
  gradientDirection: '135deg',
  gradientOpacity: 28,
}

export const DEFAULT_PROJECT_THEME = PROJECT_THEME_DEFAULTS

export const DEFAULT_APPEARANCE: AppearanceSettings = { wallpaper: 'none' }

export const WALLPAPER_IMAGES: Record<AppearanceSettings['wallpaper'], string> = {
  none: 'none',
  aurora: 'radial-gradient(circle at 15% 15%, rgba(56, 189, 248, .22), transparent 34%), radial-gradient(circle at 85% 20%, rgba(192, 132, 252, .2), transparent 36%)',
  sunset: 'linear-gradient(135deg, rgba(251, 146, 60, .22), transparent 48%), linear-gradient(315deg, rgba(244, 114, 182, .2), transparent 52%)',
  graphite: 'radial-gradient(circle at 70% 15%, rgba(148, 163, 184, .18), transparent 38%), linear-gradient(145deg, rgba(15, 23, 42, .3), transparent 60%)',
}

export function applyWallpaper(value: unknown) {
  const appearance = normalizeAppearance({ wallpaper: value })
  document.documentElement.style.setProperty('--app-wallpaper-image', WALLPAPER_IMAGES[appearance.wallpaper])
}

export function normalizeCustomThemes(value: unknown): ThemeDefinition[] {
  if (!Array.isArray(value)) return []
  return value.filter((theme): theme is ThemeDefinition => {
    if (!theme || typeof theme !== 'object') return false
    const candidate = theme as ThemeDefinition
    return typeof candidate.id === 'string' && candidate.id.startsWith('imported-') && typeof candidate.name === 'string' && candidate.tokens && typeof candidate.tokens === 'object' && (Object.keys(CSS_TOKEN_MAP) as Array<keyof ThemeTokenSet>).every(key => typeof candidate.tokens[key] === 'string' && COLOR_PATTERN.test(candidate.tokens[key]))
  }).slice(0, MAX_CUSTOM_THEMES)
}

export function normalizeAppearance(value: unknown): AppearanceSettings {
  const wallpaper = typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>).wallpaper
    : undefined
  return {
    wallpaper: wallpaper === 'aurora' || wallpaper === 'sunset' || wallpaper === 'graphite' ? wallpaper : 'none',
  }
}

function safeColor(value: unknown, fallback: string) {
  return typeof value === 'string' && COLOR_PATTERN.test(value) ? value : fallback
}

export function normalizeProjectTheme(value: unknown): ProjectThemeSettings | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const gradient = candidate.gradient && typeof candidate.gradient === 'object'
    ? candidate.gradient as Record<string, unknown>
    : candidate
  const direction = gradient.direction
  const name = typeof candidate.name === 'string' && candidate.name.trim().length > 0
    ? candidate.name.trim().slice(0, 50)
    : PROJECT_THEME_DEFAULTS.name
  return {
    schemaVersion: 1,
    name,
    background: safeColor(candidate.background ?? (candidate.tokens as any)?.background, PROJECT_THEME_DEFAULTS.background),
    surface: safeColor(candidate.surface ?? (candidate.tokens as any)?.surface, PROJECT_THEME_DEFAULTS.surface),
    surfaceMuted: safeColor(candidate.surfaceMuted ?? (candidate.tokens as any)?.surfaceMuted, PROJECT_THEME_DEFAULTS.surfaceMuted),
    surfaceRaised: safeColor(candidate.surfaceRaised ?? (candidate.tokens as any)?.surfaceRaised, PROJECT_THEME_DEFAULTS.surfaceRaised),
    surfaceHover: safeColor(candidate.surfaceHover ?? (candidate.tokens as any)?.surfaceHover, PROJECT_THEME_DEFAULTS.surfaceHover),
    border: safeColor(candidate.border ?? (candidate.tokens as any)?.border, PROJECT_THEME_DEFAULTS.border),
    borderStrong: safeColor(candidate.borderStrong ?? (candidate.tokens as any)?.borderStrong, PROJECT_THEME_DEFAULTS.borderStrong),
    primary: safeColor(candidate.primary ?? (candidate.tokens as any)?.primary, PROJECT_THEME_DEFAULTS.primary),
    accent: safeColor(candidate.accent ?? (candidate.tokens as any)?.accent, PROJECT_THEME_DEFAULTS.accent),
    text: safeColor(candidate.text ?? (candidate.tokens as any)?.text, PROJECT_THEME_DEFAULTS.text),
    muted: safeColor(candidate.muted ?? (candidate.tokens as any)?.muted, PROJECT_THEME_DEFAULTS.muted),
    rowSelected: safeColor(candidate.rowSelected ?? (candidate.tokens as any)?.rowSelected, PROJECT_THEME_DEFAULTS.rowSelected),
    caseRowBackground: safeColor(candidate.caseRowBackground ?? (candidate.tokens as any)?.caseRowBackground, PROJECT_THEME_DEFAULTS.caseRowBackground),
    caseRowHover: safeColor(candidate.caseRowHover ?? (candidate.tokens as any)?.caseRowHover, PROJECT_THEME_DEFAULTS.caseRowHover),
    caseRowText: safeColor(candidate.caseRowText ?? (candidate.tokens as any)?.caseRowText, PROJECT_THEME_DEFAULTS.caseRowText),
    backgroundMode: candidate.backgroundMode === 'image' || candidate.backgroundMode === 'gradient' ? candidate.backgroundMode : (candidate.backgroundImage ? 'image' : (gradient.enabled === true ? 'gradient' : 'solid')),
    backgroundImage: typeof candidate.backgroundImage === 'string' && candidate.backgroundImage.startsWith('data:image/') ? candidate.backgroundImage.slice(0, MAX_THEME_IMAGE_BYTES * 2) : '',
    imageSize: candidate.imageSize === 'contain' || candidate.imageSize === 'auto' ? candidate.imageSize : 'cover',
    imagePosition: candidate.imagePosition === 'top' || candidate.imagePosition === 'bottom' || candidate.imagePosition === 'left' || candidate.imagePosition === 'right' ? candidate.imagePosition : 'center',
    imageOpacity: Math.max(0, Math.min(100, Number.isFinite(Number(candidate.imageOpacity)) ? Number(candidate.imageOpacity) : 100)),
    gradientEnabled: gradient.enabled === true,
    gradientStart: safeColor(gradient.start, PROJECT_THEME_DEFAULTS.gradientStart),
    gradientEnd: safeColor(gradient.end, PROJECT_THEME_DEFAULTS.gradientEnd),
    gradientDirection: direction === '90deg' || direction === '180deg' || direction === '225deg' ? direction : '135deg',
    gradientOpacity: Math.max(0, Math.min(100, Number.isFinite(Number(gradient.opacity)) ? Number(gradient.opacity) : PROJECT_THEME_DEFAULTS.gradientOpacity)),
  }
}

export function createProjectThemeFromTokens(tokens: Partial<ThemeTokenSet>, name = PROJECT_THEME_DEFAULTS.name): ProjectThemeSettings {
  return normalizeProjectTheme({ name, ...tokens }) || PROJECT_THEME_DEFAULTS
}

export function normalizeImportedProjectTheme(raw: unknown): ProjectThemeSettings {
  if (!raw || typeof raw !== 'object') throw new Error('El archivo no contiene un tema válido.')
  const candidate = raw as Record<string, unknown>
  if (candidate.css !== undefined || candidate.style !== undefined || candidate.script !== undefined) throw new Error('Los temas importados no pueden contener CSS ni JavaScript.')
  const theme = normalizeProjectTheme(candidate)
  if (!theme) throw new Error('El archivo no contiene un tema válido.')
  if (theme.name === PROJECT_THEME_DEFAULTS.name && typeof candidate.name !== 'string') throw new Error('El tema debe incluir un nombre.')
  return theme
}

export async function readImportedProjectTheme(file: File): Promise<ProjectThemeSettings> {
  if (file.size > MAX_IMPORTED_THEME_BYTES) throw new Error('El archivo del tema supera el límite de 100 KB.')
  try {
    return normalizeImportedProjectTheme(JSON.parse(await file.text()))
  } catch (error: any) {
    throw new Error(error?.message || 'No se pudo leer el JSON del tema.')
  }
}

export function normalizeImportedTheme(raw: unknown): ThemeDefinition {
  if (!raw || typeof raw !== 'object') throw new Error('El archivo no contiene un tema válido.')
  const candidate = raw as Record<string, unknown>
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  if (name.length < 2 || name.length > 50) throw new Error('El nombre del tema debe tener entre 2 y 50 caracteres.')
  if (candidate.css !== undefined || candidate.style !== undefined || candidate.script !== undefined) throw new Error('Los temas importados no pueden contener CSS ni JavaScript.')
  const base = BUILTIN_THEMES.find(theme => theme.id === 'light') || BUILTIN_THEMES[0]
  const importedTokens = candidate.tokens && typeof candidate.tokens === 'object' ? candidate.tokens as Record<string, unknown> : {}
  const tokens = { ...base.tokens } as ThemeTokenSet
  for (const key of Object.keys(CSS_TOKEN_MAP) as Array<keyof ThemeTokenSet>) {
    if (importedTokens[key] !== undefined) {
      if (typeof importedTokens[key] !== 'string' || !COLOR_PATTERN.test(importedTokens[key] as string)) {
        throw new Error(`El color "${key}" no tiene un formato hexadecimal válido.`)
      }
      tokens[key] = importedTokens[key] as string
    }
  }
  const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'theme'
  const id = `imported-${slug}-${Date.now().toString(36)}`
  return {
    id,
    name,
    description: 'Tema importado por el usuario.',
    mode: 'custom',
    source: 'third-party',
    preview: [tokens.background, tokens.surface, tokens.primary],
    tokens,
  }
}

export async function readImportedTheme(file: File): Promise<ThemeDefinition> {
  if (file.size > MAX_IMPORTED_THEME_BYTES) throw new Error('El archivo del tema supera el límite de 100 KB.')
  const text = await file.text()
  try {
    return normalizeImportedTheme(JSON.parse(text))
  } catch (error: any) {
    throw new Error(error?.message || 'No se pudo leer el JSON del tema.')
  }
}

export function applyCustomTheme(theme: ThemeDefinition | undefined) {
  const root = document.documentElement
  if (!theme) return
  for (const key of Object.keys(CSS_TOKEN_MAP) as Array<keyof ThemeTokenSet>) {
    root.style.setProperty(CSS_TOKEN_MAP[key], theme.tokens[key])
  }
  root.style.setProperty('--app-primary-soft-bg', `color-mix(in srgb, ${theme.tokens.primary} 10%, transparent)`)
  root.style.setProperty('--app-primary-soft-border', `color-mix(in srgb, ${theme.tokens.primary} 22%, transparent)`)
  root.style.setProperty('--app-hover', `color-mix(in srgb, ${theme.tokens.primary} 8%, transparent)`)
  root.style.setProperty('--app-focus-ring', `color-mix(in srgb, ${theme.tokens.primary} 25%, transparent)`)
}

function hexToRgba(hex: string, opacity: number) {
  const value = hex.slice(1)
  const channels = [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16))
  return `rgba(${channels.join(', ')}, ${Math.max(0, Math.min(1, opacity))})`
}

export function applyProjectTheme(theme: ProjectThemeSettings | null | undefined) {
  if (!theme) return
  const root = document.documentElement
  const normalized = normalizeProjectTheme(theme)
  if (!normalized) return
  root.style.setProperty('--app-bg', normalized.background)
  root.style.setProperty('--app-surface', normalized.surface)
  root.style.setProperty('--app-surface-muted', normalized.surfaceMuted)
  root.style.setProperty('--app-surface-raised', normalized.surfaceRaised)
  root.style.setProperty('--app-surface-hover', normalized.surfaceHover)
  root.style.setProperty('--app-border', normalized.border)
  root.style.setProperty('--app-border-strong', normalized.borderStrong)
  root.style.setProperty('--app-text', normalized.text)
  root.style.setProperty('--app-muted', normalized.muted)
  root.style.setProperty('--app-primary', normalized.primary)
  root.style.setProperty('--app-success', normalized.accent)
  root.style.setProperty('--app-row-selected', normalized.rowSelected)
  root.style.setProperty('--app-case-row-bg', normalized.caseRowBackground)
  root.style.setProperty('--app-case-row-hover', normalized.caseRowHover)
  root.style.setProperty('--app-case-row-text', normalized.caseRowText)
  root.style.setProperty('--app-primary-soft-bg', `color-mix(in srgb, ${normalized.primary} 10%, transparent)`)
  root.style.setProperty('--app-primary-soft-border', `color-mix(in srgb, ${normalized.primary} 22%, transparent)`)
  root.style.setProperty('--app-hover', `color-mix(in srgb, ${normalized.primary} 8%, transparent)`)
  root.style.setProperty('--app-focus-ring', `color-mix(in srgb, ${normalized.primary} 25%, transparent)`)
  if (normalized.backgroundMode === 'image' && normalized.backgroundImage) {
    const veil = 1 - (normalized.imageOpacity / 100)
    root.style.setProperty('--app-wallpaper-image', `linear-gradient(rgba(0, 0, 0, ${veil}), url("${normalized.backgroundImage}"))`)
    root.style.setProperty('--app-wallpaper-size', normalized.imageSize === 'auto' ? 'auto' : normalized.imageSize)
    root.style.setProperty('--app-wallpaper-position', normalized.imagePosition)
  } else if (normalized.backgroundMode === 'gradient' || normalized.gradientEnabled) {
    const alpha = normalized.gradientOpacity / 100
    root.style.setProperty('--app-wallpaper-image', `linear-gradient(${normalized.gradientDirection}, ${hexToRgba(normalized.gradientStart, alpha)}, ${hexToRgba(normalized.gradientEnd, alpha)})`)
    root.style.setProperty('--app-wallpaper-size', 'cover')
    root.style.setProperty('--app-wallpaper-position', 'center')
  } else {
    root.style.setProperty('--app-wallpaper-image', 'none')
    root.style.setProperty('--app-wallpaper-size', 'cover')
    root.style.setProperty('--app-wallpaper-position', 'center')
  }
}

export function clearProjectTheme() {
  const root = document.documentElement
  for (const variable of Object.values(CSS_TOKEN_MAP)) root.style.removeProperty(variable)
  for (const variable of ['--app-primary-soft-bg', '--app-primary-soft-border', '--app-hover', '--app-focus-ring']) root.style.removeProperty(variable)
}

export function clearCustomTheme() {
  const root = document.documentElement
  for (const variable of Object.values(CSS_TOKEN_MAP)) root.style.removeProperty(variable)
  for (const variable of ['--app-primary-soft-bg', '--app-primary-soft-border', '--app-hover', '--app-focus-ring']) root.style.removeProperty(variable)
}
