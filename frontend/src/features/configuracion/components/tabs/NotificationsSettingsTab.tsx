import { useEffect, useState } from 'react'
import { Badge, Button, Card, Col, Form, Modal, Row, Table } from 'react-bootstrap'
import { Bell, Eye, Mail, Play, Plus, RotateCw, Save, Send, Trash2, Users } from 'lucide-react'
import { notificationClient } from '../../../notificaciones/notificationClient'

type Props = {
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
  canAccessCapability: (capabilityId: any, level?: any) => boolean
}

export function NotificationsSettingsTab({ fetchWithAuth, showFeedback, canAccessCapability }: Props) {
  const [config, setConfig] = useState<any>({ enabled: false, host: '', port: 587, use_starttls: true, use_ssl: false, from_email: '', from_name: 'Treseko', base_url: 'http://localhost:5173' })
  const [testEmail, setTestEmail] = useState('')
  const [rules, setRules] = useState<any[]>([])
  const [templates, setTemplates] = useState<any[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [templateDraft, setTemplateDraft] = useState<any | null>(null)
  const [deliveries, setDeliveries] = useState<any[]>([])
  const [preferences, setPreferences] = useState<any[]>([])
  const [showRuleModal, setShowRuleModal] = useState(false)
  const [showEventsModal, setShowEventsModal] = useState(false)
  const [ruleDraft, setRuleDraft] = useState<any | null>(null)
  const [ruleEventsText, setRuleEventsText] = useState('')
  const [ruleConditionsText, setRuleConditionsText] = useState('{}')
  const [ruleRecipientsText, setRuleRecipientsText] = useState('{}')
  const [inbox, setInbox] = useState<any[]>([])
  const canEdit = canAccessCapability('notificaciones.configuracion', 'edit')
  const canEditRules = canAccessCapability('notificaciones.reglas', 'edit')
  const canEditTemplates = canAccessCapability('notificaciones.plantillas', 'edit')
  const canAdmin = canAccessCapability('notificaciones.admin', 'edit')

  const eventLabels: Record<string, string> = {
    'bug.created': 'Bug creado',
    'bug.created_from_snapshot': 'Bug desde snapshot',
    'bug.created_from_execution': 'Bug desde ejecucion',
    'bug.assigned': 'Bug asignado',
    'bug.ready_for_retest': 'Listo para retest',
    'bug.comment_added': 'Comentario en bug',
    'execution.failed': 'Ejecucion fallida',
    'execution.blocked': 'Ejecucion bloqueada',
    'ai.execution.review_required': 'Revision IA requerida',
    'ai.execution.failed': 'IA fallida',
    'ai.engine.unavailable': 'Motor IA no disponible',
    'auth.ad_user_provisioned': 'Usuario AD provisionado',
    'user.created': 'Usuario creado',
    'user.disabled': 'Usuario deshabilitado',
    'user.role_changed': 'Rol de usuario cambiado',
    'role.permissions_changed': 'Permisos de rol cambiados',
    'project.member_added': 'Miembro agregado',
    'project.member_removed': 'Miembro removido',
    'build.activated': 'Build activada',
    'build.closed': 'Build cerrada',
    'auth.login_failed_many': 'Muchos logins fallidos',
    'evidence.required_missing': 'Evidencia faltante',
    'automation.runner.offline': 'Runner offline',
    'report.shared': 'Reporte compartido',
    'report.generated': 'Reporte generado',
    'report.quality_gate_failed': 'Quality gate fallido',
    'ai.execution.completed': 'IA completada',
  }

  const eventCatalog = [
    { group: 'Bugs', id: 'bug.created', label: eventLabels['bug.created'], description: 'Se crea un bug manualmente desde Bug Tracker.' },
    { group: 'Bugs', id: 'bug.created_from_snapshot', label: eventLabels['bug.created_from_snapshot'], description: 'Se crea un bug a partir de una evidencia o snapshot.' },
    { group: 'Bugs', id: 'bug.created_from_execution', label: eventLabels['bug.created_from_execution'], description: 'Se crea un bug desde una ejecucion de prueba.' },
    { group: 'Bugs', id: 'bug.assigned', label: eventLabels['bug.assigned'], description: 'Un bug cambia o recibe responsable.' },
    { group: 'Bugs', id: 'bug.ready_for_retest', label: eventLabels['bug.ready_for_retest'], description: 'Un bug queda listo para volver a probar.' },
    { group: 'Bugs', id: 'bug.comment_added', label: eventLabels['bug.comment_added'], description: 'Se agrega un comentario a un bug.' },
    { group: 'Ejecuciones', id: 'execution.failed', label: eventLabels['execution.failed'], description: 'Una ejecucion termina fallida.' },
    { group: 'Ejecuciones', id: 'execution.blocked', label: eventLabels['execution.blocked'], description: 'Una ejecucion queda bloqueada.' },
    { group: 'IA', id: 'ai.execution.review_required', label: eventLabels['ai.execution.review_required'], description: 'Una ejecucion IA requiere revision humana.' },
    { group: 'IA', id: 'ai.execution.failed', label: eventLabels['ai.execution.failed'], description: 'Una ejecucion IA termina con error.' },
    { group: 'IA', id: 'ai.execution.completed', label: eventLabels['ai.execution.completed'], description: 'Una ejecucion IA completa correctamente.' },
    { group: 'IA', id: 'ai.engine.unavailable', label: eventLabels['ai.engine.unavailable'], description: 'El motor IA no esta disponible.' },
    { group: 'Usuarios y seguridad', id: 'auth.ad_user_provisioned', label: eventLabels['auth.ad_user_provisioned'], description: 'Se crea o habilita un usuario desde Active Directory/OIDC.' },
    { group: 'Usuarios y seguridad', id: 'auth.login_failed_many', label: eventLabels['auth.login_failed_many'], description: 'Se detectan demasiados intentos fallidos de login local.' },
    { group: 'Usuarios y seguridad', id: 'user.created', label: eventLabels['user.created'], description: 'Se crea un usuario Treseko.' },
    { group: 'Usuarios y seguridad', id: 'user.disabled', label: eventLabels['user.disabled'], description: 'Se deshabilita un usuario Treseko.' },
    { group: 'Usuarios y seguridad', id: 'user.role_changed', label: eventLabels['user.role_changed'], description: 'Cambia el rol global de un usuario.' },
    { group: 'Roles y proyectos', id: 'role.permissions_changed', label: eventLabels['role.permissions_changed'], description: 'Cambian permisos de un rol.' },
    { group: 'Roles y proyectos', id: 'project.member_added', label: eventLabels['project.member_added'], description: 'Se agrega un miembro a un proyecto.' },
    { group: 'Roles y proyectos', id: 'project.member_removed', label: eventLabels['project.member_removed'], description: 'Se remueve un miembro de un proyecto.' },
    { group: 'Builds y evidencia', id: 'build.activated', label: eventLabels['build.activated'], description: 'Se activa una build.' },
    { group: 'Builds y evidencia', id: 'build.closed', label: eventLabels['build.closed'], description: 'Se cierra una build.' },
    { group: 'Builds y evidencia', id: 'evidence.required_missing', label: eventLabels['evidence.required_missing'], description: 'Falta una evidencia requerida.' },
    { group: 'Automatizacion', id: 'automation.runner.offline', label: eventLabels['automation.runner.offline'], description: 'Un runner de automatizacion queda offline.' },
    { group: 'Reportes', id: 'report.shared', label: eventLabels['report.shared'], description: 'Se comparte un reporte.' },
    { group: 'Reportes', id: 'report.generated', label: eventLabels['report.generated'], description: 'Se genera un reporte.' },
    { group: 'Reportes', id: 'report.quality_gate_failed', label: eventLabels['report.quality_gate_failed'], description: 'Un reporte falla el quality gate.' },
  ]

  const channelLabels: Record<string, string> = {
    in_app: 'En app',
    email: 'Email',
  }

  const describeRecipients = (strategy: any) => {
    const parts: string[] = []
    if (strategy?.assignee) parts.push('asignado')
    if (strategy?.creator) parts.push('creador')
    if (Array.isArray(strategy?.project_roles) && strategy.project_roles.length) parts.push(`roles proyecto: ${strategy.project_roles.join(', ')}`)
    if (Array.isArray(strategy?.global_roles) && strategy.global_roles.length) parts.push(`roles globales: ${strategy.global_roles.join(', ')}`)
    if (Array.isArray(strategy?.explicit_emails) && strategy.explicit_emails.length) parts.push(`${strategy.explicit_emails.length} email(s) fijo(s)`)
    return parts.length ? parts.join(' · ') : 'Sin destinatarios definidos'
  }

  const describeConditions = (conditions: any) => {
    const any = Array.isArray(conditions?.any) ? conditions.any : []
    if (!any.length) return 'Siempre que ocurra el evento'
    return any.map((condition: any) => {
      const field = String(condition.field || '').replace('payload.', '')
      if (condition.op === 'severity_at_least') return `${field} al menos ${condition.value}`
      if (condition.op === 'in') return `${field} en ${(condition.value || []).join(', ')}`
      return `${field} ${condition.op || '='} ${condition.value}`
    }).join(' o ')
  }

  const ruleTemplateOptions = templates.filter(template => template.channel === 'email')
  const eventGroups = Array.from(new Set(eventCatalog.map(event => event.group)))

  const openRuleModal = (rule?: any) => {
    const draft = rule ? { ...rule } : {
      nombre: '',
      descripcion: '',
      enabled: true,
      scope: 'GLOBAL',
      event_types: [],
      conditions_json: {},
      actions_json: { channels: ['in_app', 'email'] },
      recipient_strategy_json: { global_roles: ['ADMIN'] },
      template_id: ruleTemplateOptions[0]?.id || null,
      cooldown_minutes: 0,
      priority: Math.max(100, ...rules.map(item => Number(item.priority || 0))) + 10,
    }
    setRuleDraft(draft)
    setRuleEventsText((draft.event_types || []).join(', '))
    setRuleConditionsText(JSON.stringify(draft.conditions_json || {}, null, 2))
    setRuleRecipientsText(JSON.stringify(draft.recipient_strategy_json || {}, null, 2))
    setShowRuleModal(true)
  }

  const parseRuleDraft = () => {
    if (!ruleDraft) throw new Error('Regla invalida')
    let conditions = {}
    let recipients = {}
    try {
      conditions = JSON.parse(ruleConditionsText || '{}')
      recipients = JSON.parse(ruleRecipientsText || '{}')
    } catch {
      throw new Error('Condiciones o destinatarios tienen JSON invalido')
    }
    const eventTypes = ruleEventsText.split(',').map(item => item.trim()).filter(Boolean)
    if (!ruleDraft.nombre?.trim()) throw new Error('El nombre de la regla es requerido')
    if (!eventTypes.length) throw new Error('Agrega al menos un evento')
    const channels = ruleDraft.actions_json?.channels || []
    if (!channels.length) throw new Error('Selecciona al menos un canal')
    return {
      nombre: ruleDraft.nombre.trim(),
      descripcion: ruleDraft.descripcion || null,
      enabled: !!ruleDraft.enabled,
      scope: ruleDraft.scope || 'GLOBAL',
      event_types: eventTypes,
      conditions_json: conditions,
      actions_json: { channels },
      recipient_strategy_json: recipients,
      template_id: ruleDraft.template_id || null,
      cooldown_minutes: Number(ruleDraft.cooldown_minutes || 0),
      priority: Number(ruleDraft.priority || 100),
    }
  }

  const safeJsonObject = (value: string) => {
    try {
      return JSON.parse(value || '{}')
    } catch {
      return {}
    }
  }

  const saveRuleDraft = async () => {
    try {
      const payload = parseRuleDraft()
      if (ruleDraft?.id) {
        await notificationClient.saveRule(fetchWithAuth, ruleDraft.id, payload)
      } else {
        await notificationClient.createRule(fetchWithAuth, payload)
      }
      setShowRuleModal(false)
      setRuleDraft(null)
      showFeedback('Reglas', 'Regla guardada.', 'success')
      await load()
    } catch (error: any) {
      showFeedback('Reglas', error.message || 'No se pudo guardar la regla.', 'danger')
    }
  }

  const deleteRuleDraft = async () => {
    if (!ruleDraft?.id) return
    try {
      await notificationClient.deleteRule(fetchWithAuth, ruleDraft.id)
      setShowRuleModal(false)
      setRuleDraft(null)
      showFeedback('Reglas', 'Regla eliminada.', 'success')
      await load()
    } catch (error: any) {
      showFeedback('Reglas', error.message || 'No se pudo eliminar la regla.', 'danger')
    }
  }

  const setRuleChannel = (channel: string, enabled: boolean) => {
    const current = ruleDraft?.actions_json?.channels || []
    const channels = enabled ? Array.from(new Set([...current, channel])) : current.filter((item: string) => item !== channel)
    setRuleDraft({ ...ruleDraft, actions_json: { ...(ruleDraft?.actions_json || {}), channels } })
  }

  const load = async () => {
    const [configPayload, rulesPayload, templatesPayload, deliveriesPayload, preferencesPayload, inboxPayload] = await Promise.all([
      notificationClient.getEmailConfig(fetchWithAuth),
      notificationClient.listRules(fetchWithAuth),
      notificationClient.listTemplates(fetchWithAuth),
      notificationClient.listDeliveries(fetchWithAuth, 10),
      notificationClient.listPreferences(fetchWithAuth),
      notificationClient.listInbox(fetchWithAuth, 10),
    ])
    setConfig(configPayload)
    setRules(rulesPayload)
    setTemplates(templatesPayload)
    setDeliveries(deliveriesPayload)
    setPreferences(preferencesPayload)
    setInbox(inboxPayload)
    const selected = selectedTemplateId ? templatesPayload.find((item: any) => item.id === selectedTemplateId) : templatesPayload[0]
    if (selected) {
      setSelectedTemplateId(selected.id)
      setTemplateDraft(selected)
    }
  }

  useEffect(() => { void load() }, [])

  const save = async () => {
    try {
      setConfig(await notificationClient.saveEmailConfig(fetchWithAuth, config))
      showFeedback('Correo', 'Configuracion SMTP guardada.', 'success')
    } catch (error: any) {
      showFeedback('Correo', error.message || 'No se pudo guardar SMTP.', 'danger')
    }
  }

  const sendTest = async () => {
    try {
      await notificationClient.sendTestEmail(fetchWithAuth, testEmail)
      showFeedback('SMTP test', 'Correo de prueba enviado y auditado.', 'success')
      await load()
    } catch (error: any) {
      showFeedback('SMTP test', error.message || 'No se pudo enviar el correo de prueba.', 'danger')
    }
  }

  const savePreference = async (eventType: string, channel: string, enabled: boolean) => {
    const next = [
      ...preferences.filter(item => !(item.event_type === eventType && item.channel === channel)),
      { event_type: eventType, channel, enabled, frequency: enabled ? 'immediate' : 'never' },
    ]
    setPreferences(await notificationClient.savePreferences(fetchWithAuth, next))
    showFeedback('Preferencias de correo', 'Preferencias de correo actualizadas.', 'success')
  }

  const updateRule = async (rule: any, patch: any) => {
    try {
      await notificationClient.saveRule(fetchWithAuth, rule.id, patch)
      showFeedback('Reglas', 'Regla actualizada.', 'success')
      await load()
    } catch (error: any) {
      showFeedback('Reglas', error.message || 'No se pudo actualizar la regla.', 'danger')
    }
  }

  const saveTemplate = async () => {
    if (!templateDraft) return
    try {
      const saved = await notificationClient.saveTemplate(fetchWithAuth, templateDraft.id, {
        subject_template: templateDraft.subject_template,
        text_template: templateDraft.text_template,
        enabled: !!templateDraft.enabled,
      })
      setTemplateDraft(saved)
      showFeedback('Plantillas', 'Plantilla actualizada.', 'success')
      await load()
    } catch (error: any) {
      showFeedback('Plantillas', error.message || 'No se pudo guardar la plantilla.', 'danger')
    }
  }

  const retryDelivery = async (delivery: any) => {
    try {
      await notificationClient.retryDelivery(fetchWithAuth, delivery.id)
      showFeedback('Auditoria', 'Entrega reencolada.', 'success')
      await load()
    } catch (error: any) {
      showFeedback('Auditoria', error.message || 'No se pudo reintentar la entrega.', 'danger')
    }
  }

  const processOutbox = async () => {
    try {
      await notificationClient.processOutbox(fetchWithAuth)
      showFeedback('Outbox', 'Procesamiento ejecutado.', 'success')
      await load()
    } catch (error: any) {
      showFeedback('Outbox', error.message || 'No se pudo procesar el outbox.', 'danger')
    }
  }

  const addEventToDraft = (eventType: string) => {
    const current = ruleEventsText.split(',').map(item => item.trim()).filter(Boolean)
    setRuleEventsText(Array.from(new Set([...current, eventType])).join(', '))
  }

  const markAllInboxRead = async () => {
    try {
      await notificationClient.markAllInboxRead(fetchWithAuth)
      await load()
    } catch (error: any) {
      showFeedback('Notificaciones en app', error.message || 'No se pudieron marcar como leidas.', 'danger')
    }
  }

  const markInboxRead = async (item: any) => {
    if (item.read_at) return
    try {
      await notificationClient.markInboxRead(fetchWithAuth, item.id)
      await load()
    } catch (error: any) {
      showFeedback('Notificaciones en app', error.message || 'No se pudo marcar la notificacion.', 'danger')
    }
  }

  return (
    <Card className="border-0 shadow-sm rounded-4 bg-white p-4">
      <div className="d-flex justify-content-between align-items-start mb-3">
        <div>
          <h6 className="fw-bold text-dark m-0"><Mail size={17} className="me-2" />Correo del sistema</h6>
          <span className="small text-muted">SMTP, plantillas para bugs e informes, reglas de envío y auditoría reciente de entregas.</span>
        </div>
        <Badge bg={config.enabled ? 'success' : 'secondary'}>{config.enabled ? 'SMTP activo' : 'SMTP inactivo'}</Badge>
      </div>
      <Row className="g-3">
        <Col md={3}><Form.Check type="switch" label="Habilitado" checked={!!config.enabled} disabled={!canEdit} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} /></Col>
        <Col md={5}><Form.Control size="sm" placeholder="Host SMTP" value={config.host || ''} disabled={!canEdit} onChange={(e) => setConfig({ ...config, host: e.target.value })} /></Col>
        <Col md={2}><Form.Control size="sm" type="number" placeholder="Puerto" value={config.port || 587} disabled={!canEdit} onChange={(e) => setConfig({ ...config, port: Number(e.target.value) })} /></Col>
        <Col md={2}><Form.Control size="sm" placeholder="Usuario" value={config.username || ''} disabled={!canEdit} onChange={(e) => setConfig({ ...config, username: e.target.value })} /></Col>
        <Col md={4}><Form.Control size="sm" placeholder="From email" value={config.from_email || ''} disabled={!canEdit} onChange={(e) => setConfig({ ...config, from_email: e.target.value })} /></Col>
        <Col md={4}><Form.Control size="sm" placeholder="From name" value={config.from_name || ''} disabled={!canEdit} onChange={(e) => setConfig({ ...config, from_name: e.target.value })} /></Col>
        <Col md={4}><Form.Control size="sm" placeholder="Base URL publica" value={config.base_url || ''} disabled={!canEdit} onChange={(e) => setConfig({ ...config, base_url: e.target.value })} /></Col>
        <Col md={3}><Form.Check type="switch" label="STARTTLS" checked={!!config.use_starttls} disabled={!canEdit} onChange={(e) => setConfig({ ...config, use_starttls: e.target.checked })} /></Col>
        <Col md={3}><Form.Check type="switch" label="SSL directo" checked={!!config.use_ssl} disabled={!canEdit} onChange={(e) => setConfig({ ...config, use_ssl: e.target.checked })} /></Col>
        <Col md={3}><Badge bg="light" text="dark" className="border">Clave SMTP: {config.password_configured ? 'configurada' : 'pendiente'}</Badge></Col>
        {canEdit && <Col md={3} className="text-end"><Button size="sm" onClick={save}><Save size={14} className="me-1" />Guardar SMTP</Button></Col>}
        <Col md={8}><Form.Control size="sm" type="email" placeholder="correo@empresa.com *" required value={testEmail} disabled={!canEdit} onChange={(e) => setTestEmail(e.target.value)} /></Col>
        {canEdit && <Col md={4}><Button size="sm" variant="outline-primary" className="w-100" onClick={sendTest} disabled={!testEmail}><Play size={14} className="me-1" />Enviar test</Button></Col>}
      </Row>
      <Row className="g-3 mt-2">
        <Col lg={12}>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <div>
              <div className="small fw-bold">Reglas de correo</div>
              <div className="x-small text-muted">Son las reglas predeterminadas activas en esta instalacion. Cada regla puede agrupar varios eventos.</div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <Badge bg="light" text="dark" className="border">{rules.length} reglas</Badge>
              <Badge bg="light" text="dark" className="border">{rules.filter(rule => rule.enabled).length} activas</Badge>
              <Button size="sm" variant="outline-secondary" onClick={() => setShowEventsModal(true)}>
                <Bell size={14} className="me-1" />Eventos
              </Button>
              {canEditRules && (
                <Button size="sm" variant="outline-primary" onClick={() => openRuleModal()}>
                  <Plus size={14} className="me-1" />Nueva regla
                </Button>
              )}
            </div>
          </div>
          <div className="d-flex flex-column gap-2">
            {rules.map(rule => {
              const channels = (rule.actions_json || {}).channels || []
              const eventTypes = rule.event_types || []
              return (
                <div key={rule.id} className="border rounded-3 bg-light-subtle px-3 py-2">
                  <div className="d-flex flex-wrap justify-content-between align-items-center gap-3">
                    <div className="flex-grow-1" style={{ minWidth: 220 }}>
                      <div className="d-flex flex-wrap align-items-center gap-2">
                        <span className="fw-bold text-dark">{rule.nombre}</span>
                        <Badge bg={rule.enabled ? 'success' : 'secondary'}>{rule.enabled ? 'Activa' : 'Inactiva'}</Badge>
                        <span className="x-small text-muted">{eventTypes.length} evento{eventTypes.length === 1 ? '' : 's'} · prioridad {rule.priority}</span>
                      </div>
                      <div className="small text-muted text-truncate">{describeConditions(rule.conditions_json)}</div>
                    </div>
                    <div className="d-flex flex-wrap align-items-center justify-content-end gap-2">
                      {channels.map((channel: string) => (
                        <Badge key={channel} bg={channel === 'email' ? 'primary' : 'info'} text={channel === 'email' ? undefined : 'dark'}>
                          <Send size={12} className="me-1" />{channelLabels[channel] || channel}
                        </Badge>
                      ))}
                      <Form.Check
                        type="switch"
                        id={`rule-${rule.id}`}
                        checked={!!rule.enabled}
                        disabled={!canEditRules}
                        onChange={(event) => updateRule(rule, { enabled: event.target.checked })}
                      />
                      <Button size="sm" variant="outline-secondary" onClick={() => openRuleModal(rule)}>
                        <Eye size={14} className="me-1" />Detalle
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
            {!rules.length && (
              <div className="border rounded-3 bg-light-subtle p-3 small text-muted">
                No hay reglas configuradas. Al inicializar notificaciones, Treseko siembra las reglas predeterminadas del sistema.
              </div>
            )}
          </div>
        </Col>
        <Col lg={12}>
          <div className="small fw-bold mb-2">Preferencias personales por correo</div>
          <div className="d-flex flex-wrap gap-3">
            {['bug.created', 'bug.assigned', 'execution.failed', 'ai.execution.review_required'].map(eventType => {
              const pref = preferences.find(item => item.event_type === eventType && item.channel === 'email')
              const enabled = pref ? pref.enabled && pref.frequency !== 'never' : true
              return (
                <Form.Check
                  key={eventType}
                  type="switch"
                  id={`pref-${eventType}`}
                  label={`${eventLabels[eventType] || eventType} por email`}
                  checked={enabled}
                  onChange={(event) => savePreference(eventType, 'email', event.target.checked)}
                />
              )
            })}
          </div>
        </Col>
        <Col lg={12}>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <div>
              <div className="small fw-bold">Notificaciones en app</div>
              <div className="x-small text-muted">Bandeja interna generada por reglas con canal En app.</div>
            </div>
            <div className="d-flex gap-2 align-items-center">
              <Badge bg="light" text="dark" className="border">{inbox.filter(item => !item.read_at).length} sin leer</Badge>
              <Button size="sm" variant="outline-secondary" onClick={markAllInboxRead} disabled={!inbox.some(item => !item.read_at)}>Marcar leidas</Button>
            </div>
          </div>
          <div className="border rounded-3 overflow-hidden">
            {inbox.slice(0, 6).map(item => (
              <button
                key={item.id}
                type="button"
                className={`btn btn-link w-100 text-start text-decoration-none border-bottom rounded-0 px-3 py-2 ${item.read_at ? 'bg-white text-muted' : 'bg-light text-dark'}`}
                onClick={() => markInboxRead(item)}
              >
                <div className="d-flex justify-content-between gap-2">
                  <span className="fw-semibold">{item.title}</span>
                  <Badge bg={item.read_at ? 'secondary' : 'primary'}>{item.read_at ? 'Leida' : 'Nueva'}</Badge>
                </div>
                <div className="small text-muted">{item.message}</div>
              </button>
            ))}
            {!inbox.length && (
              <div className="small text-muted px-3 py-3">Todavia no hay notificaciones internas para tu usuario.</div>
            )}
          </div>
        </Col>
        <Col lg={6}>
          <div className="small fw-bold mb-2">Plantillas</div>
          <Form.Select
            size="sm"
            className="mb-2"
            value={selectedTemplateId}
            onChange={(event) => {
              const selected = templates.find(item => item.id === event.target.value)
              setSelectedTemplateId(event.target.value)
              setTemplateDraft(selected || null)
            }}
          >
            {templates.map(t => <option key={t.id} value={t.id}>{t.key} · {t.channel}</option>)}
          </Form.Select>
          {templateDraft && (
            <div className="border rounded-3 p-2">
              <Form.Check
                type="switch"
                label={templateDraft.enabled ? 'Plantilla activa' : 'Plantilla inactiva'}
                checked={!!templateDraft.enabled}
                disabled={!canEditTemplates}
                onChange={(event) => setTemplateDraft({ ...templateDraft, enabled: event.target.checked })}
              />
              <Form.Control
                size="sm"
                className="my-2"
                value={templateDraft.subject_template || ''}
                disabled={!canEditTemplates}
                onChange={(event) => setTemplateDraft({ ...templateDraft, subject_template: event.target.value })}
              />
              <Form.Control
                as="textarea"
                rows={5}
                size="sm"
                value={templateDraft.text_template || ''}
                disabled={!canEditTemplates}
                onChange={(event) => setTemplateDraft({ ...templateDraft, text_template: event.target.value })}
              />
              {canEditTemplates && (
                <div className="text-end mt-2">
                  <Button size="sm" onClick={saveTemplate}><Save size={14} className="me-1" />Guardar plantilla</Button>
                </div>
              )}
            </div>
          )}
        </Col>
        <Col lg={6}>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <div className="small fw-bold">Auditoría de entregas</div>
            {canAdmin && <Button size="sm" variant="outline-secondary" onClick={processOutbox}><RotateCw size={14} className="me-1" />Procesar</Button>}
          </div>
          <Table size="sm" bordered responsive>
            <tbody>
              {deliveries.slice(0, 8).map(d => (
                <tr key={d.id}>
                  <td>{d.channel}</td>
                  <td className="small">{d.recipient_email || d.recipient_user_id}</td>
                  <td><Badge bg={d.status === 'SENT' ? 'success' : d.status === 'FAILED' ? 'danger' : 'secondary'}>{d.status}</Badge></td>
                  {canAdmin && (
                    <td className="text-end">
                      {['FAILED', 'CANCELLED', 'RETRY'].includes(d.status) && <Button size="sm" variant="link" className="p-0" onClick={() => retryDelivery(d)}>Retry</Button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        </Col>
      </Row>
      <Modal show={showRuleModal} onHide={() => setShowRuleModal(false)} centered size="lg" backdrop="static">
        <Modal.Header closeButton className="bg-light">
          <Modal.Title className="fw-bold fs-5 d-flex align-items-center gap-2">
            <Bell size={18} className="text-primary" /> {ruleDraft?.id ? 'Editar regla' : 'Nueva regla'}
          </Modal.Title>
        </Modal.Header>
        {ruleDraft && (
          <Modal.Body className="text-start">
            <Row className="g-3">
              <Col md={8}>
                <Form.Label className="x-small fw-bold text-muted">Nombre</Form.Label>
                <Form.Control size="sm" value={ruleDraft.nombre || ''} disabled={!canEditRules} onChange={(event) => setRuleDraft({ ...ruleDraft, nombre: event.target.value })} />
              </Col>
              <Col md={4}>
                <Form.Label className="x-small fw-bold text-muted">Prioridad</Form.Label>
                <Form.Control size="sm" type="number" value={ruleDraft.priority || 100} disabled={!canEditRules} onChange={(event) => setRuleDraft({ ...ruleDraft, priority: Number(event.target.value) })} />
              </Col>
              <Col md={12}>
                <Form.Label className="x-small fw-bold text-muted">Eventos</Form.Label>
                <div className="d-flex gap-2">
                  <Form.Control size="sm" value={ruleEventsText} disabled={!canEditRules} onChange={(event) => setRuleEventsText(event.target.value)} />
                  <Button size="sm" variant="outline-secondary" type="button" onClick={() => setShowEventsModal(true)}>Ver eventos</Button>
                </div>
                <div className="d-flex flex-wrap gap-1 mt-2">
                  {ruleEventsText.split(',').map(item => item.trim()).filter(Boolean).map(eventType => (
                    <Badge key={eventType} bg="light" text="dark" className="border fw-normal">{eventLabels[eventType] || eventType}</Badge>
                  ))}
                </div>
              </Col>
              <Col md={4}>
                <Form.Check type="switch" label="Activa" checked={!!ruleDraft.enabled} disabled={!canEditRules} onChange={(event) => setRuleDraft({ ...ruleDraft, enabled: event.target.checked })} />
              </Col>
              <Col md={4}>
                <Form.Check type="checkbox" label="En app" checked={(ruleDraft.actions_json?.channels || []).includes('in_app')} disabled={!canEditRules} onChange={(event) => setRuleChannel('in_app', event.target.checked)} />
              </Col>
              <Col md={4}>
                <Form.Check type="checkbox" label="Email" checked={(ruleDraft.actions_json?.channels || []).includes('email')} disabled={!canEditRules} onChange={(event) => setRuleChannel('email', event.target.checked)} />
              </Col>
              <Col md={6}>
                <Form.Label className="x-small fw-bold text-muted">Plantilla email</Form.Label>
                <Form.Select size="sm" value={ruleDraft.template_id || ''} disabled={!canEditRules} onChange={(event) => setRuleDraft({ ...ruleDraft, template_id: event.target.value || null })}>
                  <option value="">Sin plantilla</option>
                  {ruleTemplateOptions.map(template => <option key={template.id} value={template.id}>{template.key}</option>)}
                </Form.Select>
              </Col>
              <Col md={6}>
                <Form.Label className="x-small fw-bold text-muted">Cooldown minutos</Form.Label>
                <Form.Control size="sm" type="number" value={ruleDraft.cooldown_minutes || 0} disabled={!canEditRules} onChange={(event) => setRuleDraft({ ...ruleDraft, cooldown_minutes: Number(event.target.value) })} />
              </Col>
              <Col md={12}>
                <Form.Label className="x-small fw-bold text-muted">Destinatarios JSON</Form.Label>
                <Form.Control as="textarea" rows={4} size="sm" value={ruleRecipientsText} disabled={!canEditRules} onChange={(event) => setRuleRecipientsText(event.target.value)} />
              </Col>
              <Col md={12}>
                <Form.Label className="x-small fw-bold text-muted">Condiciones JSON</Form.Label>
                <Form.Control as="textarea" rows={4} size="sm" value={ruleConditionsText} disabled={!canEditRules} onChange={(event) => setRuleConditionsText(event.target.value)} />
              </Col>
              <Col md={12}>
                <div className="small text-muted d-flex align-items-start gap-2">
                  <Users size={14} className="mt-1 flex-shrink-0" />
                  <span>{describeRecipients(safeJsonObject(ruleRecipientsText))}</span>
                </div>
              </Col>
            </Row>
          </Modal.Body>
        )}
        <Modal.Footer className="bg-light">
          {ruleDraft?.id && canEditRules && (
            <Button variant="outline-danger" className="me-auto" onClick={deleteRuleDraft}>
              <Trash2 size={14} className="me-1" />Eliminar
            </Button>
          )}
          <Button variant="outline-secondary" onClick={() => setShowRuleModal(false)}>Cancelar</Button>
          {canEditRules && <Button onClick={saveRuleDraft}><Save size={14} className="me-1" />Guardar</Button>}
        </Modal.Footer>
      </Modal>
      <Modal show={showEventsModal} onHide={() => setShowEventsModal(false)} centered size="xl">
        <Modal.Header closeButton className="bg-light">
          <Modal.Title className="fw-bold fs-5 d-flex align-items-center gap-2">
            <Bell size={18} className="text-primary" /> Eventos disponibles para reglas
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="text-start">
          <div className="small text-muted mb-3">
            Usa el nombre tecnico en el campo Eventos. Las reglas se disparan cuando Treseko emite uno de estos eventos.
          </div>
          {eventGroups.map(group => (
            <div key={group} className="mb-3">
              <div className="fw-bold small text-uppercase text-muted mb-2">{group}</div>
              <div className="d-flex flex-column gap-2">
                {eventCatalog.filter(event => event.group === group).map(event => (
                  <div key={event.id} className="border rounded-3 p-2 d-flex flex-wrap justify-content-between gap-2">
                    <div>
                      <div className="fw-semibold">{event.label}</div>
                      <div className="small text-muted">{event.description}</div>
                      <code className="small">{event.id}</code>
                    </div>
                    {ruleDraft && canEditRules && (
                      <Button size="sm" variant="outline-primary" onClick={() => addEventToDraft(event.id)}>
                        Agregar
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Modal.Body>
      </Modal>
    </Card>
  )
}
