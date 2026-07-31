import { useI18n } from '../i18n'

type Props = {
  userName: string
  hasOrganizationAccess: boolean
}

export function WorkspaceAccessEmptyState({ userName, hasOrganizationAccess }: Props) {
  const { t } = useI18n()
  const title = hasOrganizationAccess
    ? t('common.noAssignedProjects')
    : t('common.noAssignedAccess')
  const description = hasOrganizationAccess
    ? t('common.accountProjectAccess', { user: userName })
    : t('common.accountSolutionAccess', { user: userName })
  const guidance = hasOrganizationAccess
    ? t('common.askAdminProject')
    : t('common.askAdminSolution')

  return <div className="min-vh-100 bg-light d-flex align-items-center justify-content-center p-4"><div className="bg-white border rounded-3 shadow-sm p-4 p-md-5 text-center" style={{ maxWidth: '640px' }}><div className="mx-auto mb-3 rounded-circle bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center fw-bold" style={{ width: '56px', height: '56px' }}>!</div><h1 className="h4 fw-bold text-dark mb-2">{title}</h1><p className="text-muted mb-3">{description}</p><div className="alert alert-info text-start small mb-0">{guidance}</div></div></div>
}
