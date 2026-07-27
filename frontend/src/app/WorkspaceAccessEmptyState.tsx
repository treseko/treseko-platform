type Props = {
  userName: string
  hasOrganizationAccess: boolean
}

export function WorkspaceAccessEmptyState({ userName, hasOrganizationAccess }: Props) {
  const title = hasOrganizationAccess
    ? 'Todavia no tenes proyectos asignados'
    : 'Todavia no tenes acceso asignado'
  const description = hasOrganizationAccess
    ? `Hola ${userName}. Tu cuenta tiene acceso a la solucion, pero todavia no pertenece a ningun proyecto.`
    : `Hola ${userName}. Tu cuenta esta activa, pero aun no pertenece a ninguna solucion o proyecto de Treseko.`
  const guidance = hasOrganizationAccess
    ? 'Pedile a un administrador que te agregue al equipo de un proyecto. Cuando tengas proyecto, vas a ver automaticamente las secciones disponibles para tu rol.'
    : 'Pedile a un administrador que te agregue a una solucion o al equipo de un proyecto. Cuando tengas acceso, vas a ver automaticamente las secciones disponibles para tu rol.'

  return <div className="min-vh-100 bg-light d-flex align-items-center justify-content-center p-4"><div className="bg-white border rounded-3 shadow-sm p-4 p-md-5 text-center" style={{ maxWidth: '640px' }}><div className="mx-auto mb-3 rounded-circle bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center fw-bold" style={{ width: '56px', height: '56px' }}>!</div><h1 className="h4 fw-bold text-dark mb-2">{title}</h1><p className="text-muted mb-3">{description}</p><div className="alert alert-info text-start small mb-0">{guidance}</div></div></div>
}
