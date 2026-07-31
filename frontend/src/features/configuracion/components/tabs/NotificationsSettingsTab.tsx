import { useEffect, useState } from 'react'
import { Accordion, Badge, Button, Card, Col, Form, Modal, Row, Table } from 'react-bootstrap'
import { Bell, Eye, Mail, Play, Plus, RotateCw, Save, Send, Trash2, Users } from 'lucide-react'
import { notificationClient } from '../../../notificaciones/notificationClient'
import { useI18n } from '../../../../i18n'
import { NotificationsSettingsView } from './NotificationsSettingsView'

type Props = {
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
  canAccessCapability: (capabilityId: any, level?: any) => boolean
  projects?: any[]
}

export function NotificationsSettingsTab({ fetchWithAuth, showFeedback, canAccessCapability, projects = [] }: Props) {
  const { t } = useI18n()
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
    'bug.created': t('notifications.bugCreated'), 'bug.created_from_snapshot': t('notifications.bugCreatedSnapshot'), 'bug.created_from_execution': t('notifications.bugCreatedExecution'),
    'bug.assigned': t('notifications.bugAssigned'), 'bug.ready_for_retest': t('notifications.bugRetest'), 'bug.comment_added': t('notifications.bugComment'),
    'execution.failed': t('notifications.executionFailed'), 'execution.blocked': t('notifications.executionBlocked'), 'ai.execution.review_required': t('notifications.aiReviewRequired'),
    'ai.execution.failed': t('notifications.aiFailed'), 'ai.engine.unavailable': t('notifications.aiUnavailable'), 'auth.ad_user_provisioned': t('notifications.adProvisioned'),
    'user.created': t('notifications.userCreated'), 'user.disabled': t('notifications.userDisabled'), 'user.role_changed': t('notifications.roleChanged'),
    'role.permissions_changed': t('notifications.permissionsChanged'), 'project.member_added': t('notifications.memberAdded'), 'project.member_removed': t('notifications.memberRemoved'),
    'build.activated': t('notifications.buildActivated'), 'build.closed': t('notifications.buildClosedLabel'), 'auth.login_failed_many': t('notifications.manyLoginFailures'),
    'evidence.required_missing': t('notifications.evidenceMissing'), 'automation.runner.offline': t('notifications.runnerOffline'), 'report.shared': t('notifications.reportSharedLabel'),
    'report.generated': t('notifications.reportGenerated'), 'report.quality_gate_failed': t('notifications.qualityGateFailed'), 'ai.execution.completed': t('notifications.aiCompleted'),
  }

  const eventCatalog = [
    { group: t('notifications.groupBugs'), id: 'bug.created', label: eventLabels['bug.created'], description: t('notifications.bugCreatedDesc') },
    { group: t('notifications.groupBugs'), id: 'bug.created_from_snapshot', label: eventLabels['bug.created_from_snapshot'], description: t('notifications.bugCreatedSnapshotDesc') },
    { group: t('notifications.groupBugs'), id: 'bug.created_from_execution', label: eventLabels['bug.created_from_execution'], description: t('notifications.bugCreatedExecutionDesc') },
    { group: t('notifications.groupBugs'), id: 'bug.assigned', label: eventLabels['bug.assigned'], description: t('notifications.bugAssignedDesc') },
    { group: t('notifications.groupBugs'), id: 'bug.ready_for_retest', label: eventLabels['bug.ready_for_retest'], description: t('notifications.bugRetestDesc') },
    { group: t('notifications.groupBugs'), id: 'bug.comment_added', label: eventLabels['bug.comment_added'], description: t('notifications.bugCommentDesc') },
    { group: t('notifications.groupExecutions'), id: 'execution.failed', label: eventLabels['execution.failed'], description: t('notifications.executionFailedDesc') },
    { group: t('notifications.groupExecutions'), id: 'execution.blocked', label: eventLabels['execution.blocked'], description: t('notifications.executionBlockedDesc') },
    { group: t('notifications.groupAi'), id: 'ai.execution.review_required', label: eventLabels['ai.execution.review_required'], description: t('notifications.aiReviewRequiredDesc') },
    { group: t('notifications.groupAi'), id: 'ai.execution.failed', label: eventLabels['ai.execution.failed'], description: t('notifications.aiFailedDesc') },
    { group: t('notifications.groupAi'), id: 'ai.execution.completed', label: eventLabels['ai.execution.completed'], description: t('notifications.aiCompletedDesc') },
    { group: t('notifications.groupAi'), id: 'ai.engine.unavailable', label: eventLabels['ai.engine.unavailable'], description: t('notifications.aiUnavailableDesc') },
    { group: t('notifications.groupUsersSecurity'), id: 'auth.ad_user_provisioned', label: eventLabels['auth.ad_user_provisioned'], description: t('notifications.adProvisionedDesc') },
    { group: t('notifications.groupUsersSecurity'), id: 'auth.login_failed_many', label: eventLabels['auth.login_failed_many'], description: t('notifications.manyLoginFailuresDesc') },
    { group: t('notifications.groupUsersSecurity'), id: 'user.created', label: eventLabels['user.created'], description: t('notifications.userCreatedDesc') },
    { group: t('notifications.groupUsersSecurity'), id: 'user.disabled', label: eventLabels['user.disabled'], description: t('notifications.userDisabledDesc') },
    { group: t('notifications.groupUsersSecurity'), id: 'user.role_changed', label: eventLabels['user.role_changed'], description: t('notifications.roleChangedDesc') },
    { group: t('notifications.groupRolesProjects'), id: 'role.permissions_changed', label: eventLabels['role.permissions_changed'], description: t('notifications.permissionsChangedDesc') },
    { group: t('notifications.groupRolesProjects'), id: 'project.member_added', label: eventLabels['project.member_added'], description: t('notifications.memberAddedDesc') },
    { group: t('notifications.groupRolesProjects'), id: 'project.member_removed', label: eventLabels['project.member_removed'], description: t('notifications.memberRemovedDesc') },
    { group: t('notifications.groupBuildsEvidence'), id: 'build.activated', label: eventLabels['build.activated'], description: t('notifications.buildActivatedDesc') },
    { group: t('notifications.groupBuildsEvidence'), id: 'build.closed', label: eventLabels['build.closed'], description: t('notifications.buildClosedDesc') },
    { group: t('notifications.groupBuildsEvidence'), id: 'evidence.required_missing', label: eventLabels['evidence.required_missing'], description: t('notifications.evidenceMissingDesc') },
    { group: t('notifications.groupAutomation'), id: 'automation.runner.offline', label: eventLabels['automation.runner.offline'], description: t('notifications.runnerOfflineDesc') },
    { group: t('notifications.groupReports'), id: 'report.shared', label: eventLabels['report.shared'], description: t('notifications.reportSharedDesc') },
    { group: t('notifications.groupReports'), id: 'report.generated', label: eventLabels['report.generated'], description: t('notifications.reportGeneratedDesc') },
    { group: t('notifications.groupReports'), id: 'report.quality_gate_failed', label: eventLabels['report.quality_gate_failed'], description: t('notifications.qualityGateFailedDesc') },
  ]

  const channelLabels: Record<string, string> = {
    in_app: t('notifications.inApp'),
    email: t('notifications.emailChannel'),
  }

  const describeRecipients = (strategy: any) => {
    const parts: string[] = []
    if (strategy?.assignee) parts.push(t('notifications.assigned'))
    if (strategy?.creator) parts.push(t('notifications.creator'))
    if (Array.isArray(strategy?.project_roles) && strategy.project_roles.length) parts.push(`${t('notifications.projectRoles')}: ${strategy.project_roles.join(', ')}`)
    if (Array.isArray(strategy?.global_roles) && strategy.global_roles.length) parts.push(`${t('notifications.globalRoles')}: ${strategy.global_roles.join(', ')}`)
    if (Array.isArray(strategy?.explicit_emails) && strategy.explicit_emails.length) parts.push(`${strategy.explicit_emails.length} ${t('notifications.fixedEmails')}`)
    return parts.length ? parts.join(' · ') : t('notifications.noRecipients')
  }

  const describeConditions = (conditions: any) => {
    const any = Array.isArray(conditions?.any) ? conditions.any : []
    if (!any.length) return t('notifications.alwaysEvent')
    return any.map((condition: any) => {
      const field = String(condition.field || '').replace('payload.', '')
      if (condition.op === 'severity_at_least') return `${field} ${t('notifications.atLeast')} ${condition.value}`
      if (condition.op === 'in') return `${field} ${t('notifications.inValues')} ${(condition.value || []).join(', ')}`
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
    if (!ruleDraft) throw new Error(t('notifications.ruleInvalid'))
    let conditions = {}
    let recipients = {}
    try {
      conditions = JSON.parse(ruleConditionsText || '{}')
      recipients = JSON.parse(ruleRecipientsText || '{}')
    } catch {
      throw new Error(t('notifications.invalidJson'))
    }
    const eventTypes = ruleEventsText.split(',').map(item => item.trim()).filter(Boolean)
    if (!ruleDraft.nombre?.trim()) throw new Error(t('notifications.requiredRuleName'))
    if (!eventTypes.length) throw new Error(t('notifications.addAtLeastEvent'))
    const channels = ruleDraft.actions_json?.channels || []
    if (!channels.length) throw new Error(t('notifications.selectChannel'))
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
      showFeedback(t('notifications.rulesSection'), t('notifications.ruleSaved'), 'success')
      await load()
    } catch (error: any) {
      showFeedback(t('notifications.rulesSection'), error.message || t('notifications.ruleSaveError'), 'danger')
    }
  }

  const deleteRuleDraft = async () => {
    if (!ruleDraft?.id) return
    try {
      await notificationClient.deleteRule(fetchWithAuth, ruleDraft.id)
      setShowRuleModal(false)
      setRuleDraft(null)
      showFeedback(t('notifications.rulesSection'), t('notifications.ruleDeleted'), 'success')
      await load()
    } catch (error: any) {
      showFeedback(t('notifications.rulesSection'), error.message || t('notifications.ruleDeleteError'), 'danger')
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
      .catch((error: any) => showFeedback(t('notifications.stakeholdersSection'), error.message || t('notifications.loadStakeholdersError'), 'danger'))
  }, [stakeholderProjectId])

  const save = async () => {
    try {
      setConfig(await notificationClient.saveEmailConfig(fetchWithAuth, config))
      showFeedback(t('notifications.emailSection'), t('notifications.smtpSaved'), 'success')
    } catch (error: any) {
      showFeedback(t('notifications.emailSection'), error.message || t('notifications.smtpSaveError'), 'danger')
    }
  }

  const sendTest = async () => {
    try {
      await notificationClient.sendTestEmail(fetchWithAuth, testEmail)
      showFeedback(t('notifications.smtpTestSection'), t('notifications.testSent'), 'success')
      await load()
    } catch (error: any) {
      showFeedback(t('notifications.smtpTestSection'), error.message || t('notifications.testSendError'), 'danger')
    }
  }

  const testConnection = async () => {
    try {
      await notificationClient.testEmailConnection(fetchWithAuth)
      showFeedback(t('notifications.smtpSection'), t('notifications.smtpVerified'), 'success')
    } catch (error: any) {
      showFeedback(t('notifications.smtpSection'), error.message || t('notifications.smtpVerifyError'), 'danger')
    }
  }

  const savePreference = async (eventType: string, channel: string, enabled: boolean, frequency = 'daily') => {
    const next = [
      ...preferences.filter(item => !(item.event_type === eventType && item.channel === channel)),
      { event_type: eventType, channel, enabled, frequency: enabled ? frequency : 'never' },
    ]
    setPreferences(await notificationClient.savePreferences(fetchWithAuth, next))
    showFeedback(t('notifications.preferencesSection'), t('notifications.preferencesSaved'), 'success')
  }

  const updateRule = async (rule: any, patch: any) => {
    try {
      await notificationClient.saveRule(fetchWithAuth, rule.id, patch)
      showFeedback(t('notifications.rulesSection'), t('notifications.ruleUpdated'), 'success')
      await load()
    } catch (error: any) {
      showFeedback(t('notifications.rulesSection'), error.message || t('notifications.ruleUpdateError'), 'danger')
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
      showFeedback(t('notifications.templatesSection'), t('notifications.templateSaved'), 'success')
      await load()
    } catch (error: any) {
      showFeedback(t('notifications.templatesSection'), error.message || t('notifications.templateSaveError'), 'danger')
    }
  }

  const previewTemplate = async () => {
    if (!templateDraft) return
    try {
      setTemplatePreview(await notificationClient.previewTemplate(fetchWithAuth, templateDraft.id, {
        platform: { name: config.from_name || 'Treseko' }, user: { nombre: t('notifications.previewUser'), email: 'usuario@example.com' },
        proyecto: { nombre: t('notifications.previewProject') }, message: t('notifications.previewMessage'),
      }))
    } catch (error: any) {
      showFeedback(t('notifications.previewSection'), error.message || t('notifications.previewError'), 'danger')
    }
  }

  const retryDelivery = async (delivery: any) => {
    try {
      await notificationClient.retryDelivery(fetchWithAuth, delivery.id)
      showFeedback(t('notifications.auditSection'), t('notifications.deliveryQueued'), 'success')
      await load()
    } catch (error: any) {
      showFeedback(t('notifications.auditSection'), error.message || t('notifications.deliveryRetryError'), 'danger')
    }
  }

  const processOutbox = async () => {
    try {
      await notificationClient.processOutbox(fetchWithAuth)
      showFeedback(t('notifications.outboxSection'), t('notifications.outboxProcessed'), 'success')
      await load()
    } catch (error: any) {
      showFeedback(t('notifications.outboxSection'), error.message || t('notifications.outboxError'), 'danger')
    }
  }

  const createStakeholder = async () => {
    if (!stakeholderProjectId) return showFeedback(t('notifications.stakeholdersSection'), t('notifications.selectProjectError'), 'warning')
    try {
      const created = await notificationClient.createStakeholder(fetchWithAuth, stakeholderProjectId, stakeholderDraft)
      await notificationClient.saveStakeholderSubscription(fetchWithAuth, created.id, { event_type: null, channel: 'email', enabled: true, ...stakeholderSchedule })
      setStakeholderDraft({ nombre: '', email: '', consent_source: 'manual', allowed_event_types: ['report.exported', 'project.closed'] })
      setStakeholders(await notificationClient.listStakeholders(fetchWithAuth, stakeholderProjectId))
      showFeedback(t('notifications.stakeholdersSection'), t('notifications.stakeholderAdded'), 'success')
    } catch (error: any) {
      showFeedback(t('notifications.stakeholdersSection'), error.message || t('notifications.stakeholderAddError'), 'danger')
    }
  }

  const deactivateStakeholder = async (stakeholder: any) => {
    try {
      await notificationClient.updateStakeholder(fetchWithAuth, stakeholder.id, { active: false })
      setStakeholders(await notificationClient.listStakeholders(fetchWithAuth, stakeholderProjectId))
      showFeedback(t('notifications.stakeholdersSection'), t('notifications.stakeholderDeactivated'), 'success')
    } catch (error: any) {
      showFeedback(t('notifications.stakeholdersSection'), error.message || t('notifications.stakeholderDeactivateError'), 'danger')
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
      showFeedback(t('notifications.digestsSection'), t('notifications.digestSaved'), 'success')
    } catch (error: any) {
      showFeedback(t('notifications.digestsSection'), error.message || t('notifications.digestSaveError'), 'danger')
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
      showFeedback(t('notifications.inboxSection'), error.message || t('notifications.markAllReadError'), 'danger')
    }
  }

  const markInboxRead = async (item: any) => {
    if (item.read_at) return
    try {
      await notificationClient.markInboxRead(fetchWithAuth, item.id)
      await load()
    } catch (error: any) {
      showFeedback(t('notifications.inboxSection'), error.message || t('notifications.markReadError'), 'danger')
    }
  }

  return <NotificationsSettingsView options={{
    t, config, setConfig, canEdit, testEmail, setTestEmail, sendTest, testConnection,
    rules, ruleTemplateOptions, ruleEventsText, setRuleEventsText, ruleConditionsText,
    setRuleConditionsText, ruleRecipientsText, setRuleRecipientsText, ruleDraft,
    setRuleDraft, showRuleModal, setShowRuleModal, openRuleModal, saveRuleDraft,
    deleteRuleDraft, updateRule, eventGroups, eventCatalog, eventLabels, channelLabels,
    describeRecipients, describeConditions, showEventsModal, setShowEventsModal,
    addEventToDraft, templates, selectedTemplateId, setSelectedTemplateId, templateDraft,
    setTemplateDraft, templatePreview, saveTemplate, previewTemplate, deliveries,
    retryDelivery, processOutbox, canAdmin, canReadAudit, canEditTemplates, canEditRules,
    preferences, savePreference, inbox, markAllInboxRead, markInboxRead, projects,
    canManageStakeholders, stakeholderProjectId, setStakeholderProjectId, stakeholderDraft,
    setStakeholderDraft, createStakeholder, deactivateStakeholder, stakeholders,
    canReadDigests, digests, mySchedule, setMySchedule, saveMySchedule,
    canEditOwnSubscriptions, stakeholderSchedule, setStakeholderSchedule, save,
    notificationClient, fetchWithAuth, load, showFeedback, setRuleChannel, safeJsonObject,
  }} />
}
