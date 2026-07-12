import { useEffect, useState } from 'react'
import { Badge, Button, Card, Col, Form, Row } from 'react-bootstrap'
import { Building2, Save, ShieldCheck } from 'lucide-react'
import { API_BASE } from '../../../../app/constants'

type Props = {
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
  canAccessCapability: (capabilityId: any, level?: any) => boolean
}

export function ActiveDirectorySettingsTab({ fetchWithAuth, showFeedback, canAccessCapability }: Props) {
  const [config, setConfig] = useState<any>({ enabled: false, provider_label: 'Active Directory', mode: 'oidc', discovery_url: '', issuer: '', client_id: '', redirect_path: '/auth/ad/callback/', scopes: ['openid', 'profile', 'email'], allowed_domains: [], auto_provision: true, default_role: 'TESTER', group_role_map: [], ldap_url: '', ldap_base_dn: '', ldap_user_attribute: 'sAMAccountName', ldap_bind_pattern: '{username}@{domain}' })
  const [groupRoleMapText, setGroupRoleMapText] = useState('[]')
  const canEdit = canAccessCapability('configuracion.sesion', 'edit')

  const load = async () => {
    const response = await fetchWithAuth(`${API_BASE}/auth/ad/config/`)
    if (response.ok) {
      const payload = await response.json()
      setConfig(payload)
      setGroupRoleMapText(JSON.stringify(payload.group_role_map || [], null, 2))
    }
  }

  useEffect(() => { void load() }, [])

  const save = async () => {
    let parsedGroupMap: any[] = []
    try {
      parsedGroupMap = JSON.parse(groupRoleMapText || '[]')
      if (!Array.isArray(parsedGroupMap)) throw new Error('group_role_map debe ser una lista')
    } catch (error: any) {
      showFeedback('Active Directory', error.message || 'JSON de grupos invalido.', 'danger')
      return
    }
    const response = await fetchWithAuth(`${API_BASE}/auth/ad/config/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...config, group_role_map: parsedGroupMap }),
    })
    if (!response.ok) {
      showFeedback('Active Directory', await response.text(), 'danger')
      return
    }
    const payload = await response.json()
    setConfig(payload)
    setGroupRoleMapText(JSON.stringify(payload.group_role_map || [], null, 2))
    showFeedback('Active Directory', 'Configuracion Active Directory guardada.', 'success')
  }

  const testConfig = async () => {
    const response = await fetchWithAuth(`${API_BASE}/auth/ad/test-config/`, { method: 'POST' })
    const payload = await response.json().catch(() => ({}))
    showFeedback('Active Directory', payload.message || 'Prueba ejecutada.', payload.ok ? 'success' : 'danger')
  }

  return (
    <Card className="border-0 shadow-sm rounded-4 bg-white p-4 mt-4">
      <div className="d-flex justify-content-between align-items-start mb-3">
        <div>
          <h6 className="fw-bold text-dark m-0"><Building2 size={17} className="me-2" />Active Directory</h6>
          <span className="small text-muted">Login empresarial por OIDC/SSO o LDAP directo con usuario y contrasena.</span>
        </div>
        <Badge bg={config.enabled ? 'success' : 'secondary'}>{config.enabled ? 'Habilitado' : 'Deshabilitado'}</Badge>
      </div>
      <Row className="g-3">
        <Col md={3}><Form.Check type="switch" label="Habilitado" checked={!!config.enabled} disabled={!canEdit} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} /></Col>
        <Col md={5}><Form.Control size="sm" placeholder="Etiqueta proveedor" value={config.provider_label || ''} disabled={!canEdit} onChange={(e) => setConfig({ ...config, provider_label: e.target.value })} /></Col>
        <Col md={4}><Form.Select size="sm" value={config.mode || 'oidc'} disabled={!canEdit} onChange={(e) => setConfig({ ...config, mode: e.target.value })}><option value="oidc">OIDC / SSO</option><option value="ldap">LDAP directo</option></Form.Select></Col>
        {config.mode !== 'ldap' ? (
          <>
            <Col md={4}><Badge bg="light" text="dark" className="border">Secreto de cliente: {config.client_secret_configured ? 'configurado' : 'pendiente'}</Badge></Col>
            <Col md={12}><Form.Control size="sm" placeholder="Discovery URL" value={config.discovery_url || ''} disabled={!canEdit} onChange={(e) => setConfig({ ...config, discovery_url: e.target.value })} /></Col>
            <Col md={6}><Form.Control size="sm" placeholder="Issuer" value={config.issuer || ''} disabled={!canEdit} onChange={(e) => setConfig({ ...config, issuer: e.target.value })} /></Col>
            <Col md={6}><Form.Control size="sm" placeholder="Client ID" value={config.client_id || ''} disabled={!canEdit} onChange={(e) => setConfig({ ...config, client_id: e.target.value })} /></Col>
            <Col md={6}><Form.Control size="sm" placeholder="Redirect path" value={config.redirect_path || '/auth/ad/callback/'} disabled={!canEdit} onChange={(e) => setConfig({ ...config, redirect_path: e.target.value })} /></Col>
            <Col md={6}><Form.Control size="sm" value={`${window.location.origin}${config.redirect_path || '/auth/ad/callback/'}`} disabled /></Col>
            <Col md={6}><Form.Control size="sm" placeholder="Scopes separados por coma" value={(config.scopes || []).join(', ')} disabled={!canEdit} onChange={(e) => setConfig({ ...config, scopes: e.target.value.split(',').map(item => item.trim()).filter(Boolean) })} /></Col>
          </>
        ) : (
          <>
            <Col md={6}><Form.Control size="sm" placeholder="LDAP URL. Ej: ldaps://ad.empresa.local:636" value={config.ldap_url || ''} disabled={!canEdit} onChange={(e) => setConfig({ ...config, ldap_url: e.target.value })} /></Col>
            <Col md={6}><Form.Control size="sm" placeholder="Base DN. Ej: DC=empresa,DC=local" value={config.ldap_base_dn || ''} disabled={!canEdit} onChange={(e) => setConfig({ ...config, ldap_base_dn: e.target.value })} /></Col>
            <Col md={6}><Form.Control size="sm" placeholder="Atributo usuario" value={config.ldap_user_attribute || 'sAMAccountName'} disabled={!canEdit} onChange={(e) => setConfig({ ...config, ldap_user_attribute: e.target.value })} /></Col>
            <Col md={6}><Form.Control size="sm" placeholder="Bind pattern" value={config.ldap_bind_pattern || '{username}@{domain}'} disabled={!canEdit} onChange={(e) => setConfig({ ...config, ldap_bind_pattern: e.target.value })} /></Col>
          </>
        )}
        <Col md={6}><Form.Control size="sm" placeholder="Dominios permitidos separados por coma" value={(config.allowed_domains || []).join(', ')} disabled={!canEdit} onChange={(e) => setConfig({ ...config, allowed_domains: e.target.value.split(',').map(item => item.trim()).filter(Boolean) })} /></Col>
        <Col md={4}><Form.Check type="switch" label="Auto provisionar usuarios" checked={!!config.auto_provision} disabled={!canEdit} onChange={(e) => setConfig({ ...config, auto_provision: e.target.checked })} /></Col>
        <Col md={4}><Form.Check type="switch" label="Requerir email verificado" checked={!!config.require_email_verified} disabled={!canEdit} onChange={(e) => setConfig({ ...config, require_email_verified: e.target.checked })} /></Col>
        <Col md={4}><Form.Check type="switch" label="Sincronizar perfil al login" checked={config.sync_profile_on_login !== false} disabled={!canEdit} onChange={(e) => setConfig({ ...config, sync_profile_on_login: e.target.checked })} /></Col>
        <Col md={4}><Form.Select size="sm" value={config.default_role || 'TESTER'} disabled={!canEdit} onChange={(e) => setConfig({ ...config, default_role: e.target.value })}>{['ADMIN', 'QA_LEAD', 'TESTER', 'VIEWER'].map(role => <option key={role}>{role}</option>)}</Form.Select></Col>
        <Col md={8}><Form.Control as="textarea" rows={4} size="sm" value={groupRoleMapText} disabled={!canEdit} onChange={(e) => setGroupRoleMapText(e.target.value)} /></Col>
        {canEdit && (
          <Col md={12} className="text-end">
            <Button size="sm" variant="outline-primary" onClick={testConfig} className="me-2"><ShieldCheck size={14} className="me-1" />Probar</Button>
            <Button size="sm" onClick={save}><Save size={14} className="me-1" />Guardar</Button>
          </Col>
        )}
      </Row>
    </Card>
  )
}
