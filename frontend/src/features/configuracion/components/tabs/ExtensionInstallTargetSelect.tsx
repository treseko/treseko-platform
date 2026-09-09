import { Form } from 'react-bootstrap'
import { useI18n } from '../../../../i18n'

type Props = {
  value: string
  onChange: (value: string) => void
  projects: any[]
  organizations: any[]
  allowGlobal: boolean
}

export function ExtensionInstallTargetSelect({ value, onChange, projects, organizations, allowGlobal }: Props) {
  const { t } = useI18n()
  return <Form.Group className="mb-3" controlId="official-store-install-target">
    <Form.Label className="small fw-bold text-secondary">{t('configuracion.installTarget')}</Form.Label>
    <Form.Select size="sm" aria-label={t('configuracion.installTarget')} value={value} onChange={event => onChange(event.target.value)}>
      <option value="">{t('configuracion.selectScope')}</option>
      {projects.map(project => <option key={`project:${project.id}`} value={`project:${project.id}`}>
        {t('configuracion.scopeProject')}: {project.nombre || project.name || project.id}
      </option>)}
      {organizations.map(organization => <option key={`organization:${organization.id}`} value={`organization:${organization.id}`}>
        {t('configuracion.scopeOrganization')}: {organization.nombre || organization.name || organization.id}
      </option>)}
      {allowGlobal && <option value="global">{t('configuracion.scopeGlobalFull')}</option>}
    </Form.Select>
    <Form.Text className="text-muted">{t('configuracion.installTargetHint')}</Form.Text>
  </Form.Group>
}
