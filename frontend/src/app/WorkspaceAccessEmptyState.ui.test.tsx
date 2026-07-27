import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { WorkspaceAccessEmptyState } from './WorkspaceAccessEmptyState'

describe('WorkspaceAccessEmptyState', () => {
  it('explica la falta de proyecto a un usuario con solución asignada', () => {
    render(<WorkspaceAccessEmptyState userName="Ana" hasOrganizationAccess />)
    expect(screen.getByRole('heading', { name: 'Todavia no tenes proyectos asignados' })).toBeInTheDocument()
    expect(screen.getByText(/Hola Ana/)).toBeInTheDocument()
  })

  it('explica la falta de acceso sin mostrar el mensaje de proyecto', () => {
    render(<WorkspaceAccessEmptyState userName="Luis" hasOrganizationAccess={false} />)
    expect(screen.getByRole('heading', { name: 'Todavia no tenes acceso asignado' })).toBeInTheDocument()
    expect(screen.getByText(/solucion o al equipo/)).toBeInTheDocument()
  })
})
