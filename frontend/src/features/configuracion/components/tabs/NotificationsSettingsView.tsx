import { Accordion, Alert, Badge, Button, Card, Col, Form, Modal, Row, Table } from 'react-bootstrap'
import { Bell, Eye, Mail, Play, Plus, RotateCw, Save, Send, Trash2, Users } from 'lucide-react'

export function NotificationsSettingsView({ options }: { options: any }) {
  const { t, config, setConfig, canEdit, testEmail, setTestEmail, sendTest, testConnection, rules, ruleTemplateOptions, ruleEventsText, setRuleEventsText, ruleConditionsText, setRuleConditionsText, ruleRecipientsText, setRuleRecipientsText, ruleDraft, setRuleDraft, showRuleModal, setShowRuleModal, openRuleModal, saveRuleDraft, deleteRuleDraft, updateRule, eventGroups, eventCatalog, eventLabels, channelLabels, describeRecipients, describeConditions, showEventsModal, setShowEventsModal, addEventToDraft, templates, selectedTemplateId, setSelectedTemplateId, templateDraft, setTemplateDraft, templatePreview, saveTemplate, previewTemplate, deliveries, retryDelivery, processOutbox, canAdmin, canReadAudit, canEditTemplates, canEditRules, preferences, savePreference, inbox, markAllInboxRead, markInboxRead, projects, canManageStakeholders, stakeholderProjectId, setStakeholderProjectId, stakeholderDraft, setStakeholderDraft, stakeholderSchedule, setStakeholderSchedule, createStakeholder, deactivateStakeholder, stakeholders, canReadDigests, digests, mySchedule, setMySchedule, saveMySchedule, canEditOwnSubscriptions, save, notificationClient, fetchWithAuth, load, showFeedback, setRuleChannel, safeJsonObject } = options
  return (
    <Card className="border-0 shadow-sm rounded-4 bg-white p-4">
      <div className="d-flex justify-content-between align-items-start mb-3">
        <div>
          <h6 className="fw-bold text-dark m-0"><Mail size={17} className="me-2" />{t('notifications.title')}</h6>
          <span className="small text-muted">{t('notifications.subtitle')}</span>
        </div>
        <Badge bg={config.enabled ? 'success' : 'secondary'}>{config.enabled ? t('notifications.smtpActive') : t('notifications.smtpInactive')}</Badge>
      </div>
      <Row className="g-3">
        <Col md={12}>
          <Form.Check name="a11y-notificationssettingsviewtsx-17" aria-label="Campo de formulario" type="switch" className="fw-semibold" label={t('notifications.enableEmail')} checked={!!config.enabled} disabled={!canEdit} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} />
          <div className="app-meta text-muted ms-5">{t('notifications.enableEmailHint')}</div>
        </Col>
        <Col md={12}>
          <Form.Check name="a11y-notificationssettingsviewtsx-21" aria-label="Campo de formulario" type="switch" className="fw-semibold" label={t('notifications.safeTestMode')} checked={!!config.test_mode} disabled={!canEdit} onChange={(e) => setConfig({ ...config, test_mode: e.target.checked })} />
          <div className="app-meta text-muted ms-5">{t('notifications.safeTestModeHint')}</div>
        </Col>
        <Col md={6}>
          <Form.Label className="app-label fw-bold text-muted">{t('notifications.recipientName')}</Form.Label>
          <Form.Control name="a11y-notificationssettingsviewtsx-26" aria-label="Campo de formulario" value={config.from_name || ''} placeholder={t('notifications.recipientNamePlaceholder')} disabled={!canEdit} onChange={(e) => setConfig({ ...config, from_name: e.target.value })} />
        </Col>
        <Col md={6}>
          <Form.Label className="app-label fw-bold text-muted">{t('notifications.replyTo')}</Form.Label>
          <Form.Control name="a11y-notificationssettingsviewtsx-30" aria-label="Campo de formulario" type="email" value={config.reply_to || ''} placeholder={t('notifications.replyToPlaceholder')} disabled={!canEdit} onChange={(e) => setConfig({ ...config, reply_to: e.target.value })} />
          <div className="app-meta text-muted mt-1">{t('notifications.senderHint')}</div>
        </Col>
        <Col md={6}>
          <Form.Label className="app-label fw-bold text-muted">{t('notifications.fromEmail')}</Form.Label>
          <Form.Control name="a11y-notificationssettingsviewtsx-35" aria-label="Campo de formulario" type="email" value={config.from_email || ''} placeholder={t('notifications.fromEmailPlaceholder')} disabled={!canEdit} onChange={(e) => setConfig({ ...config, from_email: e.target.value })} />
        </Col>
        <Col md={8}>
          <Form.Label className="app-label fw-bold text-muted">{t('notifications.testEmail')}</Form.Label>
          <Form.Control name="a11y-notificationssettingsviewtsx-39" aria-label="Campo de formulario" type="email" placeholder={t('notifications.testEmailPlaceholder')} value={testEmail} disabled={!canEdit} onChange={(e) => setTestEmail(e.target.value)} />
        </Col>
        {canEdit && <Col md={4} className="align-self-end d-flex gap-2"><Button variant="outline-secondary" className="rounded-pill fw-bold text-nowrap" onClick={testConnection}><RotateCw size={16} className="me-1" />{t('notifications.testSmtp')}</Button><Button variant="outline-primary" className="flex-grow-1 rounded-pill fw-bold" onClick={sendTest} disabled={!testEmail}><Play size={16} className="me-2" />{t('notifications.sendTest')}</Button></Col>}
        {canEdit && <Col md={12} className="text-end"><Button onClick={save} className="app-save-button"><Save size={16} />{t('notifications.saveEmail')}</Button></Col>}
      </Row>
      <Accordion className="mt-4 notifications-settings-advanced" defaultActiveKey={config.enabled && config.host ? undefined : 'connection'}>
        <Accordion.Item eventKey="connection">
          <Accordion.Header>{t('notifications.providerConfig')}</Accordion.Header>
          <Accordion.Body>
            <p className="app-meta text-muted mb-3">{t('notifications.providerHint')}</p>
            <Row className="g-3">
              <Col md={6}><Form.Label className="app-label fw-bold text-muted">{t('notifications.smtpServer')}</Form.Label><Form.Control name="a11y-notificationssettingsviewtsx-50" aria-label="Campo de formulario" size="sm" placeholder={t('notifications.smtpServerPlaceholder')} value={config.host || ''} disabled={!canEdit} onChange={(e) => setConfig({ ...config, host: e.target.value })} /></Col>
              <Col md={2}><Form.Label className="app-label fw-bold text-muted">{t('notifications.port')}</Form.Label><Form.Control name="a11y-notificationssettingsviewtsx-51" aria-label="Campo de formulario" size="sm" type="number" value={config.port || 587} disabled={!canEdit} onChange={(e) => setConfig({ ...config, port: Number(e.target.value) })} /></Col>
              <Col md={4}><Form.Label className="app-label fw-bold text-muted">{t('notifications.smtpUser')}</Form.Label><Form.Control name="a11y-notificationssettingsviewtsx-52" aria-label="Campo de formulario" size="sm" placeholder={t('notifications.smtpUserPlaceholder')} value={config.username || ''} disabled={!canEdit} onChange={(e) => setConfig({ ...config, username: e.target.value })} /></Col>
              <Col md={6}><Form.Label className="app-label fw-bold text-muted">{t('notifications.publicUrl')}</Form.Label><Form.Control name="a11y-notificationssettingsviewtsx-53" aria-label="Campo de formulario" size="sm" placeholder={t('notifications.publicUrlPlaceholder')} value={config.base_url || ''} disabled={!canEdit} onChange={(e) => setConfig({ ...config, base_url: e.target.value })} /></Col>
              <Col md={3} className="d-flex align-items-end"><Form.Check name="a11y-notificationssettingsviewtsx-54" aria-label="Campo de formulario" type="switch" label={t('notifications.useStarttls')} checked={!!config.use_starttls} disabled={!canEdit} onChange={(e) => setConfig({ ...config, use_starttls: e.target.checked })} /></Col>
              <Col md={3} className="d-flex align-items-end"><Form.Check name="a11y-notificationssettingsviewtsx-55" aria-label="Campo de formulario" type="switch" label={t('notifications.useSsl')} checked={!!config.use_ssl} disabled={!canEdit} onChange={(e) => setConfig({ ...config, use_ssl: e.target.checked })} /></Col>
              <Col md={4}><Form.Label className="app-label fw-bold text-muted">{t('notifications.dailyLimit')}</Form.Label><Form.Control name="a11y-notificationssettingsviewtsx-56" aria-label="Campo de formulario" size="sm" type="number" value={config.daily_send_limit || 500} disabled={!canEdit} onChange={(e) => setConfig({ ...config, daily_send_limit: Number(e.target.value) })} /></Col>
              <Col md={8} className="d-flex align-items-end"><Badge bg="light" text="dark" className="border">{t('notifications.password')}: {config.password_configured ? t('notifications.configured') : t('notifications.pendingConfiguration')} · {t('notifications.passwordHint')}</Badge></Col>
            </Row>
          </Accordion.Body>
        </Accordion.Item>
        <Accordion.Item eventKey="automation">
          <Accordion.Header>{t('notifications.automation')}</Accordion.Header>
          <Accordion.Body>
      <Row className="g-3">
        <Col lg={12}>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <div>
              <div className="small fw-bold">{t('notifications.emailRules')}</div>
              <div className="x-small text-muted">{t('notifications.rulesHint')}</div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <Badge bg="light" text="dark" className="border">{rules.length} {t('notifications.rules')}</Badge>
              <Badge bg="light" text="dark" className="border">{rules.filter(rule => rule.enabled).length} {t('notifications.active')}</Badge>
              <Button size="sm" variant="outline-secondary" onClick={() => setShowEventsModal(true)}>
                <Bell size={14} className="me-1" />{t('notifications.events')}
              </Button>
              {canEditRules && (
                <Button size="sm" variant="outline-primary" onClick={() => openRuleModal()}>
                  <Plus size={14} className="me-1" />{t('notifications.newRule')}
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
                        <Badge bg={rule.enabled ? 'success' : 'secondary'}>{rule.enabled ? t('notifications.activeRule') : t('notifications.inactiveRule')}</Badge>
                        <span className="x-small text-muted">{eventTypes.length} {eventTypes.length === 1 ? t('notifications.event') : t('notifications.eventsPlural')} · {t('notifications.priority')} {rule.priority}</span>
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
                        <Eye size={14} className="me-1" />{t('notifications.detail')}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
            {!rules.length && (
              <div className="border rounded-3 bg-light-subtle p-3 small text-muted">
                {t('notifications.noRules')}
              </div>
            )}
          </div>
        </Col>
        <Col lg={12}>
          <div className="small fw-bold mb-1">{t('notifications.personalEmailPreferences')}</div>
          <div className="x-small text-muted mb-2">{t('notifications.personalPreferencesHint')}</div>
          <div className="d-flex flex-column gap-2">
            {['bug.created', 'bug.assigned', 'execution.failed', 'ai.execution.review_required'].map(eventType => {
              const pref = preferences.find(item => item.event_type === eventType && item.channel === 'email')
              const enabled = pref ? pref.enabled && pref.frequency !== 'never' : true
              return <div key={eventType} className="d-flex flex-wrap align-items-center gap-2 border rounded-3 px-2 py-1 bg-light-subtle">
                <Form.Check type="switch" id={`pref-${eventType}`} label={`${eventLabels[eventType] || eventType} ${t('notifications.emailChannel')}`} checked={enabled} onChange={(event) => savePreference(eventType, 'email', event.target.checked, pref?.frequency || 'daily')} />
                <Form.Select size="sm" aria-label={`${t('notifications.frequency')} ${eventLabels[eventType] || eventType}`} value={pref?.frequency || 'daily'} disabled={!enabled} style={{ width: 180 }} onChange={(event) => savePreference(eventType, 'email', true, event.target.value)}>
                  <option value="immediate">{t('notifications.immediate')}</option><option value="daily">{t('notifications.dailySummary')}</option><option value="weekly">{t('notifications.weeklySummary')}</option><option value="monthly">{t('notifications.monthlySummary')}</option><option value="never">{t('notifications.doNotSend')}</option>
                </Form.Select>
              </div>
            })}
          </div>
        </Col>
        <Col lg={12}>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <div>
              <div className="small fw-bold">{t('notifications.inAppNotifications')}</div>
              <div className="x-small text-muted">{t('notifications.inboxHint')}</div>
            </div>
            <div className="d-flex gap-2 align-items-center">
              <Badge bg="light" text="dark" className="border">{inbox.filter(item => !item.read_at).length} {t('notifications.unread')}</Badge>
              <Button size="sm" variant="outline-secondary" onClick={markAllInboxRead} disabled={!inbox.some(item => !item.read_at)}>{t('notifications.markRead')}</Button>
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
                  <Badge bg={item.read_at ? 'secondary' : 'primary'}>{item.read_at ? t('notifications.read') : t('notifications.new')}</Badge>
                </div>
                <div className="small text-muted">{item.message}</div>
              </button>
            ))}
            {!inbox.length && (
              <div className="small text-muted px-3 py-3">{t('notifications.noInbox')}</div>
            )}
          </div>
        </Col>
        {canReadAudit && <Col lg={6}>
          <div className="small fw-bold mb-2">{t('notifications.templates')}</div>
          <Form.Select name="a11y-notificationssettingsviewtsx-176" aria-label="Campo de formulario"
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
              <Form.Check name="a11y-notificationssettingsviewtsx-190" aria-label="Campo de formulario"
                type="switch"
                label={templateDraft.enabled ? t('notifications.activeTemplate') : t('notifications.inactiveTemplate')}
                checked={!!templateDraft.enabled}
                disabled={!canEditTemplates}
                onChange={(event) => setTemplateDraft({ ...templateDraft, enabled: event.target.checked })}
              />
              <Form.Control name="a11y-notificationssettingsviewtsx-197" aria-label="Campo de formulario"
                size="sm"
                className="my-2"
                value={templateDraft.subject_template || ''}
                disabled={!canEditTemplates}
                onChange={(event) => setTemplateDraft({ ...templateDraft, subject_template: event.target.value })}
              />
              <Form.Control name="a11y-notificationssettingsviewtsx-204" aria-label="Campo de formulario"
                as="textarea"
                rows={5}
                size="sm"
                value={templateDraft.text_template || ''}
                disabled={!canEditTemplates}
                onChange={(event) => setTemplateDraft({ ...templateDraft, text_template: event.target.value })}
              />
              <Form.Label className="x-small fw-bold text-muted mt-2">{t('notifications.htmlTemplate')}</Form.Label>
              <Form.Control name="a11y-notificationssettingsviewtsx-213" aria-label="Campo de formulario" as="textarea" rows={4} size="sm" value={templateDraft.html_template || ''} disabled={!canEditTemplates} onChange={(event) => setTemplateDraft({ ...templateDraft, html_template: event.target.value })} placeholder={t('notifications.htmlPlaceholder')} />
              <div className="d-flex justify-content-between gap-2 mt-2">
                <Button size="sm" variant="outline-secondary" onClick={previewTemplate}><Eye size={14} className="me-1" />{t('notifications.preview')}</Button>
                {canEditTemplates && (
                  <Button size="sm" onClick={saveTemplate} className="app-save-button"><Save size={14} />{t('notifications.saveTemplate')}</Button>
                )}
              </div>
              {templatePreview && <div className="mt-2 border rounded-3 overflow-hidden"><div className="small fw-semibold bg-light px-2 py-1">{templatePreview.subject || t('notifications.noSubject')}</div>{templatePreview.html ? <iframe title={t('notifications.emailPreview')} sandbox="" className="w-100 border-0" style={{ minHeight: 180 }} srcDoc={templatePreview.html} /> : <pre className="small p-2 mb-0 text-wrap">{templatePreview.text}</pre>}</div>}
            </div>
          )}
        </Col>}
        <Col lg={6}>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <div className="small fw-bold">{t('notifications.deliveryAudit')}</div>
            {canAdmin && <Button size="sm" variant="outline-secondary" onClick={processOutbox}><RotateCw size={14} className="me-1" />{t('notifications.process')}</Button>}
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
                      {['FAILED', 'CANCELLED', 'RETRY'].includes(d.status) && <Button size="sm" variant="link" className="p-0" onClick={() => retryDelivery(d)}>{t('notifications.retry')}</Button>}
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
          <Accordion.Header>{t('notifications.scheduledDigests')}</Accordion.Header>
          <Accordion.Body>
            <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
              <p className="app-meta text-muted mb-0">{t('notifications.digestHint')}</p>
              {canAdmin && <Button size="sm" variant="outline-secondary" className="rounded-pill" onClick={async () => { try { await notificationClient.processDigests(fetchWithAuth); await load(); showFeedback(t('notifications.digestsSection'), t('notifications.digestProcessed'), 'success') } catch (error: any) { showFeedback(t('notifications.digestsSection'), error.message || t('notifications.digestProcessError'), 'danger') } }}><RotateCw size={14} className="me-1" />{t('notifications.processPending')}</Button>}
            </div>
            {canEditOwnSubscriptions && <div className="border rounded-3 p-3 mb-3 bg-light-subtle">
              <div className="small fw-bold mb-2">{t('notifications.myEmailDigest')}</div>
              <Row className="g-2 align-items-end">
                <Col md={3}><Form.Label className="app-label fw-bold text-muted">{t('notifications.project')}</Form.Label><Form.Select name="a11y-notificationssettingsviewtsx-259" aria-label="Campo de formulario" size="sm" value={mySchedule.proyectoId} onChange={(e) => setMySchedule({ ...mySchedule, proyectoId: e.target.value })}><option value="">{t('notifications.allAllowedProjects')}</option>{projects.map(project => <option key={project.id} value={project.id}>{project.nombre || project.name}</option>)}</Form.Select></Col>
                <Col md={2}><Form.Label className="app-label fw-bold text-muted">{t('notifications.frequency')}</Form.Label><Form.Select name="a11y-notificationssettingsviewtsx-260" aria-label="Campo de formulario" size="sm" value={mySchedule.frequency} onChange={(e) => setMySchedule({ ...mySchedule, frequency: e.target.value })}><option value="daily">{t('notifications.dailySummary')}</option><option value="weekly">{t('notifications.weeklySummary')}</option><option value="monthly">{t('notifications.monthlySummary')}</option><option value="never">{t('notifications.doNotSend')}</option></Form.Select></Col>
                <Col md={3}><Form.Label className="app-label fw-bold text-muted">{t('notifications.timezone')}</Form.Label><Form.Control name="a11y-notificationssettingsviewtsx-261" aria-label="Campo de formulario" size="sm" value={mySchedule.timezone} onChange={(e) => setMySchedule({ ...mySchedule, timezone: e.target.value })} /></Col>
                <Col md={1}><Form.Label className="app-label fw-bold text-muted">{t('notifications.hour')}</Form.Label><Form.Control name="a11y-notificationssettingsviewtsx-262" aria-label="Campo de formulario" size="sm" type="number" min="0" max="23" value={mySchedule.send_hour} onChange={(e) => setMySchedule({ ...mySchedule, send_hour: Number(e.target.value) })} /></Col>
                <Col md={1}><Form.Label className="app-label fw-bold text-muted">{t('notifications.day')}</Form.Label><Form.Control name="a11y-notificationssettingsviewtsx-263" aria-label="Campo de formulario" size="sm" type="number" min="1" max={mySchedule.frequency === 'weekly' ? '7' : '31'} value={mySchedule.send_day} disabled={!['weekly', 'monthly'].includes(mySchedule.frequency)} onChange={(e) => setMySchedule({ ...mySchedule, send_day: Number(e.target.value) })} /></Col>
                <Col md={2}><Button size="sm" className="w-100 rounded-pill" onClick={saveMySchedule}>{t('notifications.save')}</Button></Col>
                <Col md={5}><Form.Label className="app-label fw-bold text-muted">{t('notifications.muteUntil')}</Form.Label><Form.Control name="a11y-notificationssettingsviewtsx-265" aria-label="Campo de formulario" size="sm" type="datetime-local" value={mySchedule.mutedUntil} onChange={(e) => setMySchedule({ ...mySchedule, mutedUntil: e.target.value })} /></Col>
              </Row>
            </div>}
            {!canReadDigests && <div className="small text-muted">{t('notifications.noDigestPermission')}</div>}
            {canReadDigests && <Table size="sm" responsive hover className="mb-0">
              <thead><tr><th>{t('notifications.recipient')}</th><th>{t('notifications.project')}</th><th>{t('notifications.frequency')}</th><th>{t('notifications.period')}</th><th>{t('notifications.nextSend')}</th><th>{t('notifications.status')}</th></tr></thead>
              <tbody>{digests.slice(0, 20).map(digest => <tr key={digest.id}><td>{digest.recipient_email}</td><td>{projects.find(project => project.id === digest.proyecto_id)?.nombre || t('notifications.global')}</td><td>{({ daily: t('notifications.dailySummaryShort'), weekly: t('notifications.weeklySummaryShort'), monthly: t('notifications.monthlySummaryShort'), on_report_export: t('notifications.onReportExport'), on_build_closure: t('notifications.onBuildClosure'), on_project_closure: t('notifications.onProjectClosure') } as any)[digest.frequency] || digest.frequency}</td><td className="small">{new Date(digest.period_start).toLocaleDateString()} – {new Date(digest.period_end).toLocaleDateString()}</td><td className="small">{digest.scheduled_for ? new Date(digest.scheduled_for).toLocaleString() : t('notifications.whenEventOccurs')}</td><td><Badge bg={digest.status === 'SENT' ? 'success' : digest.status === 'FAILED' ? 'danger' : 'secondary'}>{digest.status}</Badge></td></tr>)}</tbody>
            </Table>}
            {canReadDigests && !digests.length && <div className="small text-muted py-2">{t('notifications.noDigests')}</div>}
          </Accordion.Body>
        </Accordion.Item>
        <Accordion.Item eventKey="stakeholders">
          <Accordion.Header>{t('notifications.externalStakeholders')}</Accordion.Header>
          <Accordion.Body>
            <p className="app-meta text-muted">{t('notifications.stakeholderHint')}</p>
            <Row className="g-2 align-items-end">
              <Col md={4}><Form.Label className="app-label fw-bold text-muted">{t('notifications.project')}</Form.Label><Form.Select name="a11y-notificationssettingsviewtsx-281" aria-label="Campo de formulario" size="sm" value={stakeholderProjectId} onChange={(e) => setStakeholderProjectId(e.target.value)}><option value="">{t('notifications.selectProject')}</option>{projects.map(project => <option key={project.id} value={project.id}>{project.nombre || project.name}</option>)}</Form.Select></Col>
              <Col md={3}><Form.Label className="app-label fw-bold text-muted">{t('notifications.name')}</Form.Label><Form.Control name="a11y-notificationssettingsviewtsx-282" aria-label="Campo de formulario" size="sm" value={stakeholderDraft.nombre} disabled={!canManageStakeholders} onChange={(e) => setStakeholderDraft({ ...stakeholderDraft, nombre: e.target.value })} /></Col>
              <Col md={3}><Form.Label className="app-label fw-bold text-muted">{t('notifications.email')}</Form.Label><Form.Control name="a11y-notificationssettingsviewtsx-283" aria-label="Campo de formulario" size="sm" type="email" value={stakeholderDraft.email} disabled={!canManageStakeholders} onChange={(e) => setStakeholderDraft({ ...stakeholderDraft, email: e.target.value })} /></Col>
              <Col md={2}>{canManageStakeholders && <Button size="sm" className="w-100 rounded-pill" onClick={createStakeholder} disabled={!stakeholderDraft.nombre || !stakeholderDraft.email}><Plus size={14} className="me-1" />{t('notifications.add')}</Button>}</Col>
              <Col md={12}><Form.Label className="app-label fw-bold text-muted">{t('notifications.allowedEvents')}</Form.Label><Form.Select name="a11y-notificationssettingsviewtsx-285" aria-label="Campo de formulario" size="sm" multiple value={stakeholderDraft.allowed_event_types} disabled={!canManageStakeholders} onChange={(e) => setStakeholderDraft({ ...stakeholderDraft, allowed_event_types: Array.from(e.currentTarget.selectedOptions).map(option => option.value) })}><option value="report.exported">{t('notifications.reportExported')}</option><option value="report.shared">{t('notifications.reportShared')}</option><option value="build.closed">{t('notifications.buildClosed')}</option><option value="project.closed">{t('notifications.projectClosed')}</option></Form.Select></Col>
              <Col md={4}><Form.Label className="app-label fw-bold text-muted">{t('notifications.initialFrequency')}</Form.Label><Form.Select name="a11y-notificationssettingsviewtsx-286" aria-label="Campo de formulario" size="sm" value={stakeholderSchedule.frequency} disabled={!canManageStakeholders} onChange={(e) => setStakeholderSchedule({ ...stakeholderSchedule, frequency: e.target.value })}><option value="immediate">{t('notifications.immediate')}</option><option value="daily">{t('notifications.dailySummary')}</option><option value="weekly">{t('notifications.weeklySummary')}</option><option value="monthly">{t('notifications.monthlySummary')}</option><option value="on_report_export">{t('notifications.onReportExport')}</option><option value="on_build_closure">{t('notifications.onBuildClosure')}</option><option value="on_project_closure">{t('notifications.onProjectClosure')}</option></Form.Select></Col>
              <Col md={5}><Form.Label className="app-label fw-bold text-muted">{t('notifications.timezone')}</Form.Label><Form.Control name="a11y-notificationssettingsviewtsx-287" aria-label="Campo de formulario" size="sm" value={stakeholderSchedule.timezone} disabled={!canManageStakeholders} onChange={(e) => setStakeholderSchedule({ ...stakeholderSchedule, timezone: e.target.value })} /></Col>
              <Col md={2}><Form.Label className="app-label fw-bold text-muted">{t('notifications.summaryHour')}</Form.Label><Form.Control name="a11y-notificationssettingsviewtsx-288" aria-label="Campo de formulario" size="sm" type="number" min="0" max="23" value={stakeholderSchedule.send_hour} disabled={!canManageStakeholders} onChange={(e) => setStakeholderSchedule({ ...stakeholderSchedule, send_hour: Number(e.target.value) })} /></Col>
              <Col md={1}><Form.Label className="app-label fw-bold text-muted">{t('notifications.day')}</Form.Label><Form.Control name="a11y-notificationssettingsviewtsx-289" aria-label="Campo de formulario" size="sm" type="number" min="1" max={stakeholderSchedule.frequency === 'weekly' ? '7' : '31'} value={stakeholderSchedule.send_day} disabled={!canManageStakeholders || !['weekly', 'monthly'].includes(stakeholderSchedule.frequency)} onChange={(e) => setStakeholderSchedule({ ...stakeholderSchedule, send_day: Number(e.target.value) })} /></Col>
            </Row>
            <div className="mt-3 border rounded-3 overflow-hidden">
              {stakeholders.map(stakeholder => <div key={stakeholder.id} className="d-flex flex-wrap align-items-center justify-content-between gap-2 border-bottom px-3 py-2"><div><span className="fw-semibold">{stakeholder.nombre}</span><span className="small text-muted ms-2">{stakeholder.email}</span><div className="x-small text-muted">{(stakeholder.allowed_event_types || []).join(' · ') || t('notifications.noEvents')}</div></div><div className="d-flex align-items-center gap-2"><Badge bg={stakeholder.active ? 'success' : 'secondary'}>{stakeholder.active ? t('notifications.enabled') : t('notifications.deactivated')}</Badge>{stakeholder.active && canManageStakeholders && <Button size="sm" variant="outline-danger" onClick={() => deactivateStakeholder(stakeholder)}>{t('notifications.deactivate')}</Button>}</div></div>)}
              {stakeholderProjectId && !stakeholders.length && <div className="small text-muted p-3">{t('notifications.noStakeholders')}</div>}
            </div>
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
      <Modal show={showRuleModal} onHide={() => setShowRuleModal(false)} centered size="lg" backdrop="static">
        <Modal.Header closeButton className="bg-light">
            <Modal.Title className="fw-bold fs-5 d-flex align-items-center gap-2">
            <Bell size={18} className="text-primary" /> {ruleDraft?.id ? t('notifications.editRule') : t('notifications.newRule')}
          </Modal.Title>
        </Modal.Header>
        {ruleDraft && (
          <Modal.Body className="text-start">
            <Row className="g-3">
              <Col md={8}>
                <Form.Label className="x-small fw-bold text-muted">{t('notifications.ruleName')}</Form.Label>
                <Form.Control name="a11y-notificationssettingsviewtsx-309" aria-label="Campo de formulario" size="sm" value={ruleDraft.nombre || ''} disabled={!canEditRules} onChange={(event) => setRuleDraft({ ...ruleDraft, nombre: event.target.value })} />
              </Col>
              <Col md={4}>
                <Form.Label className="x-small fw-bold text-muted">{t('notifications.rulePriority')}</Form.Label>
                <Form.Control name="a11y-notificationssettingsviewtsx-313" aria-label="Campo de formulario" size="sm" type="number" value={ruleDraft.priority || 100} disabled={!canEditRules} onChange={(event) => setRuleDraft({ ...ruleDraft, priority: Number(event.target.value) })} />
              </Col>
              <Col md={12}>
                <Form.Label className="x-small fw-bold text-muted">{t('notifications.events')}</Form.Label>
                <div className="d-flex gap-2">
                  <Form.Control name="a11y-notificationssettingsviewtsx-318" aria-label="Campo de formulario" size="sm" value={ruleEventsText} disabled={!canEditRules} onChange={(event) => setRuleEventsText(event.target.value)} />
                  <Button size="sm" variant="outline-secondary" type="button" onClick={() => setShowEventsModal(true)}>{t('notifications.viewEvents')}</Button>
                </div>
                <div className="d-flex flex-wrap gap-1 mt-2">
                  {ruleEventsText.split(',').map(item => item.trim()).filter(Boolean).map(eventType => (
                    <Badge key={eventType} bg="light" text="dark" className="border fw-normal">{eventLabels[eventType] || eventType}</Badge>
                  ))}
                </div>
              </Col>
              <Col md={4}>
                <Form.Check name="a11y-notificationssettingsviewtsx-328" aria-label="Campo de formulario" type="switch" label={t('notifications.enabledRule')} checked={!!ruleDraft.enabled} disabled={!canEditRules} onChange={(event) => setRuleDraft({ ...ruleDraft, enabled: event.target.checked })} />
              </Col>
              <Col md={4}>
                <Form.Check name="a11y-notificationssettingsviewtsx-331" aria-label="Campo de formulario" type="checkbox" label={t('notifications.inApp')} checked={(ruleDraft.actions_json?.channels || []).includes('in_app')} disabled={!canEditRules} onChange={(event) => setRuleChannel('in_app', event.target.checked)} />
              </Col>
              <Col md={4}>
                <Form.Check name="a11y-notificationssettingsviewtsx-334" aria-label="Campo de formulario" type="checkbox" label={t('notifications.emailChannel')} checked={(ruleDraft.actions_json?.channels || []).includes('email')} disabled={!canEditRules} onChange={(event) => setRuleChannel('email', event.target.checked)} />
              </Col>
              <Col md={6}>
                <Form.Label className="x-small fw-bold text-muted">{t('notifications.emailTemplate')}</Form.Label>
                <Form.Select name="a11y-notificationssettingsviewtsx-338" aria-label="Campo de formulario" size="sm" value={ruleDraft.template_id || ''} disabled={!canEditRules} onChange={(event) => setRuleDraft({ ...ruleDraft, template_id: event.target.value || null })}>
                  <option value="">{t('notifications.noTemplate')}</option>
                  {ruleTemplateOptions.map(template => <option key={template.id} value={template.id}>{template.key}</option>)}
                </Form.Select>
              </Col>
              <Col md={6}>
                <Form.Label className="x-small fw-bold text-muted">{t('notifications.cooldown')}</Form.Label>
                <Form.Control name="a11y-notificationssettingsviewtsx-345" aria-label="Campo de formulario" size="sm" type="number" value={ruleDraft.cooldown_minutes || 0} disabled={!canEditRules} onChange={(event) => setRuleDraft({ ...ruleDraft, cooldown_minutes: Number(event.target.value) })} />
              </Col>
              <Col md={12}>
                <Form.Label className="x-small fw-bold text-muted">{t('notifications.recipientsJson')}</Form.Label>
                <Form.Control name="a11y-notificationssettingsviewtsx-349" aria-label="Campo de formulario" as="textarea" rows={4} size="sm" value={ruleRecipientsText} disabled={!canEditRules} onChange={(event) => setRuleRecipientsText(event.target.value)} />
              </Col>
              <Col md={12}>
                <Form.Label className="x-small fw-bold text-muted">{t('notifications.conditionsJson')}</Form.Label>
                <Form.Control name="a11y-notificationssettingsviewtsx-353" aria-label="Campo de formulario" as="textarea" rows={4} size="sm" value={ruleConditionsText} disabled={!canEditRules} onChange={(event) => setRuleConditionsText(event.target.value)} />
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
              <Trash2 size={14} className="me-1" />{t('notifications.delete')}
            </Button>
          )}
          <Button variant="outline-secondary" onClick={() => setShowRuleModal(false)}>{t('notifications.cancel')}</Button>
          {canEditRules && <Button onClick={saveRuleDraft} className="app-save-button"><Save size={14} />{t('notifications.save')}</Button>}
        </Modal.Footer>
      </Modal>
      <Modal show={showEventsModal} onHide={() => setShowEventsModal(false)} centered size="xl">
        <Modal.Header closeButton className="bg-light">
          <Modal.Title className="fw-bold fs-5 d-flex align-items-center gap-2">
            <Bell size={18} className="text-primary" /> {t('notifications.availableEvents')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="text-start">
          <div className="small text-muted mb-3">
            {t('notifications.eventsHint')}
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
                        {t('notifications.addEvent')}
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
