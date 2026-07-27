import { useEffect, useState } from 'react'
import { Accordion, Badge, Button, Card, Col, Form, Modal, Row, Table } from 'react-bootstrap'
import { Bell, Eye, Mail, Play, Plus, RotateCw, Save, Send, Trash2, Users } from 'lucide-react'
import { notificationClient } from '../../../notificaciones/notificationClient'

type Props = {
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
  canAccessCapability: (capabilityId: any, level?: any) => boolean
  projects?: any[]
}

export function NotificationsSettingsTab({ fetchWithAuth, showFeedback, canAccessCapability, projects = [] }: Props) {
  const [config, setConfig] = useState<any>({ enabled: false, host: '', port: 587, use_starttls: true, use_ssl: false, from_email: '', from_name: 'Treseko', base_url: 'http://localhost:5173' })
  const [testEmail, setTestEmail] = useState('')
  const [rules, setRules] = useState<any[]>([])
  const [templates, setTemplates] = useState<any[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [templateDraft, setTemplateDraft] = useState<any | null>(null)
  const [templatePreview, setTemplatePreview] = useState<any | null>(null)
  const [deliveries, setDeliveries] = useState<any[]>([])
  const [preferences, setPreferences] = useState<any[]>([])
  const [showRuleModal, setShowRuleModal] = useState(false)
  const [showEventsModal, setShowEventsModal] = useState(false)
  const [ruleDraft, setRuleDraft] = useState<any | null>(null)
  const [ruleEventsText, setRuleEventsText] = useState('')
  const [ruleConditionsText, setRuleConditionsText] = useState('{}')
  const [ruleRecipientsText, setRuleRecipientsText] = useState('{}')
  const [inbox, setInbox] = useState<any[]>([])
  const [stakeholderProjectId, setStakeholderProjectId] = useState('')
  const [stakeholders, setStakeholders] = useState<any[]>([])
  const [digests, setDigests] = useState<any[]>([])
  const [stakeholderDraft, setStakeholderDraft] = useState({ nombre: '', email: '', consent_source: 'manual', allowed_event_types: ['report.exported', 'project.closed'] })
  const [stakeholderSchedule, setStakeholderSchedule] = useState({ frequency: 'daily', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', send_hour: 9, send_day: 1 })
  const [mySchedule, setMySchedule] = useState({ proyectoId: '', frequency: 'daily', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', send_hour: 9, send_day: 1, mutedUntil: '' })
  const canEdit = canAccessCapability('notificaciones.configuracion', 'edit')
  const canEditRules = canAccessCapability('notificaciones.reglas', 'edit')
  const canEditTemplates = canAccessCapability('notificaciones.plantillas', 'edit')
  const canAdmin = canAccessCapability('notificaciones.admin', 'edit')
  const canReadAudit = canAccessCapability('notificaciones.auditoria', 'read')
  const canManageStakeholders = canAccessCapability('notificaciones.destinatarios', 'edit')
  const canReadDigests = canAccessCapability('notificaciones.resumenes', 'read')
  const canEditOwnSubscriptions = canAccessCapability('notificaciones.inbox', 'edit')

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
    const [configPayload, rulesPayload, templatesPayload, deliveriesPayload, preferencesPayload, inboxPayload, digestsPayload] = await Promise.all([
      canAccessCapability('notificaciones.configuracion', 'read') ? notificationClient.getEmailConfig(fetchWithAuth) : Promise.resolve(config),
      canAccessCapability('notificaciones.reglas', 'read') ? notificationClient.listRules(fetchWithAuth) : Promise.resolve([]),
      canAccessCapability('notificaciones.plantillas', 'read') ? notificationClient.listTemplates(fetchWithAuth) : Promise.resolve([]),
      canReadAudit ? notificationClient.listDeliveries(fetchWithAuth, 10) : Promise.resolve([]),
      notificationClient.listPreferences(fetchWithAuth),
      notificationClient.listInbox(fetchWithAuth, 10),
      canReadDigests ? notificationClient.listDigests(fetchWithAuth) : Promise.resolve([]),
    ])
    setConfig(configPayload)
    setRules(rulesPayload)
    setTemplates(templatesPayload)
    setDeliveries(deliveriesPayload)
    setPreferences(preferencesPayload)
    setInbox(inboxPayload)
    setDigests(digestsPayload)
    const selected = selectedTemplateId ? templatesPayload.find((item: any) => item.id === selectedTemplateId) : templatesPayload[0]
    if (selected) {
      setSelectedTemplateId(selected.id)
      setTemplateDraft(selected)
    }
  }

  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (!stakeholderProjectId || !canAccessCapability('notificaciones.destinatarios', 'read')) {
      setStakeholders([])
      return
    }
    notificationClient.listStakeholders(fetchWithAuth, stakeholderProjectId)
      .then(setStakeholders)
      .catch((error: any) => showFeedback('Stakeholders', error.message || 'No se pudieron cargar los destinatarios del proyecto.', 'danger'))
  }, [stakeholderProjectId])

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

  const testConnection = async () => {
    try {
      await notificationClient.testEmailConnection(fetchWithAuth)
      showFeedback('SMTP', 'La conexión y autenticación SMTP se verificaron sin enviar un correo.', 'success')
    } catch (error: any) {
      showFeedback('SMTP', error.message || 'No se pudo verificar la conexión SMTP.', 'danger')
    }
  }

  const savePreference = async (eventType: string, channel: string, enabled: boolean, frequency = 'daily') => {
    const next = [
      ...preferences.filter(item => !(item.event_type === eventType && item.channel === channel)),
      { event_type: eventType, channel, enabled, frequency: enabled ? frequency : 'never' },
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
        html_template: templateDraft.html_template,
        enabled: !!templateDraft.enabled,
      })
      setTemplateDraft(saved)
      showFeedback('Plantillas', 'Plantilla actualizada.', 'success')
      await load()
    } catch (error: any) {
      showFeedback('Plantillas', error.message || 'No se pudo guardar la plantilla.', 'danger')
    }
  }

  const previewTemplate = async () => {
    if (!templateDraft) return
    try {
      setTemplatePreview(await notificationClient.previewTemplate(fetchWithAuth, templateDraft.id, {
        platform: { name: config.from_name || 'Treseko' }, user: { nombre: 'Usuario de prueba', email: 'usuario@example.com' },
        proyecto: { nombre: 'Proyecto de prueba' }, message: 'Este es un ejemplo seguro de la notificación.',
      }))
    } catch (error: any) {
      showFeedback('Vista previa', error.message || 'No se pudo generar la vista previa.', 'danger')
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

  const createStakeholder = async () => {
    if (!stakeholderProjectId) return showFeedback('Stakeholders', 'Selecciona un proyecto.', 'warning')
    try {
      const created = await notificationClient.createStakeholder(fetchWithAuth, stakeholderProjectId, stakeholderDraft)
      await notificationClient.saveStakeholderSubscription(fetchWithAuth, created.id, { event_type: null, channel: 'email', enabled: true, ...stakeholderSchedule })
      setStakeholderDraft({ nombre: '', email: '', consent_source: 'manual', allowed_event_types: ['report.exported', 'project.closed'] })
      setStakeholders(await notificationClient.listStakeholders(fetchWithAuth, stakeholderProjectId))
      showFeedback('Stakeholders', 'Destinatario externo agregado al proyecto.', 'success')
    } catch (error: any) {
      showFeedback('Stakeholders', error.message || 'No se pudo agregar el destinatario.', 'danger')
    }
  }

  const deactivateStakeholder = async (stakeholder: any) => {
    try {
      await notificationClient.updateStakeholder(fetchWithAuth, stakeholder.id, { active: false })
      setStakeholders(await notificationClient.listStakeholders(fetchWithAuth, stakeholderProjectId))
      showFeedback('Stakeholders', 'Destinatario dado de baja. Se conserva su auditoría.', 'success')
    } catch (error: any) {
      showFeedback('Stakeholders', error.message || 'No se pudo dar de baja el destinatario.', 'danger')
    }
  }

  const saveMySchedule = async () => {
    try {
      await notificationClient.saveMySubscription(fetchWithAuth, {
        event_type: null,
        channel: 'email',
        enabled: true,
        frequency: mySchedule.frequency,
        timezone: mySchedule.timezone,
        send_hour: Number(mySchedule.send_hour),
        send_day: ['weekly', 'monthly'].includes(mySchedule.frequency) ? Number(mySchedule.send_day) : null,
        muted_until: mySchedule.mutedUntil ? new Date(mySchedule.mutedUntil).toISOString() : null,
      }, mySchedule.proyectoId || undefined)
      showFeedback('Resúmenes', 'Tu preferencia de resumen fue guardada.', 'success')
    } catch (error: any) {
      showFeedback('Resúmenes', error.message || 'No se pudo guardar tu preferencia.', 'danger')
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
          <h6 className="fw-bold text-dark m-0"><Mail size={17} className="me-2" />Correo y notificaciones</h6>
          <span className="small text-muted">Define desde qué dirección se envían los avisos y comprobá la configuración con un correo de prueba.</span>
        </div>
        <Badge bg={config.enabled ? 'success' : 'secondary'}>{config.enabled ? 'SMTP activo' : 'SMTP inactivo'}</Badge>
      </div>
      <Row className="g-3">
        <Col md={12}>
          <Form.Check type="switch" className="fw-semibold" label="Enviar notificaciones por correo" checked={!!config.enabled} disabled={!canEdit} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} />
          <div className="app-meta text-muted ms-5">Al activarlo, Treseko podrá enviar los avisos configurados a sus destinatarios.</div>
        </Col>
        <Col md={12}>
          <Form.Check type="switch" className="fw-semibold" label="Modo de prueba seguro" checked={!!config.test_mode} disabled={!canEdit} onChange={(e) => setConfig({ ...config, test_mode: e.target.checked })} />
          <div className="app-meta text-muted ms-5">Mientras esté activo, el outbox no envía avisos normales y la prueba sólo puede llegar a tu email verificado.</div>
        </Col>
        <Col md={6}>
          <Form.Label className="app-label fw-bold text-muted">Nombre que verá el destinatario</Form.Label>
          <Form.Control value={config.from_name || ''} placeholder="Ej.: Equipo de calidad" disabled={!canEdit} onChange={(e) => setConfig({ ...config, from_name: e.target.value })} />
        </Col>
        <Col md={6}>
          <Form.Label className="app-label fw-bold text-muted">Responder a</Form.Label>
          <Form.Control type="email" value={config.reply_to || ''} placeholder="soporte@tuempresa.com (opcional)" disabled={!canEdit} onChange={(e) => setConfig({ ...config, reply_to: e.target.value })} />
          <div className="app-meta text-muted mt-1">Los destinatarios verán un único remitente institucional; Treseko no crea casillas personales.</div>
        </Col>
        <Col md={6}>
          <Form.Label className="app-label fw-bold text-muted">Dirección desde la que se envía</Form.Label>
          <Form.Control type="email" value={config.from_email || ''} placeholder="notificaciones@tuempresa.com" disabled={!canEdit} onChange={(e) => setConfig({ ...config, from_email: e.target.value })} />
        </Col>
        <Col md={8}>
          <Form.Label className="app-label fw-bold text-muted">Enviar correo de prueba a</Form.Label>
          <Form.Control type="email" placeholder="tu.correo@empresa.com" value={testEmail} disabled={!canEdit} onChange={(e) => setTestEmail(e.target.value)} />
        </Col>
        {canEdit && <Col md={4} className="align-self-end d-flex gap-2"><Button variant="outline-secondary" className="rounded-pill fw-bold text-nowrap" onClick={testConnection}><RotateCw size={16} className="me-1" />Probar SMTP</Button><Button variant="outline-primary" className="flex-grow-1 rounded-pill fw-bold" onClick={sendTest} disabled={!testEmail}><Play size={16} className="me-2" />Enviar prueba</Button></Col>}
        {canEdit && <Col md={12} className="text-end"><Button onClick={save} className="app-save-button"><Save size={16} />Guardar configuración de correo</Button></Col>}
      </Row>
      <Accordion className="mt-4 notifications-settings-advanced" defaultActiveKey={config.enabled && config.host ? undefined : 'connection'}>
        <Accordion.Item eventKey="connection">
          <Accordion.Header>Configuración del proveedor de correo</Accordion.Header>
          <Accordion.Body>
            <p className="app-meta text-muted mb-3">Estos datos los proporciona tu servicio de correo (Google Workspace, Microsoft 365 u otro proveedor SMTP).</p>
            <Row className="g-3">
              <Col md={6}><Form.Label className="app-label fw-bold text-muted">Servidor SMTP</Form.Label><Form.Control size="sm" placeholder="smtp.tuempresa.com" value={config.host || ''} disabled={!canEdit} onChange={(e) => setConfig({ ...config, host: e.target.value })} /></Col>
              <Col md={2}><Form.Label className="app-label fw-bold text-muted">Puerto</Form.Label><Form.Control size="sm" type="number" value={config.port || 587} disabled={!canEdit} onChange={(e) => setConfig({ ...config, port: Number(e.target.value) })} /></Col>
              <Col md={4}><Form.Label className="app-label fw-bold text-muted">Usuario SMTP</Form.Label><Form.Control size="sm" placeholder="usuario@tuempresa.com" value={config.username || ''} disabled={!canEdit} onChange={(e) => setConfig({ ...config, username: e.target.value })} /></Col>
              <Col md={6}><Form.Label className="app-label fw-bold text-muted">URL pública de Treseko</Form.Label><Form.Control size="sm" placeholder="https://qa.tuempresa.com" value={config.base_url || ''} disabled={!canEdit} onChange={(e) => setConfig({ ...config, base_url: e.target.value })} /></Col>
              <Col md={3} className="d-flex align-items-end"><Form.Check type="switch" label="Usar STARTTLS (recomendado)" checked={!!config.use_starttls} disabled={!canEdit} onChange={(e) => setConfig({ ...config, use_starttls: e.target.checked })} /></Col>
              <Col md={3} className="d-flex align-items-end"><Form.Check type="switch" label="Usar SSL directo" checked={!!config.use_ssl} disabled={!canEdit} onChange={(e) => setConfig({ ...config, use_ssl: e.target.checked })} /></Col>
              <Col md={4}><Form.Label className="app-label fw-bold text-muted">Límite diario</Form.Label><Form.Control size="sm" type="number" value={config.daily_send_limit || 500} disabled={!canEdit} onChange={(e) => setConfig({ ...config, daily_send_limit: Number(e.target.value) })} /></Col>
              <Col md={8} className="d-flex align-items-end"><Badge bg="light" text="dark" className="border">Contraseña SMTP: {config.password_configured ? 'configurada' : 'pendiente de configurar'} · nunca se muestra ni se guarda desde esta pantalla</Badge></Col>
            </Row>
          </Accordion.Body>
        </Accordion.Item>
        <Accordion.Item eventKey="automation">
          <Accordion.Header>Automatización, plantillas y actividad reciente</Accordion.Header>
          <Accordion.Body>
      <Row className="g-3">
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
          <div className="small fw-bold mb-1">Preferencias personales por correo</div>
          <div className="x-small text-muted mb-2">La actividad normal se agrupa en un resumen. Las alertas críticas pueden llegar de forma inmediata.</div>
          <div className="d-flex flex-column gap-2">
            {['bug.created', 'bug.assigned', 'execution.failed', 'ai.execution.review_required'].map(eventType => {
              const pref = preferences.find(item => item.event_type === eventType && item.channel === 'email')
              const enabled = pref ? pref.enabled && pref.frequency !== 'never' : true
              return <div key={eventType} className="d-flex flex-wrap align-items-center gap-2 border rounded-3 px-2 py-1 bg-light-subtle">
                <Form.Check type="switch" id={`pref-${eventType}`} label={`${eventLabels[eventType] || eventType} por email`} checked={enabled} onChange={(event) => savePreference(eventType, 'email', event.target.checked, pref?.frequency || 'daily')} />
                <Form.Select size="sm" aria-label={`Frecuencia ${eventLabels[eventType] || eventType}`} value={pref?.frequency || 'daily'} disabled={!enabled} style={{ width: 180 }} onChange={(event) => savePreference(eventType, 'email', true, event.target.value)}>
                  <option value="immediate">Inmediata</option><option value="daily">Resumen diario</option><option value="weekly">Resumen semanal</option><option value="monthly">Resumen mensual</option><option value="never">No enviar</option>
                </Form.Select>
              </div>
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
        {canReadAudit && <Col lg={6}>
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
              <Form.Label className="x-small fw-bold text-muted mt-2">HTML compatible con Gmail/Outlook (opcional)</Form.Label>
              <Form.Control as="textarea" rows={4} size="sm" value={templateDraft.html_template || ''} disabled={!canEditTemplates} onChange={(event) => setTemplateDraft({ ...templateDraft, html_template: event.target.value })} placeholder="HTML sanitizado por el servidor; sin scripts ni recursos remotos." />
              <div className="d-flex justify-content-between gap-2 mt-2">
                <Button size="sm" variant="outline-secondary" onClick={previewTemplate}><Eye size={14} className="me-1" />Vista previa</Button>
                {canEditTemplates && (
                  <Button size="sm" onClick={saveTemplate} className="app-save-button"><Save size={14} />Guardar plantilla</Button>
                )}
              </div>
              {templatePreview && <div className="mt-2 border rounded-3 overflow-hidden"><div className="small fw-semibold bg-light px-2 py-1">{templatePreview.subject || 'Sin asunto'}</div>{templatePreview.html ? <iframe title="Vista previa de correo" sandbox="" className="w-100 border-0" style={{ minHeight: 180 }} srcDoc={templatePreview.html} /> : <pre className="small p-2 mb-0 text-wrap">{templatePreview.text}</pre>}</div>}
            </div>
          )}
        </Col>}
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
          </Accordion.Body>
        </Accordion.Item>
        <Accordion.Item eventKey="digests">
          <Accordion.Header>Resúmenes programados</Accordion.Header>
          <Accordion.Body>
            <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
              <p className="app-meta text-muted mb-0">Los resúmenes agrupan actividad por destinatario, proyecto y período. Los eventos críticos pueden seguir siendo inmediatos.</p>
              {canAdmin && <Button size="sm" variant="outline-secondary" className="rounded-pill" onClick={async () => { try { await notificationClient.processDigests(fetchWithAuth); await load(); showFeedback('Resúmenes', 'Se procesaron los resúmenes pendientes.', 'success') } catch (error: any) { showFeedback('Resúmenes', error.message || 'No se pudieron procesar los resúmenes.', 'danger') } }}><RotateCw size={14} className="me-1" />Procesar pendientes</Button>}
            </div>
            {canEditOwnSubscriptions && <div className="border rounded-3 p-3 mb-3 bg-light-subtle">
              <div className="small fw-bold mb-2">Mi resumen por correo</div>
              <Row className="g-2 align-items-end">
                <Col md={3}><Form.Label className="app-label fw-bold text-muted">Proyecto</Form.Label><Form.Select size="sm" value={mySchedule.proyectoId} onChange={(e) => setMySchedule({ ...mySchedule, proyectoId: e.target.value })}><option value="">Todos los proyectos permitidos</option>{projects.map(project => <option key={project.id} value={project.id}>{project.nombre || project.name}</option>)}</Form.Select></Col>
                <Col md={2}><Form.Label className="app-label fw-bold text-muted">Frecuencia</Form.Label><Form.Select size="sm" value={mySchedule.frequency} onChange={(e) => setMySchedule({ ...mySchedule, frequency: e.target.value })}><option value="daily">Diario</option><option value="weekly">Semanal</option><option value="monthly">Mensual</option><option value="never">No enviar</option></Form.Select></Col>
                <Col md={3}><Form.Label className="app-label fw-bold text-muted">Zona horaria</Form.Label><Form.Control size="sm" value={mySchedule.timezone} onChange={(e) => setMySchedule({ ...mySchedule, timezone: e.target.value })} /></Col>
                <Col md={1}><Form.Label className="app-label fw-bold text-muted">Hora</Form.Label><Form.Control size="sm" type="number" min="0" max="23" value={mySchedule.send_hour} onChange={(e) => setMySchedule({ ...mySchedule, send_hour: Number(e.target.value) })} /></Col>
                <Col md={1}><Form.Label className="app-label fw-bold text-muted">Día</Form.Label><Form.Control size="sm" type="number" min="1" max={mySchedule.frequency === 'weekly' ? '7' : '31'} value={mySchedule.send_day} disabled={!['weekly', 'monthly'].includes(mySchedule.frequency)} onChange={(e) => setMySchedule({ ...mySchedule, send_day: Number(e.target.value) })} /></Col>
                <Col md={2}><Button size="sm" className="w-100 rounded-pill" onClick={saveMySchedule}>Guardar</Button></Col>
                <Col md={5}><Form.Label className="app-label fw-bold text-muted">Silenciar hasta</Form.Label><Form.Control size="sm" type="datetime-local" value={mySchedule.mutedUntil} onChange={(e) => setMySchedule({ ...mySchedule, mutedUntil: e.target.value })} /></Col>
              </Row>
            </div>}
            {!canReadDigests && <div className="small text-muted">No tenés permiso para consultar resúmenes programados.</div>}
            {canReadDigests && <Table size="sm" responsive hover className="mb-0">
              <thead><tr><th>Destinatario</th><th>Proyecto</th><th>Frecuencia</th><th>Período</th><th>Próximo envío</th><th>Estado</th></tr></thead>
              <tbody>{digests.slice(0, 20).map(digest => <tr key={digest.id}><td>{digest.recipient_email}</td><td>{projects.find(project => project.id === digest.proyecto_id)?.nombre || 'Global'}</td><td>{({ daily: 'Diario', weekly: 'Semanal', monthly: 'Mensual', on_report_export: 'Al exportar reporte', on_build_closure: 'Al cerrar build', on_project_closure: 'Al cerrar proyecto' } as any)[digest.frequency] || digest.frequency}</td><td className="small">{new Date(digest.period_start).toLocaleDateString()} – {new Date(digest.period_end).toLocaleDateString()}</td><td className="small">{digest.scheduled_for ? new Date(digest.scheduled_for).toLocaleString() : 'Al ocurrir el evento'}</td><td><Badge bg={digest.status === 'SENT' ? 'success' : digest.status === 'FAILED' ? 'danger' : 'secondary'}>{digest.status}</Badge></td></tr>)}</tbody>
            </Table>}
            {canReadDigests && !digests.length && <div className="small text-muted py-2">Todavía no hay resúmenes generados. Se crearán cuando ocurra actividad compatible con una regla y destinatario.</div>}
          </Accordion.Body>
        </Accordion.Item>
        <Accordion.Item eventKey="stakeholders">
          <Accordion.Header>Stakeholders externos por proyecto</Accordion.Header>
          <Accordion.Body>
            <p className="app-meta text-muted">Los destinatarios externos no reciben acceso a Treseko. Sólo reciben los eventos permitidos del proyecto elegido.</p>
            <Row className="g-2 align-items-end">
              <Col md={4}><Form.Label className="app-label fw-bold text-muted">Proyecto</Form.Label><Form.Select size="sm" value={stakeholderProjectId} onChange={(e) => setStakeholderProjectId(e.target.value)}><option value="">Seleccionar proyecto…</option>{projects.map(project => <option key={project.id} value={project.id}>{project.nombre || project.name}</option>)}</Form.Select></Col>
              <Col md={3}><Form.Label className="app-label fw-bold text-muted">Nombre</Form.Label><Form.Control size="sm" value={stakeholderDraft.nombre} disabled={!canManageStakeholders} onChange={(e) => setStakeholderDraft({ ...stakeholderDraft, nombre: e.target.value })} /></Col>
              <Col md={3}><Form.Label className="app-label fw-bold text-muted">Email</Form.Label><Form.Control size="sm" type="email" value={stakeholderDraft.email} disabled={!canManageStakeholders} onChange={(e) => setStakeholderDraft({ ...stakeholderDraft, email: e.target.value })} /></Col>
              <Col md={2}>{canManageStakeholders && <Button size="sm" className="w-100 rounded-pill" onClick={createStakeholder} disabled={!stakeholderDraft.nombre || !stakeholderDraft.email}><Plus size={14} className="me-1" />Agregar</Button>}</Col>
              <Col md={12}><Form.Label className="app-label fw-bold text-muted">Eventos permitidos</Form.Label><Form.Select size="sm" multiple value={stakeholderDraft.allowed_event_types} disabled={!canManageStakeholders} onChange={(e) => setStakeholderDraft({ ...stakeholderDraft, allowed_event_types: Array.from(e.currentTarget.selectedOptions).map(option => option.value) })}><option value="report.exported">Reporte exportado</option><option value="report.shared">Reporte compartido</option><option value="build.closed">Cierre de build</option><option value="project.closed">Cierre de proyecto</option></Form.Select></Col>
              <Col md={4}><Form.Label className="app-label fw-bold text-muted">Frecuencia inicial</Form.Label><Form.Select size="sm" value={stakeholderSchedule.frequency} disabled={!canManageStakeholders} onChange={(e) => setStakeholderSchedule({ ...stakeholderSchedule, frequency: e.target.value })}><option value="immediate">Inmediata</option><option value="daily">Resumen diario</option><option value="weekly">Resumen semanal</option><option value="monthly">Resumen mensual</option><option value="on_report_export">Al exportar reporte</option><option value="on_build_closure">Al cerrar build</option><option value="on_project_closure">Al cerrar proyecto</option></Form.Select></Col>
              <Col md={5}><Form.Label className="app-label fw-bold text-muted">Zona horaria</Form.Label><Form.Control size="sm" value={stakeholderSchedule.timezone} disabled={!canManageStakeholders} onChange={(e) => setStakeholderSchedule({ ...stakeholderSchedule, timezone: e.target.value })} /></Col>
              <Col md={2}><Form.Label className="app-label fw-bold text-muted">Hora del resumen</Form.Label><Form.Control size="sm" type="number" min="0" max="23" value={stakeholderSchedule.send_hour} disabled={!canManageStakeholders} onChange={(e) => setStakeholderSchedule({ ...stakeholderSchedule, send_hour: Number(e.target.value) })} /></Col>
              <Col md={1}><Form.Label className="app-label fw-bold text-muted">Día</Form.Label><Form.Control size="sm" type="number" min="1" max={stakeholderSchedule.frequency === 'weekly' ? '7' : '31'} value={stakeholderSchedule.send_day} disabled={!canManageStakeholders || !['weekly', 'monthly'].includes(stakeholderSchedule.frequency)} onChange={(e) => setStakeholderSchedule({ ...stakeholderSchedule, send_day: Number(e.target.value) })} /></Col>
            </Row>
            <div className="mt-3 border rounded-3 overflow-hidden">
              {stakeholders.map(stakeholder => <div key={stakeholder.id} className="d-flex flex-wrap align-items-center justify-content-between gap-2 border-bottom px-3 py-2"><div><span className="fw-semibold">{stakeholder.nombre}</span><span className="small text-muted ms-2">{stakeholder.email}</span><div className="x-small text-muted">{(stakeholder.allowed_event_types || []).join(' · ') || 'Sin eventos habilitados'}</div></div><div className="d-flex align-items-center gap-2"><Badge bg={stakeholder.active ? 'success' : 'secondary'}>{stakeholder.active ? 'Activo' : 'Baja'}</Badge>{stakeholder.active && canManageStakeholders && <Button size="sm" variant="outline-danger" onClick={() => deactivateStakeholder(stakeholder)}>Dar de baja</Button>}</div></div>)}
              {stakeholderProjectId && !stakeholders.length && <div className="small text-muted p-3">No hay destinatarios externos para este proyecto.</div>}
            </div>
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
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
          {canEditRules && <Button onClick={saveRuleDraft} className="app-save-button"><Save size={14} />Guardar</Button>}
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
