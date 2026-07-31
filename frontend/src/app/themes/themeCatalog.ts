import { graphiteTheme } from './packages/graphite'

export type ThemeTokenSet = {
  background: string
  surface: string
  surfaceMuted: string
  surfaceRaised: string
  surfaceHover: string
  border: string
  borderStrong: string
  text: string
  muted: string
  primary: string
  accent: string
  rowSelected: string
  caseRowBackground: string
  caseRowHover: string
  caseRowText: string
}

export type ThemeDefinition = {
  id: string
  name: string
  description: string
  mode: 'system' | 'light' | 'dark' | 'custom'
  source: 'builtin' | 'third-party'
  preview: string[]
  tokens: ThemeTokenSet
}

export const BUILTIN_THEMES: ThemeDefinition[] = [
  {
    id: 'system',
    name: 'Sistema',
    description: 'Usa claro u oscuro segun la preferencia del navegador.',
    mode: 'system',
    source: 'builtin',
    preview: ['#f6f8fb', '#0f172a', '#0d6efd'],
    tokens: {
      background: '#f6f8fb',
      surface: '#ffffff',
      surfaceMuted: '#f8fafc',
      surfaceRaised: '#ffffff',
      surfaceHover: '#f1f5f9',
      border: '#e2e8f0',
      borderStrong: '#cbd5e1',
      text: '#111827',
      muted: '#64748b',
      primary: '#0d6efd',
      accent: '#198754',
      rowSelected: '#e7f1ff',
      caseRowBackground: '#ffffff',
      caseRowHover: '#f8fafc',
      caseRowText: '#111827',
    },
  },
  {
    id: 'light',
    name: 'Claro',
    description: 'Tema claro clasico de Treseko.',
    mode: 'light',
    source: 'builtin',
    preview: ['#ffffff', '#f6f8fb', '#0d6efd'],
    tokens: {
      background: '#f6f8fb',
      surface: '#ffffff',
      surfaceMuted: '#f8fafc',
      surfaceRaised: '#ffffff',
      surfaceHover: '#f1f5f9',
      border: '#e2e8f0',
      borderStrong: '#cbd5e1',
      text: '#111827',
      muted: '#64748b',
      primary: '#0d6efd',
      accent: '#198754',
      rowSelected: '#e7f1ff',
      caseRowBackground: '#ffffff',
      caseRowHover: '#f8fafc',
      caseRowText: '#111827',
    },
  },
  {
    id: 'dark',
    name: 'Oscuro',
    description: 'Modo oscuro completo para trabajo prolongado.',
    mode: 'dark',
    source: 'builtin',
    preview: ['#0f172a', '#1e293b', '#38bdf8'],
    tokens: {
      background: '#0f172a',
      surface: '#111827',
      surfaceMuted: '#1e293b',
      surfaceRaised: '#162238',
      surfaceHover: '#1b2940',
      border: '#334155',
      borderStrong: '#3b506d',
      text: '#e5e7eb',
      muted: '#94a3b8',
      primary: '#38bdf8',
      accent: '#22c55e',
      rowSelected: '#0d3042',
      caseRowBackground: '#0e1828',
      caseRowHover: '#142136',
      caseRowText: '#dce7f5',
    },
  },
  {
    id: 'pink-panther',
    name: 'Pantera Rosa',
    description: 'Rosa profesional con buen contraste para uso diario.',
    mode: 'custom',
    source: 'builtin',
    preview: ['#fff1f7', '#be185d', '#831843'],
    tokens: {
      background: '#fff7fb',
      surface: '#ffffff',
      surfaceMuted: '#fff1f7',
      surfaceRaised: '#ffffff',
      surfaceHover: '#fff1f7',
      border: '#f9a8d4',
      borderStrong: '#ec4899',
      text: '#311827',
      muted: '#7f506b',
      primary: '#db2777',
      accent: '#8b5cf6',
      rowSelected: '#fce7f3',
      caseRowBackground: '#ffffff',
      caseRowHover: '#fff1f7',
      caseRowText: '#311827',
    },
  },
  graphiteTheme,
]

export const getThemeDefinition = (themeId?: string) =>
  BUILTIN_THEMES.find(theme => theme.id === themeId) || BUILTIN_THEMES[0]
