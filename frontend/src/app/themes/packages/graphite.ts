import type { ThemeDefinition } from '../themeCatalog'

export const graphiteTheme: ThemeDefinition = {
  id: 'graphite',
  name: 'Grafito',
  description: 'Tema oscuro neutro con acentos violeta y cian.',
  mode: 'custom',
  source: 'builtin',
  preview: ['#111315', '#20242a', '#c084fc'],
  tokens: {
    background: '#111315',
    surface: '#181a1d',
    surfaceMuted: '#22262b',
    surfaceRaised: '#20242a',
    surfaceHover: '#292e35',
    border: '#38404a',
    borderStrong: '#596474',
    text: '#f3f4f6',
    muted: '#a8b0bb',
    primary: '#c084fc',
    accent: '#22d3ee',
    rowSelected: '#2b2036',
    caseRowBackground: '#17191d',
    caseRowHover: '#262b32',
    caseRowText: '#e5e7eb',
  },
}
