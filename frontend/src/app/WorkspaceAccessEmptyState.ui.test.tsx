import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'

import { WorkspaceAccessEmptyState } from './WorkspaceAccessEmptyState'
import { I18nProvider } from '../i18n'

const renderWithI18n = (ui: ReactNode) => {
  window.localStorage.setItem('treseko.ui.locale', 'es')
  return render(<I18nProvider>{ui}</I18nProvider>)
}

describe('WorkspaceAccessEmptyState', () => {
  it('explica la falta de proyecto a un usuario con solución asignada', () => {
    renderWithI18n(<WorkspaceAccessEmptyState userName="Ana" hasOrganizationAccess />)
    expect(screen.getByRole('heading', { name: 'Todavía no tenés proyectos asignados' })).toBeInTheDocument()
    expect(screen.getByText(/Hola Ana/)).toBeInTheDocument()
  })

  it('explica la falta de acceso sin mostrar el mensaje de proyecto', () => {
    renderWithI18n(<WorkspaceAccessEmptyState userName="Luis" hasOrganizationAccess={false} />)
    expect(screen.getByRole('heading', { name: 'Todavía no tenés acceso asignado' })).toBeInTheDocument()
    expect(screen.getByText(/solución o al equipo/)).toBeInTheDocument()
  })
})
